import { prisma } from "@/lib/db";
import { checkGuardrails } from "@/lib/guardrails";

type InsightRow = {
  skillId: string;
  skillName: string;
  insightType: string;
  items: unknown[];
  snapshotId: string;
};

type FatigueItem = {
  adId: string;
  adName: string;
  adSetName?: string | null;
  status: "urgent" | "warning" | "healthy" | "dead";
  rationale?: string;
  estimatedDaysLeft?: number | null;
};

function parseFatigueItem(raw: unknown): FatigueItem | null {
  if (raw === null || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.adId !== "string" || !item.adId) return null;
  const status = item.status;
  if (status !== "urgent" && status !== "warning" && status !== "healthy" && status !== "dead") return null;
  return {
    adId: item.adId,
    adName: typeof item.adName === "string" && item.adName ? item.adName : item.adId,
    adSetName: typeof item.adSetName === "string" ? item.adSetName : null,
    status,
    rationale: typeof item.rationale === "string" ? item.rationale : undefined,
    estimatedDaysLeft: typeof item.estimatedDaysLeft === "number" ? item.estimatedDaysLeft : null,
  };
}

// Deterministic converter: fatigue insights → pause_ad recommendations (dead|urgent)
// and refresh-creative StoreTasks (urgent only). Recommendations enter the normal
// pending → operator-approval → gated-executor pipeline; nothing here executes.
export async function createFatigueActions(input: {
  runId: string;
  rows: InsightRow[];
}): Promise<{ pauseRecs: number; refreshTasks: number }> {
  let pauseRecs = 0;
  let refreshTasks = 0;

  for (const rowItem of input.rows) {
    if (rowItem.insightType !== "fatigue-report") continue;

    for (const raw of rowItem.items) {
      const item = parseFatigueItem(raw);
      if (!item) continue;

      if (item.status === "dead" || item.status === "urgent") {
        const rationale =
          item.rationale ??
          `${item.adName} shows ${item.status} creative fatigue and should be paused pending a refresh.`;
        const rec = {
          actionType: "pause_ad",
          targetEntityType: "ad",
          targetEntityId: item.adId,
          targetEntityName: item.adName,
          currentValue: null as string | null,
          proposedValue: "paused" as string | null,
          changePercent: null as number | null,
          rationale,
          estimatedImpact: null as string | null,
          confidenceScore: item.status === "dead" ? 0.9 : 0.7,
        };

        // Roadmap dedup rule: skip if a live rec already targets this ad+action.
        const existing = await prisma.recommendation.findFirst({
          where: {
            platform: "meta",
            actionType: "pause_ad",
            targetEntityId: item.adId,
            status: { in: ["pending", "approved", "override_approved"] },
          },
        });
        if (!existing) {
          const guard = await checkGuardrails(rec);
          try {
            await prisma.recommendation.create({
              data: {
                platform: "meta",
                skillId: rowItem.skillId,
                skillName: rowItem.skillName,
                actionType: rec.actionType,
                targetEntityType: rec.targetEntityType,
                targetEntityId: rec.targetEntityId,
                targetEntityName: rec.targetEntityName,
                currentValue: rec.currentValue,
                proposedValue: rec.proposedValue,
                changePercent: rec.changePercent,
                rationale: rec.rationale,
                estimatedImpact: rec.estimatedImpact,
                confidenceScore: rec.confidenceScore,
                guardStatus: guard.status,
                guardReason: guard.status !== "clear" ? guard.reason : null,
                snapshotId: rowItem.snapshotId,
              },
            });
            pauseRecs++;
          } catch (err: unknown) {
            const isDup =
              err != null && typeof err === "object" && "code" in err &&
              (err as { code: string }).code === "P2002";
            if (!isDup) throw err;
          }
        }
      }

      if (item.status === "urgent") {
        await prisma.storeTask.upsert({
          where: { dedupeKey: `store-task:refresh-creative:${item.adId}` },
          update: { description: item.rationale ?? "Creative fatigue — refresh recommended.", updatedAt: new Date() },
          create: {
            taskType: "refresh_creative",
            targetType: "ad",
            targetId: item.adId,
            title: `Refresh creative for ${item.adName}`,
            description: item.rationale ?? "Creative fatigue — refresh recommended.",
            proposedState: { action: "refresh_creative", adId: item.adId, adSetName: item.adSetName ?? null },
            sourceData: { runId: input.runId, snapshotId: rowItem.snapshotId, skillId: rowItem.skillId },
            priority: "high",
            dedupeKey: `store-task:refresh-creative:${item.adId}`,
          },
        });
        refreshTasks++;
      }
    }
  }

  return { pauseRecs, refreshTasks };
}
