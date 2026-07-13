import { createHash } from "node:crypto";
import { z } from "zod";
import { chatCompletionWithFailover } from "@/lib/ai/client";
import { fetchGovernedStoreResources, resolveGovernedStoreUrl, type GovernedStoreResource } from "@/lib/shopify-governed-resources";
import { loadActiveTopicalMapCommandCenter, type CommandCenterPage, type TopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";

export type TopicalMapStoreAction = "seo_update" | "content_update" | "internal_link";

const TargetType = z.enum(["product", "collection", "page"]);
const Hash = z.string().regex(/^[a-f0-9]{64}$/i);
const GovernedUrl = z.string().refine((value) => {
  try { return path(value).startsWith("/") && !value.toLowerCase().startsWith("javascript:"); } catch { return false; }
}, "Expected a governed URL");
const AdvisoryDomain = z.enum(["content_decisions", "redirects", "canonicalization", "indexation"]);
const AdvisoryTargetType = z.enum(["product", "collection", "page", "homepage", "blog_index", "redirect", "technical"]);
const AdvisoryReason = z.enum(["homepage_not_governed", "blog_index_not_governed", "redirect_execution_unsupported", "canonicalization_execution_prohibited", "indexation_execution_prohibited", "draft_unavailable"]);
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
  observedAt: z.string().datetime().refine((value) => new Date(value).getTime() <= Date.now() + 5 * 60_000, "Observation cannot be in the future"), observedStateHash: Hash, recommendationId: z.string().min(1).optional(), executable: z.literal(true),
};
const CurrentInternalLinkSourceSchema = z.object({ ...ExecutableSourceBase, action: z.literal("internal_link"), ruleDomains: z.tuple([z.literal("internal_links")]), links: z.array(z.object({ toUrl: GovernedUrl, anchor: z.string().min(1) }).strict()).min(1).max(100) }).strict();
const ExecutableSourceSchema = z.discriminatedUnion("action", [
  z.object({ ...ExecutableSourceBase, action: z.literal("seo_update"), ruleDomains: z.tuple([z.literal("content_decisions")]) }).strict(),
  z.object({ ...ExecutableSourceBase, action: z.literal("content_update"), ruleDomains: z.tuple([z.literal("content_decisions")]) }).strict(),
  CurrentInternalLinkSourceSchema,
]);
const LegacyInternalLinkSourceSchema = z.object({ ...ExecutableSourceBase, action: z.literal("internal_link"), ruleDomains: z.tuple([z.literal("internal_links")]), linkTargetUrl: GovernedUrl, linkAnchor: z.string().min(1) }).strict();
const SupersedableInternalLinkSourceSchema = z.union([LegacyInternalLinkSourceSchema, CurrentInternalLinkSourceSchema]);
const AdvisorySourceSchema = z.object({ source: z.literal("topical-map"), strategyVersionId: z.string().min(1), packageSha256: Hash, ruleIds: z.array(z.string().min(1)).min(1), ruleDomains: z.array(AdvisoryDomain).min(1), sourceReferences: SourceReferences, generationProvenance: GenerationProvenance, targetType: AdvisoryTargetType, targetUrl: GovernedUrl, executable: z.literal(false), advisoryReason: AdvisoryReason }).strict();
export const TopicalMapStoreTaskSourceSchema = z.union([ExecutableSourceSchema, AdvisorySourceSchema]);

export const TopicalMapStoreTaskProposedSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("seo_update"), before: SeoBefore, after: SeoAfter }).strict(),
  z.object({ action: z.literal("content_update"), before: BodyBefore, after: BodyAfter }).strict(),
  z.object({ action: z.literal("internal_link"), before: BodyBefore, after: BodyAfter }).strict(),
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
    findUnique(args: { where: { dedupeKey: string } }): Promise<{ id?: string; status: string; sourceData?: unknown } | null>;
    findMany?(args: unknown): Promise<Array<{ id: string; status: string; sourceData: unknown }>>;
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
  };
};
type Summary = { executable: number; advisory: number; unchanged: number; suppressed: number };
type RuleDomain = "content_decisions" | "internal_links" | z.infer<typeof AdvisoryDomain>;
type TaskTargetType = z.infer<typeof TargetType> | z.infer<typeof AdvisoryTargetType>;
type TaskAdvisoryReason = z.infer<typeof AdvisoryReason>;
type CandidateLink = { toUrl: string; anchor: string; ruleIds: string[] };
type Candidate = { targetType: TaskTargetType; targetUrl: string; ruleIds: string[]; ruleDomains: RuleDomain[]; priority: string; action: TopicalMapStoreAction | "advisory"; advisoryReason?: TaskAdvisoryReason; resource?: GovernedStoreResource; theme?: string; links?: CandidateLink[] };
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
function pageAction(page: CommandCenterPage): TopicalMapStoreAction {
  const decision = page.decision?.toLowerCase() ?? "";
  return /(seo|meta|title|description)/.test(decision) ? "seo_update" : "content_update";
}
function grounded(draft: z.infer<typeof DraftResponse>["drafts"][number], candidate: Candidate): boolean {
  const haystack = `${draft.seoTitle ?? ""} ${draft.seoDescription ?? ""} ${draft.sectionText ?? ""}`.toLowerCase();
  const terms = `${candidate.theme ?? ""} ${candidate.resource?.title ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 4);
  return terms.some((term) => haystack.includes(term));
}

function candidates(center: TopicalMapCommandCenter): Candidate[] {
  const result: Candidate[] = [];
  for (const page of center.pages) {
    const url = path(page.url);
    if (/^\/blogs\/[^/]+\/[^/]+/.test(url)) continue;
    if (url === "/" || /^\/blogs\/[^/]+$/.test(url)) {
      result.push({ targetType: url === "/" ? "homepage" : "blog_index", targetUrl: url, ruleIds: [...page.ruleIds].sort(), ruleDomains: ["content_decisions"], priority: page.priority ?? "medium", action: "advisory", advisoryReason: url === "/" ? "homepage_not_governed" : "blog_index_not_governed" });
      continue;
    }
    const target = resolveGovernedStoreUrl(url);
    if (!target || !(page.ruleDomains.content_decisions?.length)) continue;
    result.push({ targetType: target.type, targetUrl: url, ruleIds: [...page.ruleDomains.content_decisions].sort(), ruleDomains: ["content_decisions"], priority: page.priority ?? "medium", action: pageAction(page), theme: page.primaryKeywordOrTheme });
  }
  const linkGroups = new Map<string, Candidate>();
  for (const link of center.work.internalLinks) {
    const fromUrl = path(link.fromUrl);
    if (/^\/blogs\/[^/]+\/[^/]+/.test(fromUrl)) continue;
    const target = resolveGovernedStoreUrl(fromUrl);
    if (!target) continue;
    const current = linkGroups.get(fromUrl) ?? { targetType: target.type, targetUrl: fromUrl, ruleIds: [], ruleDomains: ["internal_links"], priority: link.priority ?? "medium", action: "internal_link", links: [] };
    current.ruleIds.push(...link.ruleIds);
    current.links!.push({ toUrl: path(link.toUrl), anchor: link.recommendedAnchor ?? link.toUrl, ruleIds: [...link.ruleIds] });
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
  const advisory = (targetUrl: string, ruleIds: string[], ruleDomain: z.infer<typeof AdvisoryDomain>, reason: TaskAdvisoryReason, targetType: z.infer<typeof AdvisoryTargetType>) => result.push({ targetType, targetUrl: path(targetUrl), ruleIds: [...ruleIds].sort(), ruleDomains: [ruleDomain], priority: "medium", action: "advisory", advisoryReason: reason });
  for (const rule of center.work.redirects) advisory(rule.source, rule.ruleIds, "redirects", "redirect_execution_unsupported", "redirect");
  for (const rule of center.work.canonicalization) advisory(rule.currentUrl, rule.ruleIds, "canonicalization", "canonicalization_execution_prohibited", "technical");
  for (const rule of center.work.indexation) advisory(rule.currentUrl, rule.ruleIds, "indexation", "indexation_execution_prohibited", "technical");
  return result.sort((a, b) => a.targetUrl.localeCompare(b.targetUrl) || a.action.localeCompare(b.action) || a.ruleIds.join().localeCompare(b.ruleIds.join()));
}

function advisory(center: TopicalMapCommandCenter, item: Candidate, reason: TaskAdvisoryReason): Persisted {
  return { targetType: item.targetType, targetUrl: item.targetUrl, priority: item.priority, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains,
    sourceData: TopicalMapStoreTaskSourceSchema.parse({ source: "topical-map", strategyVersionId: center.identity.versionId, packageSha256: center.identity.packageSha256, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains, sourceReferences: item.ruleIds.slice(0, 25).map((id) => ({ kind: "rule", id })), generationProvenance: "advisory_projection", targetType: item.targetType, targetUrl: item.targetUrl, executable: false, advisoryReason: reason }),
    proposedState: { action: "advisory", advisory: reason },
  };
}

async function supersedeObsoleteLinkTasks(client: Client, center: TopicalMapCommandCenter, task: Persisted, replacementId: string): Promise<void> {
  if (task.proposedState.action !== "internal_link" || !client.storeTask.findMany || !client.storeTask.updateMany || !client.auditLog || !client.$transaction) return;
  const rows = await client.storeTask.findMany({ where: { taskType: "topical_map", targetUrl: task.targetUrl, status: { in: ["pending", "failed"] } }, select: { id: true, status: true, sourceData: true } });
  for (const row of rows) {
    if (row.id === replacementId) continue;
    const parsed = SupersedableInternalLinkSourceSchema.safeParse(row.sourceData);
    if (!parsed.success || parsed.data.strategyVersionId !== center.identity.versionId || parsed.data.packageSha256 !== center.identity.packageSha256) continue;
    if (parsed.data.recommendationId && client.recommendation?.findUnique) {
      const recommendation = await client.recommendation.findUnique({ where: { id: parsed.data.recommendationId }, select: { id: true, status: true } });
      if (recommendation && ["approved", "override_approved", "executing"].includes(recommendation.status)) continue;
    }
    await client.$transaction(async (tx) => {
      const note = `Superseded by grouped topical-map internal-link task ${replacementId}`;
      const updated = await tx.storeTask.updateMany!({ where: { id: row.id, status: { in: ["pending", "failed"] } }, data: { status: "dismissed", completionNote: note, completedAt: new Date() } });
      if (updated.count !== 1) return;
      await tx.auditLog!.create({ data: { actor: "topical-map-sync", action: "topical_map_store_task_superseded", entityType: "StoreTask", entityId: row.id, before: { status: row.status }, after: { status: "dismissed", replacementTaskId: replacementId }, meta: { strategyVersionId: center.identity.versionId, packageSha256: center.identity.packageSha256, targetUrl: task.targetUrl } } });
    });
  }
}

export async function syncTopicalMapStoreTasks(client: Client): Promise<Summary> {
  const summary: Summary = { executable: 0, advisory: 0, unchanged: 0, suppressed: 0 };
  const center = await loadActiveTopicalMapCommandCenter(client);
  if (!center) return summary;
  const projected = candidates(center);
  const governedUrls = [...new Set(projected.filter((item) => item.action !== "advisory").map((item) => item.targetUrl))];
  const resources = await fetchGovernedStoreResources(governedUrls);
  const viable: Candidate[] = [];
  for (const item of projected) {
    if (item.action === "advisory") { viable.push(item); continue; }
    const resource = resources.get(item.targetUrl);
    if (!resource) { summary.suppressed++; continue; }
    item.resource = resource;
    if (item.action === "internal_link") {
      const existingTargets = new Set(resource.internalTargets.map(path));
      item.links = item.links!.filter((link) => !existingTargets.has(link.toUrl));
      if (!item.links.length) { summary.unchanged++; continue; }
      item.ruleIds = [...new Set(item.links.flatMap((link) => link.ruleIds))].sort();
    }
    viable.push(item);
  }

  const draftCandidates = viable.filter((item) => item.action === "seo_update" || item.action === "content_update").slice(0, 25);
  let drafts = new Map<string, z.infer<typeof DraftResponse>["drafts"][number]>();
  if (draftCandidates.length) {
    try {
      const request = JSON.stringify({ draftsRequested: draftCandidates.map((item) => ({ url: item.targetUrl, action: item.action, theme: item.theme?.slice(0, 300), current: { title: item.resource!.title.slice(0, 300), seoTitle: item.resource!.seoTitle?.slice(0, 300), seoDescription: item.resource!.seoDescription?.slice(0, 500), bodyExcerpt: item.resource!.bodyHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1500) } })) });
      if (request.length > 60_000) throw new Error("Draft request exceeds bounded size");
      const response = await chatCompletionWithFailover({ messages: [{ role: "system", content: "Return strict JSON only. Draft bounded SEO metadata or additive plain sectionText. Never return HTML, handles, or publication fields." }, { role: "user", content: request }], response_format: { type: "json_object" } });
      const parsed = DraftResponse.safeParse(JSON.parse(response.content));
      if (parsed.success && parsed.data.drafts.every((draft) => draftCandidates.some((item) => item.targetUrl === path(draft.url)))) drafts = new Map(parsed.data.drafts.map((draft) => [path(draft.url), draft]));
    } catch { /* draft-dependent work becomes advisory below */ }
  }

  const tasks: Persisted[] = viable.map((item) => {
    if (item.action === "advisory") return advisory(center, item, item.advisoryReason!);
    const resource = item.resource!;
    const sourceData = TopicalMapStoreTaskSourceSchema.parse({
      source: "topical-map",
      strategyVersionId: center.identity.versionId,
      packageSha256: center.identity.packageSha256,
      ruleIds: item.ruleIds,
      ruleDomains: item.ruleDomains,
      sourceReferences: item.ruleIds.slice(0, 25).map((id) => ({ kind: "rule", id })),
      generationProvenance: item.action === "internal_link" ? "deterministic" : "bounded_ai_draft",
      targetType: resource.type,
      targetUrl: item.targetUrl,
      action: item.action,
      ...(item.action === "internal_link" ? { links: item.links!.map(({ toUrl, anchor }) => ({ toUrl, anchor })) } : {}),
      observedAt: resource.updatedAt.toISOString(),
      observedStateHash: resource.stateHash,
      executable: true,
    });
    if (item.action === "internal_link") {
      const bodyHtml = appendInternalLinkMarkup(resource.bodyHtml, item.targetUrl, item.links!);
      if (bodyHtml.length > 50_000) return advisory(center, item, "draft_unavailable");
      return { targetType: resource.type, targetUrl: item.targetUrl, priority: item.priority, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains, sourceData, proposedState: { action: item.action, before: { bodyHtml: resource.bodyHtml }, after: { bodyHtml } } };
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
    const dedupeKey = `store-task:topical-map:${hash(canonical([center.identity.versionId, center.identity.packageSha256, checkedProposed.action === "internal_link" ? "grouped-links-v1" : "v1", [...task.ruleIds].sort(), path(task.targetUrl), checkedProposed.action]))}`;
    const existing = await client.storeTask.findUnique({ where: { dedupeKey } });
    if (existing && !["pending", "failed"].includes(existing.status)) { summary.unchanged++; continue; }
    if (existing?.sourceData && client.recommendation?.findUnique) {
      const existingSource = TopicalMapStoreTaskSourceSchema.safeParse(existing.sourceData);
      if (existingSource.success && existingSource.data.executable && existingSource.data.recommendationId) {
        const linked = await client.recommendation.findUnique({ where: { id: existingSource.data.recommendationId }, select: { id: true, status: true } });
        if (linked && ["approved", "override_approved", "executing"].includes(linked.status)) { summary.unchanged++; continue; }
      }
    }
    const sourceWithHash = checkedSource;
    const persisted = await client.storeTask.upsert({ where: { dedupeKey }, create: { taskType: "topical_map", targetType: task.targetType, targetId: null, targetUrl: task.targetUrl, title: checkedSource.executable ? `Review topical-map ${checkedProposed.action}` : "Review topical-map advisory", description: checkedSource.executable ? `Review the governed ${checkedProposed.action} for ${task.targetUrl}.` : checkedSource.advisoryReason, proposedState: checkedProposed, sourceData: sourceWithHash, priority: task.priority, status: "pending", dedupeKey }, update: { taskType: "topical_map", targetType: task.targetType, targetUrl: task.targetUrl, title: checkedSource.executable ? `Review topical-map ${checkedProposed.action}` : "Review topical-map advisory", description: checkedSource.executable ? `Review the governed ${checkedProposed.action} for ${task.targetUrl}.` : checkedSource.advisoryReason, proposedState: checkedProposed, sourceData: sourceWithHash, priority: task.priority, status: "pending", completionNote: null, completedAt: null } }) as { id?: string } | undefined;
    if (checkedSource.executable && persisted?.id && client.recommendation && client.rawSnapshot && client.storeTask.update) {
      const snapshot = await client.rawSnapshot.findFirst({ where: { source: "seo_analysis" }, orderBy: { fetchedAt: "desc" }, select: { id: true } });
      if (!snapshot) { summary.suppressed++; continue; }
      let recommendation = await client.recommendation.findFirst({ where: { platform: "shopify", actionType: "apply_topical_map_store_task", targetEntityId: persisted.id, status: { in: ["pending", "approved", "override_approved"] } }, select: { id: true, status: true } });
      if (!recommendation && checkedProposed.action !== "advisory") recommendation = await client.recommendation.create({ data: { platform: "shopify", skillId: "topical-map-store-task", skillName: "Governed topical-map Store Task", actionType: "apply_topical_map_store_task", targetEntityType: "store_task", targetEntityId: persisted.id, targetEntityName: task.targetUrl, currentValue: JSON.stringify(checkedProposed.before), proposedValue: JSON.stringify({ taskId: persisted.id, proposedStateHash: proposedHash }), rationale: `Apply the exact governed ${checkedProposed.action} after operator approval.`, guardStatus: "clear", status: "pending", snapshotId: snapshot.id } });
      if (!recommendation) { summary.suppressed++; continue; }
      await client.storeTask.update({ where: { id: persisted.id }, data: { sourceData: { ...sourceWithHash, recommendationId: recommendation.id } } });
    }
    if (checkedSource.executable && checkedProposed.action === "internal_link" && persisted?.id) await supersedeObsoleteLinkTasks(client, center, task, persisted.id);
    if (checkedSource.executable) summary.executable++; else summary.advisory++;
  }
  return summary;
}
