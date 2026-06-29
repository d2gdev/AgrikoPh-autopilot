import { prisma } from "@/lib/db";
import { isSupportedAction } from "@/lib/executor";
import { checkGuardrails } from "@/lib/guardrails";
import { deriveGuardrailInputsFromPayload } from "@/lib/recommendations/guardrail-inputs";

const QUEUE_STATUSES = ["approved", "override_approved"] as const;
const DRY_RUN_AUDIT_ACTIONS = [
  "execution_dry_run_blocked",
  "execution_dry_run_failed",
  "execution_dry_run_success",
] as const;

function auditMessage(after: unknown) {
  if (!after || typeof after !== "object") return "No reason recorded";
  const record = after as Record<string, unknown>;
  if (typeof record.reason === "string" && record.reason.trim()) return record.reason.trim();
  if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
  return "No reason recorded";
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topCounts(map: Map<string, number>, limit = 10) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function guardrailReason(status: string, reason?: string) {
  return reason && reason.trim() ? reason.trim() : status;
}

export async function getExecutionQueueSummary() {
  const [queued, lastDryRun] = await Promise.all([
    prisma.recommendation.findMany({
      where: { status: { in: [...QUEUE_STATUSES] } },
      select: {
        id: true,
        status: true,
        platform: true,
        targetEntityType: true,
        targetEntityId: true,
        targetEntityName: true,
        actionType: true,
        currentValue: true,
        proposedValue: true,
        changePercent: true,
        confidenceScore: true,
        guardStatus: true,
        snapshot: {
          select: { payload: true },
        },
      },
      orderBy: { reviewedAt: "asc" },
    }),
    prisma.jobRun.findFirst({
      where: { jobName: "execute-approved", dryRun: true },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        dryRun: true,
        startedAt: true,
        completedAt: true,
        summary: true,
        errorLog: true,
      },
    }),
  ]);

  let supported = 0;
  let unsupported = 0;
  let hardBlocked = 0;
  const byStatus = new Map<string, number>();
  const byPlatformAction = new Map<string, number>();
  const preflightByStatus = new Map<string, number>();
  const preflightReasons = new Map<string, number>();

  for (const rec of queued) {
    increment(byStatus, rec.status);
    increment(byPlatformAction, `${rec.platform}:${rec.actionType}`);
    if (rec.guardStatus === "hard_block") hardBlocked++;
    if (isSupportedAction(rec.platform, rec.actionType)) supported++;
    else unsupported++;

    try {
      const { conversionCount, dailyBudgetPhp } = deriveGuardrailInputsFromPayload(
        rec,
        rec.snapshot.payload as Record<string, unknown>
      );
      const guard = await checkGuardrails({
        actionType: rec.actionType,
        targetEntityType: rec.targetEntityType,
        targetEntityId: rec.targetEntityId,
        targetEntityName: rec.targetEntityName,
        currentValue: rec.currentValue,
        proposedValue: rec.proposedValue,
        changePercent: rec.changePercent,
        confidenceScore: rec.confidenceScore,
        conversionCount,
        dailyBudgetPhp,
      });
      increment(preflightByStatus, guard.status);
      if (guard.status !== "clear") increment(preflightReasons, guardrailReason(guard.status, guard.reason));
    } catch (err) {
      increment(preflightByStatus, "failed");
      increment(preflightReasons, `Preflight failed: ${String(err).slice(0, 200)}`);
    }
  }

  const latestDryRunAudits = lastDryRun
    ? await prisma.auditLog.findMany({
        where: {
          action: { in: [...DRY_RUN_AUDIT_ACTIONS] },
          meta: { path: ["jobRunId"], equals: lastDryRun.id },
        },
        orderBy: { createdAt: "desc" },
        select: {
          action: true,
          after: true,
          createdAt: true,
          entityId: true,
        },
      })
    : [];

  const dryRunActions = new Map<string, number>();
  const dryRunReasons = new Map<string, number>();
  for (const audit of latestDryRunAudits) {
    increment(dryRunActions, audit.action);
    increment(dryRunReasons, auditMessage(audit.after));
  }

  return {
    queue: {
      total: queued.length,
      supported,
      unsupported,
      hardBlocked,
      byStatus: topCounts(byStatus),
      byPlatformAction: topCounts(byPlatformAction),
      preflight: {
        byStatus: topCounts(preflightByStatus),
        reasons: topCounts(preflightReasons),
      },
    },
    lastDryRun: lastDryRun
      ? {
          ...lastDryRun,
          dryRunActions: topCounts(dryRunActions),
          dryRunReasons: topCounts(dryRunReasons),
        }
      : null,
  };
}
