import { prisma } from "@/lib/db";
import { Prisma, type StoreTask } from "@prisma/client";
import { applyGovernedStoreResourceChange, fetchGovernedStoreResource, resolveGovernedStoreUrl, type GovernedStoreResource } from "@/lib/shopify-governed-resources";
import { TopicalMapStoreTaskProposedSchema, TopicalMapStoreTaskSourceSchema } from "@/lib/store-tasks/topical-map";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";

export type TopicalMapApplyErrorCode =
  | "LIVE_DISABLED"
  | "TASK_NOT_PENDING"
  | "TASK_NOT_EXECUTABLE"
  | "STRATEGY_CHANGED"
  | "RULE_CHANGED"
  | "OBSERVATION_CHANGED"
  | "SHOPIFY_FAILED";
export class TopicalMapApplyError extends Error {
  constructor(public readonly code: TopicalMapApplyErrorCode) {
    super(code);
    this.name = "TopicalMapApplyError";
  }
}

type Db = typeof prisma;
type ApplyInput = { id: string; actor: string };
type Receipt = {
  strategyVersionId: string;
  packageSha256: string;
  ruleIds: string[];
  targetUrl: string;
  action: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

function sameStrings(left: string[], right: string[]): boolean {
  return [...left].sort().join("\0") === [...right].sort().join("\0");
}

function path(value: string): string {
  const normalized = normalizeGovernedUrl(value);
  if (normalized.startsWith("/")) {
    return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
  }
  const parsed = new URL(normalized);
  const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/, "") : parsed.pathname;
  return `${pathname}${parsed.search}${parsed.hash}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stillGoverned(
  center: Awaited<ReturnType<typeof loadActiveTopicalMapCommandCenter>>,
  source: Extract<ReturnType<typeof TopicalMapStoreTaskSourceSchema.parse>, { executable: true }>,
  proposed: Exclude<ReturnType<typeof TopicalMapStoreTaskProposedSchema.parse>, { action: "advisory" }>,
): boolean {
  if (!center) return false;
  if (source.action !== proposed.action) return false;
  const resolvedTarget = resolveGovernedStoreUrl(source.targetUrl);
  if (!resolvedTarget || resolvedTarget.type !== source.targetType) return false;
  if (source.action === "internal_link" && proposed.action === "internal_link") {
    return center.work.internalLinks.some((item) => {
      const activeAnchor = item.recommendedAnchor ?? item.toUrl;
      return path(item.fromUrl) === source.targetUrl
        && path(item.toUrl) === source.linkTargetUrl
        && activeAnchor === source.linkAnchor
        && sameStrings(item.ruleIds, source.ruleIds);
    });
  }
  const page = center.pages.find((item) => item.url === source.targetUrl);
  const currentAction = /(seo|meta|title|description)/.test(page?.decision?.toLowerCase() ?? "") ? "seo_update" : "content_update";
  return !!page && currentAction === source.action && sameStrings(page.ruleDomains.content_decisions ?? [], source.ruleIds);
}

function expectedInternalLinkBody(
  currentBody: string,
  source: Extract<ReturnType<typeof TopicalMapStoreTaskSourceSchema.parse>, { executable: true; action: "internal_link" }>,
): string {
  return `${currentBody}<p><a href="${escapeHtml(source.linkTargetUrl)}">${escapeHtml(source.linkAnchor)}</a></p>`;
}

function matchesFreshObservation(
  resource: GovernedStoreResource,
  source: Extract<ReturnType<typeof TopicalMapStoreTaskSourceSchema.parse>, { executable: true }>,
  proposed: Exclude<ReturnType<typeof TopicalMapStoreTaskProposedSchema.parse>, { action: "advisory" }>,
): boolean {
  if (source.action !== proposed.action) return false;
  if (proposed.action === "internal_link" && source.action === "internal_link") {
    return proposed.before.bodyHtml === resource.bodyHtml
      && proposed.after.bodyHtml === expectedInternalLinkBody(resource.bodyHtml, source);
  }
  if (proposed.action === "content_update") {
    return proposed.before.bodyHtml === resource.bodyHtml;
  }
  return Object.entries(proposed.before).every(([key, value]) => {
    return resource[key as "seoTitle" | "seoDescription"] === value;
  });
}

function changes(
  proposed: ReturnType<typeof TopicalMapStoreTaskProposedSchema.parse>,
  current: GovernedStoreResource,
  source: Extract<ReturnType<typeof TopicalMapStoreTaskSourceSchema.parse>, { executable: true }>,
): Record<string, string> {
  if (proposed.action === "advisory") {
    throw new TopicalMapApplyError("TASK_NOT_EXECUTABLE");
  }
  if (proposed.action === "internal_link" && source.action === "internal_link") {
    return { bodyHtml: expectedInternalLinkBody(current.bodyHtml, source) };
  }
  return { ...proposed.after };
}

function verified(resource: GovernedStoreResource, expected: Record<string, string>): boolean {
  return Object.entries(expected).every(([key, value]) => resource[key as keyof GovernedStoreResource] === value);
}

export async function approveTopicalMapStoreTask(db: Db, input: ApplyInput): Promise<{ taskId: string; recommendationId: string; status: "queued" }> {
  const row = await db.storeTask.findUnique({ where: { id: input.id } });
  if (!row || row.status !== "pending") throw new TopicalMapApplyError("TASK_NOT_PENDING");
  const source = TopicalMapStoreTaskSourceSchema.safeParse(row.sourceData);
  const proposed = TopicalMapStoreTaskProposedSchema.safeParse(row.proposedState);
  if (!source.success || !source.data.executable || !source.data.recommendationId || !proposed.success || proposed.data.action === "advisory") throw new TopicalMapApplyError("TASK_NOT_EXECUTABLE");
  const recommendationId = source.data.recommendationId;
  const approved = await db.$transaction(async (tx) => {
    const claimed = await tx.recommendation.updateMany({ where: { id: recommendationId, targetEntityId: row.id, platform: "shopify", actionType: "apply_topical_map_store_task", status: "pending" }, data: { status: "approved", reviewedBy: input.actor, reviewedAt: new Date() } });
    if (claimed.count !== 1) return false;
    await tx.storeTask.update({ where: { id: row.id }, data: { reviewedBy: input.actor, reviewedAt: new Date(), completionNote: "Approved and queued for guarded execution." } });
    await tx.auditLog.create({ data: { actor: input.actor, action: "topical_map_store_task_approved", entityType: "StoreTask", entityId: row.id, after: { recommendationId, status: "queued" } } });
    return true;
  });
  if (!approved) throw new TopicalMapApplyError("TASK_NOT_PENDING");
  return { taskId: row.id, recommendationId, status: "queued" };
}

export async function executeTopicalMapStoreTask(db: Db, input: ApplyInput & { recommendationId: string }): Promise<{ task: StoreTask; receipt: Receipt }> {
  const row = await db.storeTask.findUnique({ where: { id: input.id } });
  if (!row || row.status !== "pending") {
    throw new TopicalMapApplyError("TASK_NOT_PENDING");
  }
  const sourceResult = TopicalMapStoreTaskSourceSchema.safeParse(row.sourceData);
  const proposedResult = TopicalMapStoreTaskProposedSchema.safeParse(row.proposedState);
  if (!sourceResult.success || !sourceResult.data.executable || !proposedResult.success || proposedResult.data.action === "advisory") {
    throw new TopicalMapApplyError("TASK_NOT_EXECUTABLE");
  }
  const source = sourceResult.data;
  const proposed = proposedResult.data;
  if (source.recommendationId && source.recommendationId !== input.recommendationId) throw new TopicalMapApplyError("TASK_NOT_EXECUTABLE");
  const center = await loadActiveTopicalMapCommandCenter(db);
  if (!center || center.identity.versionId !== source.strategyVersionId || center.identity.packageSha256 !== source.packageSha256) {
    throw new TopicalMapApplyError("STRATEGY_CHANGED");
  }
  if (!stillGoverned(center, source, proposed)) {
    throw new TopicalMapApplyError("RULE_CHANGED");
  }
  const executionLock = (db as Db & { storeTaskExecutionLock?: Db["storeTaskExecutionLock"] }).storeTaskExecutionLock;
  try {
    await executionLock?.create({ data: { targetUrl: source.targetUrl, taskId: row.id } });
  } catch {
    throw new TopicalMapApplyError("TASK_NOT_PENDING");
  }
  try {
  const current = await fetchGovernedStoreResource(source.targetUrl);
  if (!current
    || current.type !== source.targetType
    || current.stateHash !== source.observedStateHash
    || !matchesFreshObservation(current, source, proposed)) {
    throw new TopicalMapApplyError("OBSERVATION_CHANGED");
  }
  const claimed = await db.$transaction((tx) => tx.storeTask.updateMany({
    where: { id: input.id, status: "pending" },
    data: { status: "applying", reviewedBy: input.actor, reviewedAt: new Date() },
  }));
  if (claimed.count !== 1) {
    throw new TopicalMapApplyError("TASK_NOT_PENDING");
  }

  const expected = changes(proposed, current, source);
  try {
    const updated = await applyGovernedStoreResourceChange(current, expected);
    if (!verified(updated, expected)) {
      throw new Error("RETURNED_STATE_MISMATCH");
    }
    const receipt: Receipt = {
      strategyVersionId: source.strategyVersionId,
      packageSha256: source.packageSha256,
      ruleIds: [...source.ruleIds].sort(),
      targetUrl: source.targetUrl,
      action: proposed.action,
      before: { ...proposed.before },
      after: expected,
    };
    const task = await db.$transaction(async (tx) => {
      const completed = await tx.storeTask.update({
        where: { id: input.id },
        data: { status: "completed", completedAt: new Date(), completionNote: "Shopify update verified." },
      });
      await tx.auditLog.create({
        data: {
          actor: input.actor,
          action: "topical_map_store_task_applied",
          entityType: "StoreTask",
          entityId: input.id,
          before: receipt.before as Prisma.InputJsonValue,
          after: receipt.after as Prisma.InputJsonValue,
          meta: {
            strategyVersionId: receipt.strategyVersionId,
            packageSha256: receipt.packageSha256,
            ruleIds: receipt.ruleIds,
            targetUrl: receipt.targetUrl,
            taskAction: receipt.action,
          },
        },
      });
      return completed;
    });
    return { task, receipt };
  } catch {
    await db.$transaction(async (tx) => {
      await tx.storeTask.update({
        where: { id: input.id },
        data: { status: "failed", completedAt: new Date(), completionNote: "Shopify may have accepted the request, but no verified receipt was persisted. Re-sync to reobserve before retrying." },
      });
      await tx.auditLog.create({
        data: {
          actor: input.actor,
          action: "topical_map_store_task_failed",
          entityType: "StoreTask",
          entityId: input.id,
          before: { ...proposed.before },
          after: Prisma.JsonNull,
          meta: {
            strategyVersionId: source.strategyVersionId,
            packageSha256: source.packageSha256,
            ruleIds: [...source.ruleIds].sort(),
            targetUrl: source.targetUrl,
            taskAction: proposed.action,
            code: "SHOPIFY_FAILED",
          },
        },
      });
    });
    throw new TopicalMapApplyError("SHOPIFY_FAILED");
  }
  } finally {
    await executionLock?.deleteMany({ where: { targetUrl: source.targetUrl, taskId: row.id } }).catch(() => undefined);
  }
}

/** @deprecated Test compatibility only; production dispatch must supply the exact approved recommendation identity. */
export async function applyTopicalMapStoreTask(db: Db, input: ApplyInput): Promise<{ task: StoreTask; receipt: Receipt }> {
  if (process.env.EXECUTE_APPROVED_LIVE_ENABLED !== "true") throw new TopicalMapApplyError("LIVE_DISABLED");
  const row = await db.storeTask.findUnique({ where: { id: input.id } });
  const source = TopicalMapStoreTaskSourceSchema.safeParse(row?.sourceData);
  if (!source.success || !source.data.executable) {
    if (!row || row.status !== "pending") throw new TopicalMapApplyError("TASK_NOT_PENDING");
    throw new TopicalMapApplyError("TASK_NOT_EXECUTABLE");
  }
  return executeTopicalMapStoreTask(db, { ...input, recommendationId: source.data.recommendationId ?? "legacy-test" });
}
