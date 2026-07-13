import { createHash } from "node:crypto";
import { z } from "zod";
import { chatCompletionWithFailover } from "@/lib/ai/client";
import { fetchGovernedStoreResources, resolveGovernedStoreUrl, type GovernedStoreResource } from "@/lib/shopify-governed-resources";
import { loadActiveTopicalMapCommandCenter, type CommandCenterPage, type TopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";

export type TopicalMapStoreAction = "seo_update" | "content_update" | "internal_link";

const TargetType = z.enum(["product", "collection", "page"]);
const Before = z.object({ title: z.string().optional(), seoTitle: z.string().nullable().optional(), seoDescription: z.string().nullable().optional(), bodyHtml: z.string().optional() }).strict();
const After = z.object({ title: z.string().optional(), seoTitle: z.string().max(70).optional(), seoDescription: z.string().max(160).optional(), bodyHtml: z.string().optional() }).strict();

export const TopicalMapStoreTaskSourceSchema = z.discriminatedUnion("executable", [
  z.object({ source: z.literal("topical-map"), strategyVersionId: z.string().min(1), packageSha256: z.string().min(1), ruleIds: z.array(z.string()).min(1), ruleDomains: z.array(z.string()).min(1), targetType: TargetType, targetUrl: z.string().min(1), observedAt: z.string().datetime(), observedStateHash: z.string().min(1), executable: z.literal(true) }).strict(),
  z.object({ source: z.literal("topical-map"), strategyVersionId: z.string().min(1), packageSha256: z.string().min(1), ruleIds: z.array(z.string()).min(1), ruleDomains: z.array(z.string()).min(1), targetType: z.string().min(1), targetUrl: z.string().min(1), executable: z.literal(false), advisoryReason: z.string().min(1) }).strict(),
]);

export const TopicalMapStoreTaskProposedSchema = z.union([
  z.object({ action: z.enum(["seo_update", "content_update", "internal_link"]), before: Before, after: After }).strict(),
  z.object({ action: z.literal("advisory"), before: Before.optional(), advisory: z.string().min(1) }).strict(),
]);

const DraftResponse = z.object({ drafts: z.array(z.object({
  url: z.string().min(1), seoTitle: z.string().min(1).max(70).optional(), seoDescription: z.string().min(1).max(160).optional(), sectionHtml: z.string().min(1).max(1200).optional(),
}).strict()).max(250) }).strict().superRefine((value, ctx) => {
  const urls = value.drafts.map((draft) => path(draft.url));
  if (new Set(urls).size !== urls.length) ctx.addIssue({ code: "custom", message: "Draft URLs must be unique", path: ["drafts"] });
});

type Client = {
  topicalMapActivation: { findUnique(args: unknown): Promise<unknown> };
  storeTask: {
    findUnique(args: { where: { dedupeKey: string } }): Promise<{ status: string } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
};
type Summary = { executable: number; advisory: number; unchanged: number; suppressed: number };
type Candidate = { targetType: string; targetUrl: string; ruleIds: string[]; ruleDomains: string[]; priority: string; action: TopicalMapStoreAction | "advisory"; advisoryReason?: string; resource?: GovernedStoreResource; theme?: string; toUrl?: string; anchor?: string };
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
function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function safeSection(value: string): string {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "").slice(0, 1200);
}
function before(resource: GovernedStoreResource) { return { title: resource.title, seoTitle: resource.seoTitle, seoDescription: resource.seoDescription, bodyHtml: resource.bodyHtml }; }
function pageAction(page: CommandCenterPage): TopicalMapStoreAction {
  const decision = page.decision?.toLowerCase() ?? "";
  return /(seo|meta|title|description)/.test(decision) ? "seo_update" : "content_update";
}
function grounded(draft: z.infer<typeof DraftResponse>["drafts"][number], candidate: Candidate): boolean {
  const haystack = `${draft.seoTitle ?? ""} ${draft.seoDescription ?? ""} ${draft.sectionHtml ?? ""}`.toLowerCase();
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
  for (const link of center.work.internalLinks) {
    const fromUrl = path(link.fromUrl);
    if (/^\/blogs\/[^/]+\/[^/]+/.test(fromUrl)) continue;
    const target = resolveGovernedStoreUrl(fromUrl);
    if (!target) continue;
    result.push({ targetType: target.type, targetUrl: fromUrl, ruleIds: [...link.ruleIds].sort(), ruleDomains: ["internal_links"], priority: link.priority ?? "medium", action: "internal_link", toUrl: path(link.toUrl), anchor: link.recommendedAnchor ?? link.toUrl });
  }
  const advisory = (targetUrl: string, ruleIds: string[], ruleDomain: string, reason: string, targetType: string) => result.push({ targetType, targetUrl: path(targetUrl), ruleIds: [...ruleIds].sort(), ruleDomains: [ruleDomain], priority: "medium", action: "advisory", advisoryReason: reason });
  for (const rule of center.work.redirects) advisory(rule.source, rule.ruleIds, "redirects", "redirect_execution_unsupported", "redirect");
  for (const rule of center.work.canonicalization) advisory(rule.currentUrl, rule.ruleIds, "canonicalization", "canonicalization_execution_prohibited", "technical");
  for (const rule of center.work.indexation) advisory(rule.currentUrl, rule.ruleIds, "indexation", "indexation_execution_prohibited", "technical");
  return result.sort((a, b) => a.targetUrl.localeCompare(b.targetUrl) || a.action.localeCompare(b.action) || a.ruleIds.join().localeCompare(b.ruleIds.join()));
}

function advisory(center: TopicalMapCommandCenter, item: Candidate, reason: string): Persisted {
  return { targetType: item.targetType, targetUrl: item.targetUrl, priority: item.priority, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains,
    sourceData: { source: "topical-map", strategyVersionId: center.identity.versionId, packageSha256: center.identity.packageSha256, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains, targetType: item.targetType, targetUrl: item.targetUrl, executable: false, advisoryReason: reason },
    proposedState: { action: "advisory", advisory: reason },
  };
}

export async function syncTopicalMapStoreTasks(client: Client, _options: Record<string, never> = {}): Promise<Summary> {
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
    if (item.action === "internal_link" && resource.internalTargets.map(path).includes(item.toUrl!)) { summary.unchanged++; continue; }
    viable.push(item);
  }

  const draftCandidates = viable.filter((item) => item.action === "seo_update" || item.action === "content_update");
  let drafts = new Map<string, z.infer<typeof DraftResponse>["drafts"][number]>();
  if (draftCandidates.length) {
    try {
      const response = await chatCompletionWithFailover({ messages: [{ role: "system", content: "Return strict JSON only. Draft bounded SEO metadata or an additive HTML section; never invent handles or publication fields." }, { role: "user", content: JSON.stringify({ draftsRequested: draftCandidates.map((item) => ({ url: item.targetUrl, action: item.action, theme: item.theme, current: before(item.resource!) })) }) }], response_format: { type: "json_object" } });
      const parsed = DraftResponse.safeParse(JSON.parse(response.content));
      if (parsed.success && parsed.data.drafts.every((draft) => draftCandidates.some((item) => item.targetUrl === path(draft.url)))) drafts = new Map(parsed.data.drafts.map((draft) => [path(draft.url), draft]));
    } catch { /* draft-dependent work becomes advisory below */ }
  }

  const tasks: Persisted[] = viable.map((item) => {
    if (item.action === "advisory") return advisory(center, item, item.advisoryReason!);
    const resource = item.resource!;
    const sourceData = { source: "topical-map" as const, strategyVersionId: center.identity.versionId, packageSha256: center.identity.packageSha256, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains, targetType: resource.type, targetUrl: item.targetUrl, observedAt: resource.updatedAt.toISOString(), observedStateHash: resource.stateHash, executable: true as const };
    if (item.action === "internal_link") {
      const bodyHtml = `${resource.bodyHtml}<p><a href="${escapeHtml(item.toUrl!)}">${escapeHtml(item.anchor!)}</a></p>`;
      return { targetType: resource.type, targetUrl: item.targetUrl, priority: item.priority, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains, sourceData, proposedState: { action: item.action, before: { bodyHtml: resource.bodyHtml }, after: { bodyHtml } } };
    }
    const draft = drafts.get(item.targetUrl);
    if (!draft || !grounded(draft, item) || (item.action === "seo_update" && (!draft.seoTitle || !draft.seoDescription)) || (item.action === "content_update" && !draft.sectionHtml)) return advisory(center, item, "draft_unavailable");
    const after = item.action === "seo_update" ? { seoTitle: draft.seoTitle!, seoDescription: draft.seoDescription! } : { bodyHtml: `${resource.bodyHtml}${safeSection(draft.sectionHtml!)}` };
    return { targetType: resource.type, targetUrl: item.targetUrl, priority: item.priority, ruleIds: item.ruleIds, ruleDomains: item.ruleDomains, sourceData, proposedState: { action: item.action, before: before(resource), after } };
  });

  for (const task of tasks) {
    const checkedSource = TopicalMapStoreTaskSourceSchema.parse(task.sourceData);
    const checkedProposed = TopicalMapStoreTaskProposedSchema.parse(task.proposedState);
    const proposedHash = hash(canonical(checkedProposed));
    const dedupeKey = `store-task:topical-map:${hash(canonical([center.identity.versionId, center.identity.packageSha256, [...task.ruleIds].sort(), path(task.targetUrl), checkedProposed.action, proposedHash]))}`;
    const existing = await client.storeTask.findUnique({ where: { dedupeKey } });
    if (existing && !["pending", "failed"].includes(existing.status)) { summary.unchanged++; continue; }
    await client.storeTask.upsert({ where: { dedupeKey }, create: { taskType: "topical_map", targetType: task.targetType, targetId: null, targetUrl: task.targetUrl, title: checkedSource.executable ? `Review topical-map ${checkedProposed.action}` : "Review topical-map advisory", description: checkedSource.executable ? `Review the governed ${checkedProposed.action} for ${task.targetUrl}.` : checkedSource.advisoryReason, proposedState: checkedProposed, sourceData: checkedSource, priority: task.priority, status: "pending", dedupeKey }, update: { taskType: "topical_map", targetType: task.targetType, targetUrl: task.targetUrl, title: checkedSource.executable ? `Review topical-map ${checkedProposed.action}` : "Review topical-map advisory", description: checkedSource.executable ? `Review the governed ${checkedProposed.action} for ${task.targetUrl}.` : checkedSource.advisoryReason, proposedState: checkedProposed, sourceData: checkedSource, priority: task.priority, status: "pending" } });
    if (checkedSource.executable) summary.executable++; else summary.advisory++;
  }
  return summary;
}
