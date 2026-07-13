import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { TopicalMapStoreTaskSourceSchema } from "@/lib/store-tasks/topical-map";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";

export type AdvisoryDatabase = Pick<typeof prisma, "storeTask" | "recommendation" | "auditLog" | "$transaction">;

export type AdvisorySemanticIdentity = {
  strategyVersionId: string;
  packageSha256: string;
  targetUrl: string;
  advisoryReason: string;
  ruleIds: string[];
};

export type AdvisoryDuplicateRow = {
  id: string;
  createdAt: Date;
  status: string;
  sourceData: unknown;
};

export type AdvisoryDuplicateGroup = {
  semanticKey: string;
  keepId: string;
  dismissIds: string[];
};

function canonicalIdentity(input: AdvisorySemanticIdentity): string {
  return JSON.stringify({
    strategyVersionId: input.strategyVersionId,
    packageSha256: input.packageSha256.toLowerCase(),
    targetUrl: normalizeGovernedUrl(input.targetUrl),
    advisoryReason: input.advisoryReason,
    ruleIds: [...new Set(input.ruleIds)].sort(),
  });
}

export function topicalMapAdvisorySemanticKey(input: AdvisorySemanticIdentity): string {
  return createHash("sha256").update(canonicalIdentity(input)).digest("hex");
}

function newestFirst(left: AdvisoryDuplicateRow, right: AdvisoryDuplicateRow): number {
  return right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id);
}

export function selectAdvisoryDuplicateGroups(rows: AdvisoryDuplicateRow[]): AdvisoryDuplicateGroup[] {
  const grouped = new Map<string, AdvisoryDuplicateRow[]>();

  for (const row of rows) {
    if (!["pending", "failed"].includes(row.status)) continue;
    const parsed = TopicalMapStoreTaskSourceSchema.safeParse(row.sourceData);
    if (!parsed.success || parsed.data.source !== "topical-map" || parsed.data.executable !== false) continue;
    const semanticKey = topicalMapAdvisorySemanticKey({
      strategyVersionId: parsed.data.strategyVersionId,
      packageSha256: parsed.data.packageSha256,
      targetUrl: parsed.data.targetUrl,
      advisoryReason: parsed.data.advisoryReason,
      ruleIds: parsed.data.ruleIds,
    });
    grouped.set(semanticKey, [...(grouped.get(semanticKey) ?? []), row]);
  }

  return [...grouped.entries()]
    .flatMap(([semanticKey, candidates]) => {
      if (candidates.length < 2) return [];
      const pending = candidates.filter((row) => row.status === "pending").sort(newestFirst);
      const keep = pending[0] ?? [...candidates].sort(newestFirst)[0]!;
      return [{
        semanticKey,
        keepId: keep.id,
        dismissIds: candidates.filter((row) => row.id !== keep.id).map((row) => row.id).sort(),
      }];
    })
    .sort((left, right) => left.semanticKey.localeCompare(right.semanticKey));
}

async function excludeApprovedAdvisoryWork(
  db: AdvisoryDatabase,
  rows: AdvisoryDuplicateRow[],
): Promise<AdvisoryDuplicateRow[]> {
  if (!rows.length) return rows;
  const protectedRecommendations = await db.recommendation.findMany({
    where: {
      targetEntityId: { in: rows.map((row) => row.id) },
      platform: "shopify",
      actionType: "apply_topical_map_store_task",
      status: { in: ["approved", "override_approved", "executing"] },
    },
    select: { targetEntityId: true },
  });
  const protectedIds = new Set(protectedRecommendations.map((recommendation) => recommendation.targetEntityId));
  return rows.filter((row) => !protectedIds.has(row.id));
}

async function dismissAdvisoryDuplicateGroup(
  db: AdvisoryDatabase,
  group: AdvisoryDuplicateGroup,
  actor: string,
): Promise<{ dismissed: number; rejectedRecommendations: number }> {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const note = `Superseded by topical-map advisory ${group.keepId}`;
    const updated = await tx.storeTask.updateMany({
      where: { id: { in: group.dismissIds }, status: { in: ["pending", "failed"] } },
      data: { status: "dismissed", completedAt: now, completionNote: note },
    });
    if (updated.count !== group.dismissIds.length) throw new Error("Advisory cleanup lost a concurrent update");
    const rejected = await tx.recommendation.updateMany({
      where: {
        targetEntityId: { in: group.dismissIds },
        platform: "shopify",
        actionType: "apply_topical_map_store_task",
        status: { in: ["pending", "failed"] },
      },
      data: {
        status: "rejected",
        reviewedBy: actor,
        reviewedAt: now,
        reviewNote: note,
      },
    });
    for (const id of group.dismissIds) {
      await tx.auditLog.create({
        data: {
          actor,
          action: "topical_map_advisory_superseded",
          entityType: "StoreTask",
          entityId: id,
          after: { status: "dismissed", replacementTaskId: group.keepId, semanticKey: group.semanticKey },
        },
      });
    }
    return { dismissed: updated.count, rejectedRecommendations: rejected.count };
  });
}

export async function supersedeEquivalentAdvisories(
  db: AdvisoryDatabase,
  options: { semanticKey: string; keepId: string; actor: string },
): Promise<{ dismissed: number; rejectedRecommendations: number }> {
  const rows = await db.storeTask.findMany({
    where: {
      taskType: "topical_map",
      status: { in: ["pending", "failed"] },
      executionReceipt: { equals: Prisma.DbNull },
    },
    select: { id: true, createdAt: true, status: true, sourceData: true },
  });
  const eligibleRows = await excludeApprovedAdvisoryWork(db, rows);
  const group = selectAdvisoryDuplicateGroups(eligibleRows).find((candidate) =>
    candidate.semanticKey === options.semanticKey && candidate.keepId === options.keepId);
  if (!group) return { dismissed: 0, rejectedRecommendations: 0 };
  return dismissAdvisoryDuplicateGroup(db, group, options.actor);
}

export async function cleanupTopicalMapAdvisories(
  db: Pick<typeof prisma, "storeTask" | "recommendation" | "auditLog" | "$transaction">,
  options: { apply: boolean; actor: string },
): Promise<{ groups: number; kept: number; duplicates: number; dismissed: number; rejectedRecommendations: number }> {
  const rows = await db.storeTask.findMany({
    where: {
      taskType: "topical_map",
      status: { in: ["pending", "failed"] },
      executionReceipt: { equals: Prisma.DbNull },
    },
    select: { id: true, createdAt: true, status: true, sourceData: true },
  });
  const eligibleRows = await excludeApprovedAdvisoryWork(db, rows);
  const groups = selectAdvisoryDuplicateGroups(eligibleRows);
  const result = {
    groups: groups.length,
    kept: groups.length,
    duplicates: groups.reduce((total, group) => total + group.dismissIds.length, 0),
    dismissed: 0,
    rejectedRecommendations: 0,
  };
  if (!options.apply) return result;

  for (const group of groups) {
    const applied = await dismissAdvisoryDuplicateGroup(db, group, options.actor);
    result.dismissed += applied.dismissed;
    result.rejectedRecommendations += applied.rejectedRecommendations;
  }
  return result;
}
