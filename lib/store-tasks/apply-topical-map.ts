import { prisma } from "@/lib/db";
import { Prisma, type StoreTask } from "@prisma/client";
import { applyGovernedStoreResourceChange, fetchGovernedStoreResource, type GovernedStoreResource } from "@/lib/shopify-governed-resources";
import { TopicalMapStoreTaskProposedSchema, TopicalMapStoreTaskSourceSchema } from "@/lib/store-tasks/topical-map";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";

export type TopicalMapApplyErrorCode = "LIVE_DISABLED" | "TASK_NOT_PENDING" | "TASK_NOT_EXECUTABLE" | "STRATEGY_CHANGED" | "RULE_CHANGED" | "OBSERVATION_CHANGED" | "SHOPIFY_FAILED";
export class TopicalMapApplyError extends Error {
  constructor(public readonly code: TopicalMapApplyErrorCode) { super(code); this.name = "TopicalMapApplyError"; }
}

type Db = typeof prisma;
type ApplyInput = { id: string; actor: string };
type Receipt = { strategyVersionId: string; packageSha256: string; ruleIds: string[]; targetUrl: string; action: string; before: Record<string, unknown>; after: Record<string, unknown> };

function sameStrings(left: string[], right: string[]): boolean {
  return [...left].sort().join("\0") === [...right].sort().join("\0");
}

function stillGoverned(center: Awaited<ReturnType<typeof loadActiveTopicalMapCommandCenter>>, source: Extract<ReturnType<typeof TopicalMapStoreTaskSourceSchema.parse>, { executable: true }>, action: string): boolean {
  if (!center) return false;
  if (action === "internal_link") return center.work.internalLinks.some((item) => item.fromUrl === source.targetUrl && sameStrings(item.ruleIds, source.ruleIds));
  const page = center.pages.find((item) => item.url === source.targetUrl);
  const currentAction = /(seo|meta|title|description)/.test(page?.decision?.toLowerCase() ?? "") ? "seo_update" : "content_update";
  return !!page && currentAction === action && sameStrings(page.ruleDomains.content_decisions ?? [], source.ruleIds);
}

function changes(proposed: ReturnType<typeof TopicalMapStoreTaskProposedSchema.parse>): Record<string, string> {
  if (proposed.action === "advisory") throw new TopicalMapApplyError("TASK_NOT_EXECUTABLE");
  return { ...proposed.after };
}

function verified(resource: GovernedStoreResource, expected: Record<string, string>): boolean {
  return Object.entries(expected).every(([key, value]) => resource[key as keyof GovernedStoreResource] === value);
}

export async function applyTopicalMapStoreTask(db: Db, input: ApplyInput): Promise<{ task: StoreTask; receipt: Receipt }> {
  if (process.env.EXECUTE_APPROVED_LIVE_ENABLED !== "true") throw new TopicalMapApplyError("LIVE_DISABLED");
  const row = await db.storeTask.findUnique({ where: { id: input.id } });
  if (!row || row.status !== "pending") throw new TopicalMapApplyError("TASK_NOT_PENDING");
  const sourceResult = TopicalMapStoreTaskSourceSchema.safeParse(row.sourceData);
  const proposedResult = TopicalMapStoreTaskProposedSchema.safeParse(row.proposedState);
  if (!sourceResult.success || !sourceResult.data.executable || !proposedResult.success || proposedResult.data.action === "advisory") throw new TopicalMapApplyError("TASK_NOT_EXECUTABLE");
  const source = sourceResult.data;
  const proposed = proposedResult.data;
  const center = await loadActiveTopicalMapCommandCenter(db);
  if (!center || center.identity.versionId !== source.strategyVersionId || center.identity.packageSha256 !== source.packageSha256) throw new TopicalMapApplyError("STRATEGY_CHANGED");
  if (!stillGoverned(center, source, proposed.action)) throw new TopicalMapApplyError("RULE_CHANGED");
  const current = await fetchGovernedStoreResource(source.targetUrl);
  if (!current || current.type !== source.targetType || current.stateHash !== source.observedStateHash) throw new TopicalMapApplyError("OBSERVATION_CHANGED");
  const claimed = await db.$transaction((tx) => tx.storeTask.updateMany({ where: { id: input.id, status: "pending" }, data: { status: "applying", reviewedBy: input.actor, reviewedAt: new Date() } }));
  if (claimed.count !== 1) throw new TopicalMapApplyError("TASK_NOT_PENDING");

  const expected = changes(proposed);
  try {
    const updated = await applyGovernedStoreResourceChange(current, expected);
    if (!verified(updated, expected)) throw new Error("RETURNED_STATE_MISMATCH");
    const receipt: Receipt = { strategyVersionId: source.strategyVersionId, packageSha256: source.packageSha256, ruleIds: [...source.ruleIds].sort(), targetUrl: source.targetUrl, action: proposed.action, before: { ...proposed.before }, after: expected };
    const task = await db.$transaction(async (tx) => {
      const completed = await tx.storeTask.update({ where: { id: input.id }, data: { status: "completed", completedAt: new Date(), completionNote: "Shopify update verified." } });
      await tx.auditLog.create({ data: { actor: input.actor, action: "topical_map_store_task_applied", entityType: "StoreTask", entityId: input.id, before: receipt.before as Prisma.InputJsonValue, after: receipt.after as Prisma.InputJsonValue, meta: { strategyVersionId: receipt.strategyVersionId, packageSha256: receipt.packageSha256, ruleIds: receipt.ruleIds, targetUrl: receipt.targetUrl, taskAction: receipt.action } } });
      return completed;
    });
    return { task, receipt };
  } catch {
    await db.$transaction(async (tx) => {
      await tx.storeTask.update({ where: { id: input.id }, data: { status: "failed", completedAt: new Date(), completionNote: "Shopify update could not be verified." } });
      await tx.auditLog.create({ data: { actor: input.actor, action: "topical_map_store_task_failed", entityType: "StoreTask", entityId: input.id, before: { ...proposed.before }, after: Prisma.JsonNull, meta: { strategyVersionId: source.strategyVersionId, packageSha256: source.packageSha256, ruleIds: [...source.ruleIds].sort(), targetUrl: source.targetUrl, taskAction: proposed.action, code: "SHOPIFY_FAILED" } } });
    });
    throw new TopicalMapApplyError("SHOPIFY_FAILED");
  }
}
