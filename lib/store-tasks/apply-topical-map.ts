import { prisma } from "@/lib/db";
import { Prisma, type Recommendation } from "@prisma/client";
import { applyGovernedStoreResourceChange, fetchGovernedStoreResource, resolveGovernedStoreUrl, type GovernedStoreResource } from "@/lib/shopify-governed-resources";
import { hashTopicalMapProposedState, TopicalMapStoreTaskProposedSchema, TopicalMapStoreTaskSourceSchema } from "@/lib/store-tasks/topical-map";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";

export type TopicalMapApplyErrorCode = "TASK_NOT_PENDING" | "TASK_NOT_EXECUTABLE" | "APPROVED_BYTES_CHANGED" | "STRATEGY_CHANGED" | "RULE_CHANGED" | "OBSERVATION_CHANGED" | "TARGET_LOCKED" | "SHOPIFY_FAILED" | "SHOPIFY_VERIFICATION_UNCERTAIN";
export class TopicalMapApplyError extends Error {
  constructor(public readonly code: TopicalMapApplyErrorCode) { super(code); this.name = "TopicalMapApplyError"; }
}

type Db = typeof prisma;
type ExecutableSource = Extract<ReturnType<typeof TopicalMapStoreTaskSourceSchema.parse>, { executable: true }>;
type ExecutableProposed = Exclude<ReturnType<typeof TopicalMapStoreTaskProposedSchema.parse>, { action: "advisory" }>;
export type MinimalStoreTaskReceipt = {
  taskId: string; recommendationId: string; targetId: string; targetUrl: string; targetType: "product" | "collection" | "page";
  strategyVersionId: string; packageSha256: string; ruleIds: string[]; action: string; changedFields: string[];
  proposedStateHash: string; shopifyReturnedStateHash: string; verifiedAt: string;
};

function path(value: string): string {
  const normalized = normalizeGovernedUrl(value);
  if (normalized.startsWith("/")) return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
  const parsed = new URL(normalized); return `${parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/, "") : parsed.pathname}${parsed.search}${parsed.hash}`;
}
function sameStrings(a: string[], b: string[]) { return [...a].sort().join("\0") === [...b].sort().join("\0"); }
function escapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function approvedHash(rec: Pick<Recommendation, "proposedValue">): string | null {
  try { const parsed = JSON.parse(rec.proposedValue ?? "null"); return typeof parsed?.approvedProposedStateHash === "string" ? parsed.approvedProposedStateHash : null; } catch { return null; }
}
function stillGoverned(center: Awaited<ReturnType<typeof loadActiveTopicalMapCommandCenter>>, source: ExecutableSource, proposed: ExecutableProposed) {
  if (!center || source.action !== proposed.action) return false;
  const target = resolveGovernedStoreUrl(source.targetUrl); if (!target || target.type !== source.targetType) return false;
  if (source.action === "internal_link") return center.work.internalLinks.some((item) => path(item.fromUrl) === source.targetUrl && path(item.toUrl) === source.linkTargetUrl && (item.recommendedAnchor ?? item.toUrl) === source.linkAnchor && sameStrings(item.ruleIds, source.ruleIds));
  const page = center.pages.find((item) => path(item.url) === source.targetUrl);
  const action = /(seo|meta|title|description)/.test(page?.decision?.toLowerCase() ?? "") ? "seo_update" : "content_update";
  return !!page && action === source.action && sameStrings(page.ruleDomains.content_decisions ?? [], source.ruleIds);
}
function expectedChanges(proposed: ExecutableProposed, current: GovernedStoreResource, source: ExecutableSource): Record<string, string> {
  if (proposed.action === "internal_link" && source.action === "internal_link") return { bodyHtml: `${current.bodyHtml}<p><a href="${escapeHtml(source.linkTargetUrl)}">${escapeHtml(source.linkAnchor)}</a></p>` };
  return { ...proposed.after };
}
function beforeMatches(proposed: ExecutableProposed, current: GovernedStoreResource) {
  return Object.entries(proposed.before ?? {}).every(([key, value]) => current[key as keyof GovernedStoreResource] === value);
}
function afterMatches(expected: Record<string, string>, current: GovernedStoreResource) { return Object.entries(expected).every(([key, value]) => current[key as keyof GovernedStoreResource] === value); }

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
  const current = await fetchGovernedStoreResource(source.targetUrl);
  if (!current || current.type !== source.targetType || current.stateHash !== source.observedStateHash || !beforeMatches(proposed, current)) throw new TopicalMapApplyError("OBSERVATION_CHANGED");
  const expected = expectedChanges(proposed, current, source);
  let updated: GovernedStoreResource;
  try { updated = await applyGovernedStoreResourceChange(current, expected); } catch { throw new TopicalMapApplyError("SHOPIFY_VERIFICATION_UNCERTAIN"); }
  if (!afterMatches(expected, updated)) throw new TopicalMapApplyError("SHOPIFY_VERIFICATION_UNCERTAIN");
  return { taskId: row.id, recommendationId: rec.id, targetId: updated.id, targetUrl: source.targetUrl, targetType: source.targetType, strategyVersionId: source.strategyVersionId, packageSha256: source.packageSha256, ruleIds: [...source.ruleIds].sort(), action: proposed.action, changedFields: Object.keys(expected).sort(), proposedStateHash, shopifyReturnedStateHash: updated.stateHash, verifiedAt: new Date().toISOString() };
}

export async function reobserveTopicalMapReceipt(db: Db, rec: Recommendation): Promise<MinimalStoreTaskReceipt | null> {
  const row = await db.storeTask.findUnique({ where: { id: rec.targetEntityId } }); if (!row) return null;
  const source = TopicalMapStoreTaskSourceSchema.safeParse(row.sourceData); const proposed = TopicalMapStoreTaskProposedSchema.safeParse(row.proposedState);
  if (!source.success || !source.data.executable || !proposed.success || proposed.data.action === "advisory") return null;
  const current = await fetchGovernedStoreResource(source.data.targetUrl); if (!current) return null;
  // For recovery, compare stored proposed after directly; internal links are already present and deterministic.
  const directExpected = proposed.data.action === "internal_link" ? proposed.data.after : proposed.data.after;
  if (!afterMatches(directExpected as Record<string, string>, current)) return null;
  const proposedStateHash = hashTopicalMapProposedState(proposed.data);
  return { taskId: row.id, recommendationId: rec.id, targetId: current.id, targetUrl: source.data.targetUrl, targetType: source.data.targetType, strategyVersionId: source.data.strategyVersionId, packageSha256: source.data.packageSha256, ruleIds: [...source.data.ruleIds].sort(), action: proposed.data.action, changedFields: Object.keys(directExpected).sort(), proposedStateHash, shopifyReturnedStateHash: current.stateHash, verifiedAt: new Date().toISOString() };
}

export function receiptJson(receipt: MinimalStoreTaskReceipt): Prisma.InputJsonValue { return receipt as unknown as Prisma.InputJsonValue; }
