import { prisma } from "@/lib/db";
import { Prisma, type Recommendation } from "@prisma/client";
import { applyGovernedStoreResourceChange, createGovernedRedirect, fetchGovernedRedirects, fetchGovernedStoreResource, resolveGovernedStoreUrl, type GovernedStoreResource } from "@/lib/shopify-governed-resources";
import { appendInternalLinkMarkup, hashTopicalMapProposedState, TopicalMapStoreTaskProposedSchema, TopicalMapStoreTaskSourceSchema } from "@/lib/store-tasks/topical-map";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";

export type TopicalMapApplyErrorCode = "TASK_NOT_PENDING" | "TASK_NOT_EXECUTABLE" | "APPROVED_BYTES_CHANGED" | "STRATEGY_CHANGED" | "RULE_CHANGED" | "OBSERVATION_CHANGED" | "TARGET_LOCKED" | "SHOPIFY_FAILED" | "SHOPIFY_VERIFICATION_UNCERTAIN";
export type TopicalMapApplyDiagnostic = {
  mutationSent: boolean;
  shopifyMessage?: string;
  reobservation: "expected_state" | "different_state" | "unavailable" | "not_attempted";
};
export class TopicalMapApplyError extends Error {
  constructor(
    public readonly code: TopicalMapApplyErrorCode,
    public readonly diagnostic?: TopicalMapApplyDiagnostic,
  ) { super(code); this.name = "TopicalMapApplyError"; }
}

type Db = typeof prisma;
type ExecutableSource = Extract<ReturnType<typeof TopicalMapStoreTaskSourceSchema.parse>, { executable: true }>;
type ExecutableProposed = Exclude<ReturnType<typeof TopicalMapStoreTaskProposedSchema.parse>, { action: "advisory" }>;
export type MinimalStoreTaskReceipt = {
  taskId: string; recommendationId: string; targetId: string; targetUrl: string; targetType: "product" | "collection" | "page" | "redirect";
  strategyVersionId: string; packageSha256: string; ruleIds: string[]; action: string; changedFields: string[];
  proposedStateHash: string; shopifyReturnedStateHash: string; verifiedAt: string;
};

function path(value: string): string {
  const normalized = normalizeGovernedUrl(value);
  if (normalized.startsWith("/")) return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
  const parsed = new URL(normalized); return `${parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/, "") : parsed.pathname}${parsed.search}${parsed.hash}`;
}
function sameStrings(a: string[], b: string[]) { return [...a].sort().join("\0") === [...b].sort().join("\0"); }
function approvedHash(rec: Pick<Recommendation, "proposedValue">): string | null {
  try { const parsed = JSON.parse(rec.proposedValue ?? "null"); return typeof parsed?.approvedProposedStateHash === "string" ? parsed.approvedProposedStateHash : null; } catch { return null; }
}
function stillGoverned(center: Awaited<ReturnType<typeof loadActiveTopicalMapCommandCenter>>, source: ExecutableSource, proposed: ExecutableProposed) {
  if (!center || source.action !== proposed.action) return false;
  if (source.action === "redirect_create" && proposed.action === "redirect_create") {
    const governed = center.work.redirects.filter((item) => path(item.source) === source.targetUrl && path(item.finalTarget) === source.redirectTarget);
    return proposed.after.target === source.redirectTarget && governed.length === 1 && sameStrings(governed[0]!.ruleIds, source.ruleIds);
  }
  const target = resolveGovernedStoreUrl(source.targetUrl); if (!target || target.type !== source.targetType) return false;
  if (source.action === "internal_link") {
    const governed = center.work.internalLinks.filter((item) => path(item.fromUrl) === source.targetUrl && source.links.some((link) => link.toUrl === path(item.toUrl) && link.anchor === (item.recommendedAnchor ?? item.toUrl)));
    const governedLinks = new Set(governed.map((item) => `${path(item.toUrl)}\u0000${item.recommendedAnchor ?? item.toUrl}`));
    return governedLinks.size === source.links.length && source.links.every((link) => governedLinks.has(`${link.toUrl}\u0000${link.anchor}`)) && sameStrings(governed.flatMap((item) => item.ruleIds), source.ruleIds);
  }
  const page = center.pages.find((item) => path(item.url) === source.targetUrl);
  const action = /(seo|meta|title|description)/.test(page?.decision?.toLowerCase() ?? "") ? "seo_update" : "content_update";
  return !!page && action === source.action && sameStrings(page.ruleDomains.content_decisions ?? [], source.ruleIds);
}
function expectedChanges(proposed: ExecutableProposed, current: GovernedStoreResource, source: ExecutableSource): Record<string, string> {
  if (proposed.action === "internal_link" && source.action === "internal_link") return { bodyHtml: appendInternalLinkMarkup(current.bodyHtml, source.targetUrl, source.links) };
  return { ...proposed.after };
}
function beforeMatches(proposed: ExecutableProposed, current: GovernedStoreResource) {
  return Object.entries(proposed.before ?? {}).every(([key, value]) => current[key as keyof GovernedStoreResource] === value);
}
function normalizeShopifyHtml(value: string) { return value.replace(/>\s+</g, "><").trim(); }
function afterMatches(expected: Record<string, string>, current: GovernedStoreResource) {
  return Object.entries(expected).every(([key, value]) => {
    const observed = current[key as keyof GovernedStoreResource];
    return key === "bodyHtml" && typeof observed === "string"
      ? normalizeShopifyHtml(observed) === normalizeShopifyHtml(value)
      : observed === value;
  });
}

export async function approveTopicalMapStoreTask(db: Db, input: { id: string; actor: string }) {
  const row = await db.storeTask.findUnique({ where: { id: input.id } });
  if (!row || row.status !== "pending") throw new TopicalMapApplyError("TASK_NOT_PENDING");
  const source = TopicalMapStoreTaskSourceSchema.safeParse(row.sourceData); const proposed = TopicalMapStoreTaskProposedSchema.safeParse(row.proposedState);
  if (!source.success || !source.data.executable || !source.data.recommendationId || !proposed.success || proposed.data.action === "advisory") throw new TopicalMapApplyError("TASK_NOT_EXECUTABLE");
  const recommendationId = source.data.recommendationId; const approvedProposedStateHash = hashTopicalMapProposedState(proposed.data);
  const approved = await db.$transaction(async (tx) => {
    const claimed = await tx.recommendation.updateMany({ where: { id: recommendationId, targetEntityId: row.id, platform: "shopify", actionType: "apply_topical_map_store_task", status: "pending" }, data: { status: "approved", reviewedBy: input.actor, reviewedAt: new Date(), proposedValue: JSON.stringify({ taskId: row.id, approvedProposedStateHash }) } });
    if (claimed.count !== 1) return false;
    await tx.storeTask.update({ where: { id: row.id }, data: { reviewedBy: input.actor, reviewedAt: new Date(), completionNote: "Approved and queued for guarded execution." } });
    await tx.auditLog.create({ data: { actor: input.actor, action: "topical_map_store_task_approved", entityType: "StoreTask", entityId: row.id, after: { recommendationId, approvedProposedStateHash, status: "queued" } } }); return true;
  });
  if (!approved) throw new TopicalMapApplyError("TASK_NOT_PENDING");
  return { taskId: row.id, recommendationId, status: "queued" as const };
}

export async function dispatchClaimedTopicalMapStoreTask(db: Db, rec: Recommendation): Promise<MinimalStoreTaskReceipt> {
  if (rec.platform !== "shopify" || rec.actionType !== "apply_topical_map_store_task" || rec.status !== "executing") throw new TopicalMapApplyError("TASK_NOT_EXECUTABLE");
  const row = await db.storeTask.findUnique({ where: { id: rec.targetEntityId } });
  if (!row || row.status !== "pending") throw new TopicalMapApplyError("TASK_NOT_PENDING");
  const sourceResult = TopicalMapStoreTaskSourceSchema.safeParse(row.sourceData); const proposedResult = TopicalMapStoreTaskProposedSchema.safeParse(row.proposedState);
  if (!sourceResult.success || !sourceResult.data.executable || sourceResult.data.recommendationId !== rec.id || !proposedResult.success || proposedResult.data.action === "advisory") throw new TopicalMapApplyError("TASK_NOT_EXECUTABLE");
  const source = sourceResult.data; const proposed = proposedResult.data; const proposedStateHash = hashTopicalMapProposedState(proposed);
  if (approvedHash(rec) !== proposedStateHash) throw new TopicalMapApplyError("APPROVED_BYTES_CHANGED");
  const center = await loadActiveTopicalMapCommandCenter(db);
  if (!center || center.identity.versionId !== source.strategyVersionId || center.identity.packageSha256 !== source.packageSha256) throw new TopicalMapApplyError("STRATEGY_CHANGED");
  if (!stillGoverned(center, source, proposed)) throw new TopicalMapApplyError("RULE_CHANGED");
  const now = new Date(); const expiresAt = new Date(now.getTime() + 10 * 60_000);
  try {
    await db.$transaction(async (tx) => {
      await tx.storeTaskExecutionLock.deleteMany({ where: { targetUrl: source.targetUrl, expiresAt: { lte: now } } });
      await tx.storeTaskExecutionLock.create({ data: { targetUrl: source.targetUrl, taskId: row.id, ownerId: rec.id, acquiredAt: now, expiresAt } });
      const claimed = await tx.storeTask.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "applying", completionNote: "Shopify execution is in progress." } });
      if (claimed.count !== 1) throw new TopicalMapApplyError("TASK_NOT_PENDING");
    });
  } catch (error) { if (error instanceof TopicalMapApplyError) throw error; throw new TopicalMapApplyError("TARGET_LOCKED"); }
  if (source.action === "redirect_create" && proposed.action === "redirect_create") {
    const current = await fetchGovernedRedirects([source.targetUrl]);
    if (current.has(source.targetUrl)) throw new TopicalMapApplyError("OBSERVATION_CHANGED");
    let created;
    try {
      created = await createGovernedRedirect(source.targetUrl, source.redirectTarget);
    } catch (error) {
      let reobserved = null;
      try { reobserved = (await fetchGovernedRedirects([source.targetUrl])).get(source.targetUrl) ?? null; } catch { /* bounded unavailable diagnostic */ }
      if (reobserved?.target === source.redirectTarget) created = reobserved;
      else {
        const shopifyMessage = error instanceof Error ? error.message.replace(/[\r\n\t]+/g, " ").trim().slice(0, 300) : undefined;
        throw new TopicalMapApplyError("SHOPIFY_VERIFICATION_UNCERTAIN", { mutationSent: true, ...(shopifyMessage ? { shopifyMessage } : {}), reobservation: reobserved ? "different_state" : "unavailable" });
      }
    }
    if (created.source !== source.targetUrl || created.target !== source.redirectTarget) throw new TopicalMapApplyError("SHOPIFY_VERIFICATION_UNCERTAIN", { mutationSent: true, reobservation: "different_state" });
    return { taskId: row.id, recommendationId: rec.id, targetId: created.id, targetUrl: source.targetUrl, targetType: "redirect", strategyVersionId: source.strategyVersionId, packageSha256: source.packageSha256, ruleIds: [...source.ruleIds].sort(), action: proposed.action, changedFields: ["target"], proposedStateHash, shopifyReturnedStateHash: created.stateHash, verifiedAt: new Date().toISOString() };
  }
  const current = await fetchGovernedStoreResource(source.targetUrl);
  if (!current || current.type !== source.targetType || current.stateHash !== source.observedStateHash || !beforeMatches(proposed, current)) throw new TopicalMapApplyError("OBSERVATION_CHANGED");
  const expected = expectedChanges(proposed, current, source);
  let updated: GovernedStoreResource;
  let mutationSent = false;
  try {
    mutationSent = true;
    updated = await applyGovernedStoreResourceChange(current, expected);
  } catch (error) {
    let reobserved: GovernedStoreResource | null = null;
    try { reobserved = await fetchGovernedStoreResource(source.targetUrl); } catch { /* bounded unavailable diagnostic */ }
    if (reobserved && reobserved.type === source.targetType && afterMatches(expected, reobserved)) {
      updated = reobserved;
    } else {
      const shopifyMessage = error instanceof Error
        ? error.message.replace(/[\r\n\t]+/g, " ").trim().slice(0, 300)
        : undefined;
      throw new TopicalMapApplyError("SHOPIFY_VERIFICATION_UNCERTAIN", {
        mutationSent,
        ...(shopifyMessage ? { shopifyMessage } : {}),
        reobservation: reobserved ? "different_state" : "unavailable",
      });
    }
  }
  if (!afterMatches(expected, updated)) {
    throw new TopicalMapApplyError("SHOPIFY_VERIFICATION_UNCERTAIN", {
      mutationSent,
      reobservation: "different_state",
    });
  }
  return { taskId: row.id, recommendationId: rec.id, targetId: updated.id, targetUrl: source.targetUrl, targetType: source.targetType, strategyVersionId: source.strategyVersionId, packageSha256: source.packageSha256, ruleIds: [...source.ruleIds].sort(), action: proposed.action, changedFields: Object.keys(expected).sort(), proposedStateHash, shopifyReturnedStateHash: updated.stateHash, verifiedAt: new Date().toISOString() };
}

export async function reobserveTopicalMapReceipt(db: Db, rec: Recommendation): Promise<MinimalStoreTaskReceipt | null> {
  const row = await db.storeTask.findUnique({ where: { id: rec.targetEntityId } }); if (!row) return null;
  const source = TopicalMapStoreTaskSourceSchema.safeParse(row.sourceData); const proposed = TopicalMapStoreTaskProposedSchema.safeParse(row.proposedState);
  if (!source.success || !source.data.executable || !proposed.success || proposed.data.action === "advisory") return null;
  if (source.data.action === "redirect_create" && proposed.data.action === "redirect_create") {
    const current = (await fetchGovernedRedirects([source.data.targetUrl])).get(source.data.targetUrl);
    if (!current || current.target !== source.data.redirectTarget) return null;
    const proposedStateHash = hashTopicalMapProposedState(proposed.data);
    return { taskId: row.id, recommendationId: rec.id, targetId: current.id, targetUrl: source.data.targetUrl, targetType: "redirect", strategyVersionId: source.data.strategyVersionId, packageSha256: source.data.packageSha256, ruleIds: [...source.data.ruleIds].sort(), action: proposed.data.action, changedFields: ["target"], proposedStateHash, shopifyReturnedStateHash: current.stateHash, verifiedAt: new Date().toISOString() };
  }
  const current = await fetchGovernedStoreResource(source.data.targetUrl); if (!current) return null;
  // For recovery, compare stored proposed after directly; internal links are already present and deterministic.
  const directExpected = proposed.data.action === "internal_link" ? proposed.data.after : proposed.data.after;
  if (!afterMatches(directExpected as Record<string, string>, current)) return null;
  const proposedStateHash = hashTopicalMapProposedState(proposed.data);
  return { taskId: row.id, recommendationId: rec.id, targetId: current.id, targetUrl: source.data.targetUrl, targetType: source.data.targetType, strategyVersionId: source.data.strategyVersionId, packageSha256: source.data.packageSha256, ruleIds: [...source.data.ruleIds].sort(), action: proposed.data.action, changedFields: Object.keys(directExpected).sort(), proposedStateHash, shopifyReturnedStateHash: current.stateHash, verifiedAt: new Date().toISOString() };
}

export function receiptJson(receipt: MinimalStoreTaskReceipt): Prisma.InputJsonValue { return receipt as unknown as Prisma.InputJsonValue; }
