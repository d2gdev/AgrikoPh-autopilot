import { createHash } from "node:crypto";
import { z } from "zod";
import { chatCompletionWithFailover } from "@/lib/ai/client";
import { fetchGovernedRedirects, fetchGovernedStoreResources, resolveGovernedStoreUrl, type GovernedStoreResource } from "@/lib/shopify-governed-resources";
import { replaceExactInternalLinkTargets, type ExactInternalLinkReplacement } from "@/lib/store-tasks/replace-internal-links";
import { supersedeEquivalentAdvisories, topicalMapAdvisorySemanticKey, type AdvisoryDatabase } from "@/lib/store-tasks/topical-map-advisories";
import { loadActiveTopicalMapCommandCenter, type TopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";
import {
  topicalMapActionEligibility,
  topicalMapInternalLinkEligibility,
  topicalMapInternalLinkRequiresAddition,
  topicalMapInternalLinkRequiresReplacement,
  topicalMapRedirectRequiresDelete,
  topicalMapRedirectRequiresLegacyLinkCleanup,
  topicalMapRedirectRequiresUpdate,
  type TopicalMapResolutionStatus,
} from "@/lib/topical-map/action-eligibility";

export type TopicalMapStoreAction = "seo_update" | "content_update" | "internal_link" | "internal_link_replace" | "redirect_create" | "redirect_update" | "redirect_delete";

const TargetType = z.enum(["product", "collection", "page", "article"]);
const Hash = z.string().regex(/^[a-f0-9]{64}$/i);
const GovernedUrl = z.string().refine((value) => {
  try { return path(value).startsWith("/") && !value.toLowerCase().startsWith("javascript:"); } catch { return false; }
}, "Expected a governed URL");
const AdvisoryDomain = z.enum(["content_decisions", "redirects", "canonicalization", "indexation"]);
const AdvisoryTargetType = z.enum(["product", "collection", "page", "homepage", "blog_index", "redirect", "technical"]);
const AdvisoryReason = z.enum(["homepage_not_governed", "blog_index_not_governed", "redirect_execution_unsupported", "redirect_conflict", "canonicalization_execution_prohibited", "indexation_execution_prohibited", "draft_unavailable", "manual_gate", "activation_blocking", "conditions_unsatisfied"]);
const ResolutionStatus = z.enum(["resolved", "manual_gate", "activation_blocking"]);
const SourceReferences = z.array(z.object({ kind: z.enum(["rule", "command_center"]), id: z.string().min(1).max(200) }).strict()).max(25);
const GenerationProvenance = z.enum(["deterministic", "bounded_ai_draft", "advisory_projection"]);
const SeoBefore = z.object({ seoTitle: z.string().nullable().optional(), seoDescription: z.string().nullable().optional() }).strict();
const SeoAfter = z.object({ seoTitle: z.string().min(1).max(70).optional(), seoDescription: z.string().min(1).max(160).optional() }).strict().refine((value) => value.seoTitle !== undefined || value.seoDescription !== undefined, "At least one SEO field is required");
const BodyBefore = z.object({ bodyHtml: z.string() }).strict();
const BodyAfter = z.object({ bodyHtml: z.string().min(1).max(50_000) }).strict();

const ExecutableSourceBase = {
  source: z.literal("topical-map"), strategyVersionId: z.string().min(1), packageSha256: Hash,
  ruleIds: z.array(z.string().min(1)).min(1), targetType: TargetType, targetUrl: GovernedUrl,
  sourceReferences: SourceReferences, generationProvenance: GenerationProvenance,
  observedAt: z.string().datetime().refine((value) => new Date(value).getTime() <= Date.now() + 5 * 60_000, "Observation cannot be in the future"), observationProvenance: z.string().min(1).max(500).optional(), resourceUpdatedAt: z.string().datetime().optional(), observedStateHash: Hash, recommendationId: z.string().min(1).optional(), executable: z.literal(true),
  resolutionStatus: ResolutionStatus.optional(),
};
const CurrentInternalLinkSourceSchema = z.object({ ...ExecutableSourceBase, action: z.literal("internal_link"), ruleDomains: z.tuple([z.literal("internal_links")]), links: z.array(z.object({ toUrl: GovernedUrl, anchor: z.string().min(1), currentBodyState: z.string().min(1).max(500).optional(), linkPurpose: z.string().min(1).max(500).optional(), requiredAction: z.string().min(1).max(500).optional(), verification: z.string().min(1).max(500).optional(), priority: z.string().min(1).max(40).optional(), resolutionStatus: ResolutionStatus.optional() }).strict()).min(1).max(100) }).strict();
const ExecutableSourceSchema = z.discriminatedUnion("action", [
  z.object({ ...ExecutableSourceBase, action: z.literal("seo_update"), ruleDomains: z.tuple([z.literal("content_decisions")]) }).strict(),
  z.object({ ...ExecutableSourceBase, action: z.literal("content_update"), ruleDomains: z.tuple([z.literal("content_decisions")]) }).strict(),
  CurrentInternalLinkSourceSchema,
]);
const RedirectExecutableSourceSchema = z.object({
  source: z.literal("topical-map"), strategyVersionId: z.string().min(1), packageSha256: Hash,
  ruleIds: z.array(z.string().min(1)).min(1), ruleDomains: z.tuple([z.literal("redirects")]), sourceReferences: SourceReferences,
  generationProvenance: z.literal("deterministic"), targetType: z.literal("redirect"), targetUrl: GovernedUrl,
  action: z.literal("redirect_create"), redirectTarget: GovernedUrl,
  observedAt: z.string().datetime().refine((value) => new Date(value).getTime() <= Date.now() + 5 * 60_000, "Observation cannot be in the future"),
  observedStateHash: Hash, recommendationId: z.string().min(1).optional(), executable: z.literal(true),
  resolutionStatus: ResolutionStatus.optional(),
}).strict();
const RedirectRepairSourceBase = {
  source: z.literal("topical-map"), strategyVersionId: z.string().min(1), packageSha256: Hash,
  ruleIds: z.array(z.string().min(1)).min(1), ruleDomains: z.tuple([z.literal("redirects")]), sourceReferences: SourceReferences,
  generationProvenance: z.literal("deterministic"), targetType: z.literal("redirect"), targetUrl: GovernedUrl,
  redirectId: z.string().min(1).max(500), observedRedirectTarget: GovernedUrl,
  observedAt: z.string().datetime().refine((value) => new Date(value).getTime() <= Date.now() + 5 * 60_000, "Observation cannot be in the future"),
  observedStateHash: Hash, recommendationId: z.string().min(1).optional(), executable: z.literal(true),
  resolutionStatus: z.literal("resolved"),
};
const RedirectUpdateExecutableSourceSchema = z.object({
  ...RedirectRepairSourceBase,
  action: z.literal("redirect_update"),
  redirectTarget: GovernedUrl,
}).strict();
const RedirectDeleteExecutableSourceSchema = z.object({
  ...RedirectRepairSourceBase,
  action: z.literal("redirect_delete"),
  liveOwnerUrl: GovernedUrl,
}).strict();
const InternalLinkReplacementSourceSchema = z.object({
  ...ExecutableSourceBase,
  action: z.literal("internal_link_replace"),
  ruleDomains: z.tuple([z.literal("internal_links"), z.literal("redirects")]),
  replacements: z.array(z.object({
    fromUrl: GovernedUrl,
    toUrl: GovernedUrl,
  }).strict()).min(1).max(100),
}).strict();
const LegacyInternalLinkSourceSchema = z.object({ ...ExecutableSourceBase, action: z.literal("internal_link"), ruleDomains: z.tuple([z.literal("internal_links")]), linkTargetUrl: GovernedUrl, linkAnchor: z.string().min(1) }).strict();
const SupersedableInternalLinkSourceSchema = z.union([LegacyInternalLinkSourceSchema, CurrentInternalLinkSourceSchema]);
const AdvisorySourceSchema = z.object({ source: z.literal("topical-map"), strategyVersionId: z.string().min(1), packageSha256: Hash, ruleIds: z.array(z.string().min(1)).min(1), ruleDomains: z.array(AdvisoryDomain).min(1), sourceReferences: SourceReferences, generationProvenance: GenerationProvenance, targetType: AdvisoryTargetType, targetUrl: GovernedUrl, executable: z.literal(false), advisoryReason: AdvisoryReason, resolutionStatus: ResolutionStatus.optional(), mapPriority: z.string().min(1).max(40).optional(), proposedCanonicalUrl: GovernedUrl.optional(), mapDecision: z.string().min(1).max(500).optional(), mapEvidence: z.string().min(1).max(2_000).optional(), mapPublishingState: z.string().min(1).max(100).optional(), mapProposedRedirectTarget: GovernedUrl.optional(), observedRedirectTarget: GovernedUrl.optional(), observedRedirectId: z.string().min(1).max(500).optional(), observedAt: z.string().datetime().optional(), observedStateHash: Hash.optional() }).strict();
export const TopicalMapStoreTaskSourceSchema = z.union([
  ExecutableSourceSchema,
  InternalLinkReplacementSourceSchema,
  RedirectExecutableSourceSchema,
  RedirectUpdateExecutableSourceSchema,
  RedirectDeleteExecutableSourceSchema,
  AdvisorySourceSchema,
]);

export const TopicalMapStoreTaskProposedSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("seo_update"), before: SeoBefore, after: SeoAfter }).strict(),
  z.object({ action: z.literal("content_update"), before: BodyBefore, after: BodyAfter }).strict(),
  z.object({ action: z.literal("internal_link"), before: BodyBefore, after: BodyAfter }).strict(),
  z.object({ action: z.literal("internal_link_replace"), before: BodyBefore, after: BodyAfter }).strict(),
  z.object({ action: z.literal("redirect_create"), before: z.object({ state: z.literal("absent") }).strict(), after: z.object({ target: GovernedUrl }).strict() }).strict(),
  z.object({ action: z.literal("redirect_update"), before: z.object({ id: z.string().min(1).max(500), target: GovernedUrl }).strict(), after: z.object({ target: GovernedUrl }).strict() }).strict(),
  z.object({ action: z.literal("redirect_delete"), before: z.object({ id: z.string().min(1).max(500), target: GovernedUrl }).strict(), after: z.object({ state: z.literal("absent") }).strict() }).strict(),
  z.object({ action: z.literal("advisory"), advisory: AdvisoryReason }).strict(),
]);

const DraftResponse = z.object({ drafts: z.array(z.object({
  url: GovernedUrl, seoTitle: z.string().min(1).max(70).optional(), seoDescription: z.string().min(1).max(160).optional(), sectionText: z.string().min(1).max(1000).optional(),
}).strict()).max(25) }).strict().superRefine((value, ctx) => {
  const urls = value.drafts.map((draft) => path(draft.url));
  if (new Set(urls).size !== urls.length) ctx.addIssue({ code: "custom", message: "Draft URLs must be unique", path: ["drafts"] });
});

type Client = {
  topicalMapActivation: { findUnique(args: unknown): Promise<unknown> };
  storeTask: {
    findUnique(args: { where: { dedupeKey: string } }): Promise<{ id?: string; status: string; sourceData?: unknown; proposedState?: unknown; priority?: string } | null>;
    findMany?(args: unknown): Promise<Array<{ id: string; createdAt?: Date; status: string; sourceData: unknown }>>;
    upsert(args: unknown): Promise<unknown>;
    update?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
  };
  auditLog?: { create(args: unknown): Promise<unknown> };
  $transaction?<T>(run: (tx: Client) => Promise<T>): Promise<T>;
  rawSnapshot?: { findFirst(args: unknown): Promise<{ id: string } | null> };
  recommendation?: {
    findFirst(args: unknown): Promise<{ id: string; status: string } | null>;
    findUnique?(args: unknown): Promise<{ id: string; status: string } | null>;
    create(args: unknown): Promise<{ id: string; status: string }>;
    updateMany?(args: unknown): Promise<{ count: number }>;
  };
};
type Summary = { executable: number; advisory: number; unchanged: number; suppressed: number };
type RuleDomain = "content_decisions" | "internal_links" | z.infer<typeof AdvisoryDomain>;
type TaskTargetType = z.infer<typeof TargetType> | z.infer<typeof AdvisoryTargetType>;
type TaskAdvisoryReason = z.infer<typeof AdvisoryReason>;
type CandidateLink = { toUrl: string; anchor: string; ruleIds: string[]; currentBodyState?: string; linkPurpose?: string; requiredAction?: string; verification?: string; priority?: string; resolutionStatus?: TopicalMapResolutionStatus };
type Candidate = { targetType: TaskTargetType; targetUrl: string; ruleIds: string[]; ruleDomains: RuleDomain[]; priority: string; action: TopicalMapStoreAction | "advisory"; advisoryReason?: TaskAdvisoryReason; resolutionStatus?: TopicalMapResolutionStatus; resource?: GovernedStoreResource; theme?: string; links?: CandidateLink[]; replacements?: ExactInternalLinkReplacement[]; redirectTarget?: string; liveOwnerUrl?: string; observedRedirectTarget?: string; observedRedirectId?: string; observedAt?: Date; observedStateHash?: string; proposedCanonicalUrl?: string; mapDecision?: string; mapEvidence?: string; mapPublishingState?: string };
type Persisted = { targetType: string; targetUrl: string; priority: string; ruleIds: string[]; ruleDomains: string[]; sourceData: z.infer<typeof TopicalMapStoreTaskSourceSchema>; proposedState: z.infer<typeof TopicalMapStoreTaskProposedSchema> };

function path(value: string): string {
  const normalized = normalizeGovernedUrl(value);
  if (normalized.startsWith("/")) return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
  const parsed = new URL(normalized);
  return (parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/, "") : parsed.pathname) + parsed.search + parsed.hash;
}
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function hashTopicalMapProposedState(value: unknown): string { return hash(canonical(TopicalMapStoreTaskProposedSchema.parse(value))); }
function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
export function appendInternalLinkMarkup(bodyHtml: string, targetUrl: string, links: Array<{ toUrl: string; anchor: string }>): string {
  const linkMarkup = links.length === 1
    ? `<p><a href="${escapeHtml(links[0]!.toUrl)}">${escapeHtml(links[0]!.anchor)}</a></p>`
    : `<section class="ag-related-recipes" aria-labelledby="ag-related-recipes-title"><h2 id="ag-related-recipes-title">${targetUrl === "/pages/red-rice-recipes" ? "Explore More Red Rice Recipes" : "Explore Related Resources"}</h2><ul>${links.map((link) => `<li><a href="${escapeHtml(link.toUrl)}">${escapeHtml(link.anchor)}</a></li>`).join("")}</ul></section>`;
  return `${bodyHtml}${linkMarkup}`;
}
export function classifyTopicalMapPageAction(decision?: string | null): "seo_update" | "content_update" | null {
  const instruction = decision?.trim().toLowerCase() ?? "";
  if (!instruction || /\b(keep|preserve|redirect|noindex|indexation|unpublish(?:ed)?|unless|conditional(?:ly)?)\b/.test(instruction)) return null;
  if (/\b(update|improve|refresh|rewrite|add)\b.*\b(seo metadata|meta title|meta description|seo title|seo description)\b/.test(instruction)) return "seo_update";
  if (/\bexpand content\b/.test(instruction) || /\b(update|refresh|expand|rewrite|add)\b.*\b(body content|page content|copy|content section|section content)\b/.test(instruction)) return "content_update";
  return null;
}
function grounded(draft: z.infer<typeof DraftResponse>["drafts"][number], candidate: Candidate): boolean {
  const haystack = `${draft.seoTitle ?? ""} ${draft.seoDescription ?? ""} ${draft.sectionText ?? ""}`.toLowerCase();
  const terms = `${candidate.theme ?? ""} ${candidate.resource?.title ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 4);
  return terms.some((term) => haystack.includes(term));
}

function candidates(center: TopicalMapCommandCenter): { items: Candidate[]; suppressed: number } {
  const result: Candidate[] = [];
  let suppressed = 0;
  for (const page of center.pages) {
    const url = path(page.url);
    if (/^\/blogs\/[^/]+\/[^/]+/.test(url)) continue;
    if (!page.contentDecisionPolicy) continue;
    const eligibility = topicalMapActionEligibility(page.contentDecisionPolicy);
    if (!eligibility.actionable) {
      const target = resolveGovernedStoreUrl(url);
      const targetType = url === "/" ? "homepage" : /^\/blogs\/[^/]+$/.test(url) ? "blog_index" : target?.type;
      if (targetType) result.push({ targetType, targetUrl: url, ruleIds: [...page.ruleIds].sort(), ruleDomains: ["content_decisions"], priority: page.priority ?? "medium", action: "advisory", advisoryReason: eligibility.reason, resolutionStatus: page.contentDecisionPolicy.resolutionStatus });
      continue;
    }
    if (url === "/" || /^\/blogs\/[^/]+$/.test(url)) {
      result.push({ targetType: url === "/" ? "homepage" : "blog_index", targetUrl: url, ruleIds: [...page.ruleIds].sort(), ruleDomains: ["content_decisions"], priority: page.priority ?? "medium", action: "advisory", advisoryReason: url === "/" ? "homepage_not_governed" : "blog_index_not_governed", resolutionStatus: page.contentDecisionPolicy.resolutionStatus });
      continue;
    }
    const target = resolveGovernedStoreUrl(url);
    if (!target || !(page.ruleDomains.content_decisions?.length)) continue;
    const action = classifyTopicalMapPageAction(page.decision);
    if (!action) continue;
    result.push({ targetType: target.type, targetUrl: url, ruleIds: [...page.ruleDomains.content_decisions].sort(), ruleDomains: ["content_decisions"], priority: page.priority ?? "medium", action, theme: page.primaryKeywordOrTheme, resolutionStatus: page.contentDecisionPolicy.resolutionStatus });
  }
  const linkGroups = new Map<string, Candidate>();
  for (const link of center.work.internalLinks) {
    const fromUrl = path(link.fromUrl);
    if (/^\/blogs\/[^/]+\/[^/]+/.test(fromUrl)) continue;
    const target = resolveGovernedStoreUrl(fromUrl);
    if (!target) continue;
    if (!topicalMapInternalLinkEligibility(link.policy, link.currentBodyState, link.requiredAction).actionable) {
      suppressed++;
      continue;
    }
    if (!topicalMapInternalLinkRequiresAddition(link.requiredAction)) continue;
    const current = linkGroups.get(fromUrl) ?? { targetType: target.type, targetUrl: fromUrl, ruleIds: [], ruleDomains: ["internal_links"], priority: link.priority ?? "medium", action: "internal_link", links: [] };
    current.ruleIds.push(...link.ruleIds);
    current.links!.push({ toUrl: path(link.toUrl), anchor: link.recommendedAnchor ?? link.toUrl, ruleIds: [...link.ruleIds], currentBodyState: link.currentBodyState, linkPurpose: link.linkPurpose, requiredAction: link.requiredAction, verification: link.verification, priority: link.priority, resolutionStatus: link.policy.resolutionStatus });
    linkGroups.set(fromUrl, current);
  }
  for (const group of linkGroups.values()) {
    group.ruleIds = [...new Set(group.ruleIds)].sort();
    const uniqueLinks = new Map<string, CandidateLink>();
    for (const link of group.links!) {
      const key = `${link.toUrl}\u0000${link.anchor}`;
      const existing = uniqueLinks.get(key);
      uniqueLinks.set(key, existing ? { ...existing, ruleIds: [...new Set([...existing.ruleIds, ...link.ruleIds])].sort() } : { ...link, ruleIds: [...new Set(link.ruleIds)].sort() });
    }
    group.links = [...uniqueLinks.values()].sort((a, b) => a.toUrl.localeCompare(b.toUrl) || a.anchor.localeCompare(b.anchor));
    result.push(group);
  }
  const advisory = (rule: { currentUrl: string; proposedCanonicalUrl: string; publishingState?: string; decision?: string; evidence?: string; priority?: string; ruleIds: string[] }, ruleDomain: "canonicalization" | "indexation", reason: TaskAdvisoryReason) => result.push({ targetType: "technical", targetUrl: path(rule.currentUrl), ruleIds: [...rule.ruleIds].sort(), ruleDomains: [ruleDomain], priority: rule.priority ?? "medium", action: "advisory", advisoryReason: reason, proposedCanonicalUrl: path(rule.proposedCanonicalUrl), mapDecision: rule.decision, mapEvidence: rule.evidence, mapPublishingState: rule.publishingState });
  for (const rule of center.work.canonicalization) advisory(rule, "canonicalization", "canonicalization_execution_prohibited");
  for (const rule of center.work.indexation) advisory(rule, "indexation", "indexation_execution_prohibited");
  return { items: result.sort((a, b) => a.targetUrl.localeCompare(b.targetUrl) || a.action.localeCompare(b.action) || a.ruleIds.join().localeCompare(b.ruleIds.join())), suppressed };
}

function advisory(center: TopicalMapCommandCenter, item: Candidate, reason: TaskAdvisoryReason): Persisted {
  return { targetType: item.targetType, targetUrl: item.targetUrl, priority: item.priority, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains,
    sourceData: TopicalMapStoreTaskSourceSchema.parse({ source: "topical-map", strategyVersionId: center.identity.versionId, packageSha256: center.identity.packageSha256, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains, sourceReferences: item.ruleIds.slice(0, 25).map((id) => ({ kind: "rule", id })), generationProvenance: "advisory_projection", targetType: item.targetType, targetUrl: item.targetUrl, executable: false, advisoryReason: reason, ...(item.resolutionStatus ? { resolutionStatus: item.resolutionStatus } : {}), ...(item.proposedCanonicalUrl ? { mapPriority: item.priority, proposedCanonicalUrl: item.proposedCanonicalUrl, ...(item.mapDecision ? { mapDecision: item.mapDecision } : {}), ...(item.mapEvidence ? { mapEvidence: item.mapEvidence } : {}), ...(item.mapPublishingState ? { mapPublishingState: item.mapPublishingState } : {}) } : {}), ...(item.redirectTarget ? { mapProposedRedirectTarget: item.redirectTarget } : {}), ...(item.observedRedirectTarget ? { observedRedirectTarget: item.observedRedirectTarget } : {}), ...(item.observedRedirectId ? { observedRedirectId: item.observedRedirectId } : {}), ...(item.observedAt ? { observedAt: item.observedAt.toISOString() } : {}), ...(item.observedStateHash ? { observedStateHash: item.observedStateHash } : {}) }),
    proposedState: { action: "advisory", advisory: reason },
  };
}

async function supersedeObsoleteLinkTasks(client: Client, center: TopicalMapCommandCenter, task: Persisted, replacementId: string, replacementRecommendationId?: string): Promise<void> {
  if (task.proposedState.action !== "internal_link" || !client.storeTask.findMany || !client.storeTask.updateMany || !client.auditLog || !client.$transaction) return;
  const rows = await client.storeTask.findMany({ where: { taskType: "topical_map", targetUrl: task.targetUrl, status: { in: ["pending", "failed"] } }, select: { id: true, status: true, sourceData: true } });
  for (const row of rows) {
    if (row.id === replacementId) continue;
    const parsed = SupersedableInternalLinkSourceSchema.safeParse(row.sourceData);
    if (!parsed.success || parsed.data.strategyVersionId !== center.identity.versionId || parsed.data.packageSha256 !== center.identity.packageSha256) continue;
    let recommendation: { id: string; status: string } | null = null;
    if (parsed.data.recommendationId && client.recommendation?.findUnique) {
      recommendation = await client.recommendation.findUnique({ where: { id: parsed.data.recommendationId }, select: { id: true, status: true } });
      if (recommendation && ["approved", "override_approved", "executing"].includes(recommendation.status)) continue;
    }
    await client.$transaction(async (tx) => {
      const note = `Superseded by grouped topical-map internal-link task ${replacementId}`;
      const updated = await tx.storeTask.updateMany!({ where: { id: row.id, status: { in: ["pending", "failed"] } }, data: { status: "dismissed", completionNote: note, completedAt: new Date() } });
      if (updated.count !== 1) return;
      await tx.auditLog!.create({ data: { actor: "topical-map-sync", action: "topical_map_store_task_superseded", entityType: "StoreTask", entityId: row.id, before: { status: row.status }, after: { status: "dismissed", replacementTaskId: replacementId }, meta: { strategyVersionId: center.identity.versionId, packageSha256: center.identity.packageSha256, targetUrl: task.targetUrl } } });
      if (recommendation && tx.recommendation?.updateMany) {
        const rejected = await tx.recommendation.updateMany({ where: { id: recommendation.id, status: { in: ["pending", "failed"] } }, data: { status: "rejected", reviewedBy: "topical-map-sync", reviewedAt: new Date(), reviewNote: note } });
        if (rejected.count === 1) await tx.auditLog!.create({ data: { actor: "topical-map-sync", action: "topical_map_recommendation_superseded", entityType: "recommendation", entityId: recommendation.id, before: { status: recommendation.status }, after: { status: "rejected", replacementTaskId: replacementId, replacementRecommendationId: replacementRecommendationId ?? null }, meta: { strategyVersionId: center.identity.versionId, packageSha256: center.identity.packageSha256, targetUrl: task.targetUrl } } });
      }
    });
  }
}

export async function syncTopicalMapStoreTasks(client: Client): Promise<Summary> {
  const summary: Summary = { executable: 0, advisory: 0, unchanged: 0, suppressed: 0 };
  const center = await loadActiveTopicalMapCommandCenter(client);
  if (!center) return summary;
  const candidateProjection = candidates(center);
  const projected = candidateProjection.items;
  summary.suppressed += candidateProjection.suppressed;
  const redirectSources = [...new Set(center.work.redirects.map(rule => path(rule.source)))];
  const observedRedirects = await fetchGovernedRedirects(redirectSources);
  for (const rule of center.work.redirects) {
    const source = path(rule.source);
    const target = path(rule.finalTarget);
    const observed = observedRedirects.get(source);
    const eligibility = topicalMapActionEligibility(rule.policy);
    if (observed) {
      if (eligibility.actionable && topicalMapRedirectRequiresDelete(rule.requiredAction)) {
        projected.push({ targetType: "redirect", targetUrl: source, ruleIds: [...rule.ruleIds].sort(), ruleDomains: ["redirects"], priority: rule.priority ?? "medium", action: "redirect_delete", resolutionStatus: "resolved", liveOwnerUrl: source, observedRedirectTarget: observed.target, observedRedirectId: observed.id, observedAt: observed.capturedAt, observedStateHash: observed.stateHash });
        continue;
      }
      if (observed.target === target) { summary.unchanged++; continue; }
      if (eligibility.actionable && topicalMapRedirectRequiresUpdate(rule.requiredAction)) {
        projected.push({ targetType: "redirect", targetUrl: source, ruleIds: [...rule.ruleIds].sort(), ruleDomains: ["redirects"], priority: rule.priority ?? "medium", action: "redirect_update", resolutionStatus: "resolved", redirectTarget: target, observedRedirectTarget: observed.target, observedRedirectId: observed.id, observedAt: observed.capturedAt, observedStateHash: observed.stateHash });
        continue;
      }
      projected.push({ targetType: "redirect", targetUrl: source, ruleIds: [...rule.ruleIds].sort(), ruleDomains: ["redirects"], priority: rule.priority ?? "medium", action: "advisory", advisoryReason: "redirect_conflict", resolutionStatus: rule.policy.resolutionStatus, redirectTarget: target, observedRedirectTarget: observed.target, observedRedirectId: observed.id, observedAt: observed.capturedAt, observedStateHash: observed.stateHash });
      continue;
    }
    const observedAt = new Date();
    const observedStateHash = hash(canonical({ source, state: "absent" }));
    if (!eligibility.actionable) {
      projected.push({ targetType: "redirect", targetUrl: source, ruleIds: [...rule.ruleIds].sort(), ruleDomains: ["redirects"], priority: rule.priority ?? "medium", action: "advisory", advisoryReason: eligibility.reason, resolutionStatus: rule.policy.resolutionStatus, redirectTarget: target, observedAt, observedStateHash });
      continue;
    }
    projected.push({ targetType: "redirect", targetUrl: source, ruleIds: [...rule.ruleIds].sort(), ruleDomains: ["redirects"], priority: rule.priority ?? "medium", action: "redirect_create", resolutionStatus: rule.policy.resolutionStatus, redirectTarget: target, observedAt, observedStateHash });
  }
  const replacementGroups = new Map<string, Candidate>();
  for (const redirect of center.work.redirects) {
    const legacyUrl = path(redirect.source);
    const finalTarget = path(redirect.finalTarget);
    const observed = observedRedirects.get(legacyUrl);
    if (
      !topicalMapActionEligibility(redirect.policy).actionable
      || !topicalMapRedirectRequiresLegacyLinkCleanup(redirect.requiredAction)
      || observed?.target !== finalTarget
    ) continue;
    for (const link of center.work.internalLinks) {
      const fromUrl = path(link.fromUrl);
      if (
        path(link.toUrl) !== finalTarget
        || !topicalMapInternalLinkEligibility(link.policy, link.currentBodyState, link.requiredAction).actionable
        || !topicalMapInternalLinkRequiresReplacement(link.requiredAction)
      ) continue;
      const target = resolveGovernedStoreUrl(fromUrl);
      if (!target) continue;
      const current = replacementGroups.get(fromUrl) ?? {
        targetType: target.type,
        targetUrl: fromUrl,
        ruleIds: [],
        ruleDomains: ["internal_links", "redirects"],
        priority: link.priority ?? redirect.priority ?? "medium",
        action: "internal_link_replace",
        resolutionStatus: "resolved",
        replacements: [],
      };
      current.ruleIds.push(...link.ruleIds, ...redirect.ruleIds);
      current.replacements!.push({ fromUrl: legacyUrl, toUrl: finalTarget });
      replacementGroups.set(fromUrl, current);
    }
  }
  for (const group of replacementGroups.values()) {
    group.ruleIds = [...new Set(group.ruleIds)].sort();
    group.replacements = [...new Map(group.replacements!.map((replacement) => [
      `${replacement.fromUrl}\u0000${replacement.toUrl}`,
      replacement,
    ])).values()].sort((a, b) => a.fromUrl.localeCompare(b.fromUrl) || a.toUrl.localeCompare(b.toUrl));
    projected.push(group);
  }
  projected.sort((a, b) => a.targetUrl.localeCompare(b.targetUrl) || a.action.localeCompare(b.action) || a.ruleIds.join().localeCompare(b.ruleIds.join()));
  const governedUrls = [...new Set(projected.filter((item) =>
    item.action === "seo_update"
    || item.action === "content_update"
    || item.action === "internal_link"
    || item.action === "internal_link_replace"
    || item.action === "redirect_delete"
  ).map((item) => item.targetUrl))];
  const resources = await fetchGovernedStoreResources(governedUrls);
  const viable: Candidate[] = [];
  for (const item of projected) {
    if (item.action === "advisory") { viable.push(item); continue; }
    if (item.action === "redirect_create" || item.action === "redirect_update") { viable.push(item); continue; }
    const resource = resources.get(item.targetUrl);
    if (!resource) { summary.suppressed++; continue; }
    item.resource = resource;
    if (item.action === "internal_link") {
      const existingTargets = new Set(resource.internalTargets.map(path));
      item.links = item.links!.filter((link) => !existingTargets.has(link.toUrl));
      if (!item.links.length) { summary.unchanged++; continue; }
      item.ruleIds = [...new Set(item.links.flatMap((link) => link.ruleIds))].sort();
    }
    if (item.action === "redirect_delete" && (resource.type !== "page" || item.liveOwnerUrl !== resource.url)) {
      summary.suppressed++;
      continue;
    }
    if (item.action === "internal_link_replace") {
      const exact = replaceExactInternalLinkTargets(resource.bodyHtml, item.replacements!);
      if (!exact.changed) { summary.unchanged++; continue; }
      if (exact.bodyHtml.length > 50_000) { summary.suppressed++; continue; }
    }
    viable.push(item);
  }

  const draftCandidates = viable.filter((item) => item.action === "seo_update" || item.action === "content_update");
  const drafts = new Map<string, z.infer<typeof DraftResponse>["drafts"][number]>();
  for (let offset = 0; offset < draftCandidates.length; offset += 25) {
    const chunk = draftCandidates.slice(offset, offset + 25);
    try {
      const request = JSON.stringify({ draftsRequested: chunk.map((item) => ({ url: item.targetUrl, action: item.action, theme: item.theme?.slice(0, 300), current: { title: item.resource!.title.slice(0, 300), seoTitle: item.resource!.seoTitle?.slice(0, 300), seoDescription: item.resource!.seoDescription?.slice(0, 500), bodyExcerpt: item.resource!.bodyHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1500) } })) });
      if (request.length > 60_000) throw new Error("Draft request exceeds bounded size");
      const response = await chatCompletionWithFailover({ messages: [{ role: "system", content: "Return strict JSON only. Draft bounded SEO metadata or additive plain sectionText. Never return HTML, handles, or publication fields." }, { role: "user", content: request }], response_format: { type: "json_object" } });
      const parsed = DraftResponse.safeParse(JSON.parse(response.content));
      if (parsed.success && parsed.data.drafts.every((draft) => chunk.some((item) => item.targetUrl === path(draft.url)))) {
        for (const draft of parsed.data.drafts) drafts.set(path(draft.url), draft);
      }
    } catch { /* draft-dependent work becomes advisory below */ }
  }

  const tasks: Persisted[] = viable.map((item) => {
    if (item.action === "advisory") return advisory(center, item, item.advisoryReason!);
    if (item.action === "redirect_create") {
      return {
        targetType: "redirect", targetUrl: item.targetUrl, priority: item.priority, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains,
        sourceData: TopicalMapStoreTaskSourceSchema.parse({ source: "topical-map", strategyVersionId: center.identity.versionId, packageSha256: center.identity.packageSha256, ruleIds: item.ruleIds, ruleDomains: ["redirects"], sourceReferences: item.ruleIds.slice(0, 25).map((id) => ({ kind: "rule", id })), generationProvenance: "deterministic", targetType: "redirect", targetUrl: item.targetUrl, action: "redirect_create", resolutionStatus: item.resolutionStatus, redirectTarget: item.redirectTarget, observedAt: item.observedAt!.toISOString(), observedStateHash: item.observedStateHash, executable: true }),
        proposedState: { action: "redirect_create", before: { state: "absent" }, after: { target: item.redirectTarget! } },
      };
    }
    if (item.action === "redirect_update") {
      return {
        targetType: "redirect", targetUrl: item.targetUrl, priority: item.priority, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains,
        sourceData: TopicalMapStoreTaskSourceSchema.parse({ source: "topical-map", strategyVersionId: center.identity.versionId, packageSha256: center.identity.packageSha256, ruleIds: item.ruleIds, ruleDomains: ["redirects"], sourceReferences: item.ruleIds.slice(0, 25).map((id) => ({ kind: "rule", id })), generationProvenance: "deterministic", targetType: "redirect", targetUrl: item.targetUrl, action: "redirect_update", redirectId: item.observedRedirectId, observedRedirectTarget: item.observedRedirectTarget, redirectTarget: item.redirectTarget, observedAt: item.observedAt!.toISOString(), observedStateHash: item.observedStateHash, executable: true, resolutionStatus: "resolved" }),
        proposedState: { action: "redirect_update", before: { id: item.observedRedirectId!, target: item.observedRedirectTarget! }, after: { target: item.redirectTarget! } },
      };
    }
    if (item.action === "redirect_delete") {
      return {
        targetType: "redirect", targetUrl: item.targetUrl, priority: item.priority, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains,
        sourceData: TopicalMapStoreTaskSourceSchema.parse({ source: "topical-map", strategyVersionId: center.identity.versionId, packageSha256: center.identity.packageSha256, ruleIds: item.ruleIds, ruleDomains: ["redirects"], sourceReferences: item.ruleIds.slice(0, 25).map((id) => ({ kind: "rule", id })), generationProvenance: "deterministic", targetType: "redirect", targetUrl: item.targetUrl, action: "redirect_delete", redirectId: item.observedRedirectId, observedRedirectTarget: item.observedRedirectTarget, liveOwnerUrl: item.liveOwnerUrl, observedAt: item.observedAt!.toISOString(), observedStateHash: item.observedStateHash, executable: true, resolutionStatus: "resolved" }),
        proposedState: { action: "redirect_delete", before: { id: item.observedRedirectId!, target: item.observedRedirectTarget! }, after: { state: "absent" } },
      };
    }
    const resource = item.resource!;
    const sourceData = TopicalMapStoreTaskSourceSchema.parse({
      source: "topical-map",
      strategyVersionId: center.identity.versionId,
      packageSha256: center.identity.packageSha256,
      ruleIds: item.ruleIds,
      ruleDomains: item.ruleDomains,
      sourceReferences: item.ruleIds.slice(0, 25).map((id) => ({ kind: "rule", id })),
      generationProvenance: item.action === "internal_link" || item.action === "internal_link_replace" ? "deterministic" : "bounded_ai_draft",
      targetType: resource.type,
      targetUrl: item.targetUrl,
      action: item.action,
      resolutionStatus: item.resolutionStatus,
      ...(item.action === "internal_link" ? { links: item.links!.map(({ toUrl, anchor, currentBodyState, linkPurpose, requiredAction, verification, priority, resolutionStatus }) => ({ toUrl, anchor, ...(currentBodyState ? { currentBodyState } : {}), ...(linkPurpose ? { linkPurpose } : {}), ...(requiredAction ? { requiredAction } : {}), ...(verification ? { verification } : {}), ...(priority ? { priority } : {}), ...(resolutionStatus ? { resolutionStatus } : {}) })) } : {}),
      ...(item.action === "internal_link_replace" ? { replacements: item.replacements } : {}),
      observedAt: resource.capturedAt.toISOString(),
      observationProvenance: `shopify_governed_resource:${item.targetUrl}`,
      resourceUpdatedAt: resource.updatedAt.toISOString(),
      observedStateHash: resource.stateHash,
      executable: true,
    });
    if (item.action === "internal_link") {
      const bodyHtml = appendInternalLinkMarkup(resource.bodyHtml, item.targetUrl, item.links!);
      if (bodyHtml.length > 50_000) return advisory(center, item, "draft_unavailable");
      return { targetType: resource.type, targetUrl: item.targetUrl, priority: item.priority, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains, sourceData, proposedState: { action: item.action, before: { bodyHtml: resource.bodyHtml }, after: { bodyHtml } } };
    }
    if (item.action === "internal_link_replace") {
      const replaced = replaceExactInternalLinkTargets(resource.bodyHtml, item.replacements!);
      return { targetType: resource.type, targetUrl: item.targetUrl, priority: item.priority, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains, sourceData, proposedState: { action: item.action, before: { bodyHtml: resource.bodyHtml }, after: { bodyHtml: replaced.bodyHtml } } };
    }
    const draft = drafts.get(item.targetUrl);
    if (!draft || !grounded(draft, item) || (item.action === "seo_update" && (!draft.seoTitle || !draft.seoDescription)) || (item.action === "content_update" && !draft.sectionText)) return advisory(center, item, "draft_unavailable");
    if (item.action === "seo_update") return { targetType: resource.type, targetUrl: item.targetUrl, priority: item.priority, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains, sourceData, proposedState: { action: item.action, before: { seoTitle: resource.seoTitle, seoDescription: resource.seoDescription }, after: { seoTitle: draft.seoTitle!, seoDescription: draft.seoDescription! } } };
    const bodyHtml = `${resource.bodyHtml}<section><p>${escapeHtml(draft.sectionText!)}</p></section>`;
    if (bodyHtml.length > 50_000) return advisory(center, item, "draft_unavailable");
    return { targetType: resource.type, targetUrl: item.targetUrl, priority: item.priority, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains, sourceData, proposedState: { action: item.action, before: { bodyHtml: resource.bodyHtml }, after: { bodyHtml } } };
  });

  for (const task of tasks) {
    const checkedSource = TopicalMapStoreTaskSourceSchema.parse(task.sourceData);
    const checkedProposed = TopicalMapStoreTaskProposedSchema.parse(task.proposedState);
    const proposedHash = hashTopicalMapProposedState(checkedProposed);
    const advisorySemanticKey = checkedSource.executable ? null : topicalMapAdvisorySemanticKey({
      strategyVersionId: center.identity.versionId,
      packageSha256: center.identity.packageSha256,
      targetUrl: task.targetUrl,
      advisoryReason: checkedSource.advisoryReason,
      ruleIds: task.ruleIds,
    });
    const dedupeKey = advisorySemanticKey
      ? `store-task:topical-map:advisory:${advisorySemanticKey}`
      : `store-task:topical-map:${hash(canonical([center.identity.versionId, center.identity.packageSha256, checkedProposed.action === "internal_link" ? "grouped-links-v1" : checkedProposed.action === "internal_link_replace" ? "grouped-replacements-v1" : "v1", [...task.ruleIds].sort(), path(task.targetUrl), checkedProposed.action]))}`;
    const existing = await client.storeTask.findUnique({ where: { dedupeKey } });
    if (existing && !["pending", "failed"].includes(existing.status)) { summary.unchanged++; continue; }
    if (existing?.id && advisorySemanticKey && client.storeTask.findMany && client.storeTask.updateMany && client.recommendation?.updateMany && client.auditLog && client.$transaction) {
      await supersedeEquivalentAdvisories(client as unknown as AdvisoryDatabase, {
        semanticKey: advisorySemanticKey,
        actor: "topical-map-sync",
      });
      const retained = await client.storeTask.findUnique({ where: { dedupeKey } });
      const refreshable = task.ruleDomains.some(domain => domain === "canonicalization" || domain === "indexation");
      if (!retained || !["pending", "failed"].includes(retained.status) || !refreshable) { summary.unchanged++; continue; }
      const unchanged = retained.priority === task.priority
        && canonical(retained.sourceData) === canonical(checkedSource)
        && canonical(retained.proposedState) === canonical(checkedProposed);
      if (unchanged) { summary.unchanged++; continue; }
    }
    if (existing?.sourceData && client.recommendation?.findUnique) {
      const existingSource = TopicalMapStoreTaskSourceSchema.safeParse(existing.sourceData);
      if (existingSource.success && existingSource.data.executable && existingSource.data.recommendationId) {
        const linked = await client.recommendation.findUnique({ where: { id: existingSource.data.recommendationId }, select: { id: true, status: true } });
        if (linked && ["approved", "override_approved", "executing"].includes(linked.status)) { summary.unchanged++; continue; }
      }
    }
    const sourceWithHash = checkedSource;
    const persisted = await client.storeTask.upsert({ where: { dedupeKey }, create: { taskType: "topical_map", targetType: task.targetType, targetId: null, targetUrl: task.targetUrl, title: checkedSource.executable ? `Review topical-map ${checkedProposed.action}` : "Review topical-map advisory", description: checkedSource.executable ? `Review the governed ${checkedProposed.action} for ${task.targetUrl}.` : checkedSource.advisoryReason, proposedState: checkedProposed, sourceData: sourceWithHash, priority: task.priority, status: "pending", dedupeKey }, update: { taskType: "topical_map", targetType: task.targetType, targetUrl: task.targetUrl, title: checkedSource.executable ? `Review topical-map ${checkedProposed.action}` : "Review topical-map advisory", description: checkedSource.executable ? `Review the governed ${checkedProposed.action} for ${task.targetUrl}.` : checkedSource.advisoryReason, proposedState: checkedProposed, sourceData: sourceWithHash, priority: task.priority, status: "pending", completionNote: null, completedAt: null } }) as { id?: string } | undefined;
    if (persisted?.id && advisorySemanticKey && client.storeTask.findMany && client.storeTask.updateMany && client.recommendation?.updateMany && client.auditLog && client.$transaction) {
      await supersedeEquivalentAdvisories(client as unknown as AdvisoryDatabase, {
        semanticKey: advisorySemanticKey,
        actor: "topical-map-sync",
      });
    }
    let replacementRecommendationId: string | undefined;
    if (checkedSource.executable && persisted?.id && client.recommendation && client.rawSnapshot && client.storeTask.update) {
      const snapshot = await client.rawSnapshot.findFirst({ where: { source: "seo_analysis" }, orderBy: { fetchedAt: "desc" }, select: { id: true } });
      if (!snapshot) { summary.suppressed++; continue; }
      let recommendation = await client.recommendation.findFirst({ where: { platform: "shopify", actionType: "apply_topical_map_store_task", targetEntityId: persisted.id, status: { in: ["pending", "approved", "override_approved"] } }, select: { id: true, status: true } });
      if (!recommendation && checkedProposed.action !== "advisory") recommendation = await client.recommendation.create({ data: { platform: "shopify", skillId: "topical-map-store-task", skillName: "Governed topical-map Store Task", actionType: "apply_topical_map_store_task", targetEntityType: "store_task", targetEntityId: persisted.id, targetEntityName: task.targetUrl, currentValue: JSON.stringify(checkedProposed.before), proposedValue: JSON.stringify({ taskId: persisted.id, proposedStateHash: proposedHash }), rationale: `Apply the exact governed ${checkedProposed.action} after operator approval.`, guardStatus: "clear", status: "pending", snapshotId: snapshot.id } });
      if (!recommendation) { summary.suppressed++; continue; }
      replacementRecommendationId = recommendation.id;
      await client.storeTask.update({ where: { id: persisted.id }, data: { sourceData: { ...sourceWithHash, recommendationId: recommendation.id } } });
    }
    if (checkedSource.executable && checkedProposed.action === "internal_link" && persisted?.id) await supersedeObsoleteLinkTasks(client, center, task, persisted.id, replacementRecommendationId);
    if (checkedSource.executable) summary.executable++; else summary.advisory++;
  }
  return summary;
}
