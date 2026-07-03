import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { checkGuardrails, type RecommendationInput } from "@/lib/guardrails";
import type { Recommendation } from "@prisma/client";
import { deriveGuardrailInputs } from "@/lib/recommendations/guardrail-inputs";
import { classifyMetaError, serializableMetaError } from "@/lib/connectors/meta-errors";
import type { JobResult, JobStatus } from "@/lib/jobs/types";
import { materializeJobsStatusSnapshot } from "@/lib/dashboard/jobs-status";

type ExecuteApprovedOptions = {
  dryRun?: boolean;
  triggeredBy?: string;
};

type ExecutionCounters = {
  considered: number;
  executed: number;
  simulated: number;
  failed: number;
  skipped: number;
  blocked: number;
};

type ExecutionCircuit = {
  metaDisabled: boolean;
  metaDisableReason: string | null;
  metaError: Record<string, unknown> | null;
};

function safeErrorMessage(err: unknown) {
  const isPrismaError =
    err != null &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string" &&
    ((err as { code: string }).code.startsWith("P") || (err as { code: string }).code.startsWith("E"));
  return isPrismaError
    ? `Database error (code: ${(err as { code: string }).code})`
    : String(err);
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function finalStatus(counters: ExecutionCounters): Extract<JobStatus, "success" | "partial" | "failed"> {
  if (counters.failed > 0) return counters.executed > 0 || counters.simulated > 0 ? "partial" : "failed";
  return "success";
}

function intendedChange(rec: Recommendation) {
  return {
    platform: rec.platform,
    actionType: rec.actionType,
    targetEntityType: rec.targetEntityType,
    targetEntityId: rec.targetEntityId,
    targetEntityName: rec.targetEntityName,
    currentValue: rec.currentValue,
    proposedValue: rec.proposedValue,
    changePercent: rec.changePercent,
  };
}

export async function executeApprovedHandler(options: ExecuteApprovedOptions = {}): Promise<JobResult<Prisma.InputJsonValue>> {
  const dryRun = options.dryRun === true;
  const run = await prisma.jobRun.create({
    data: {
      jobName: "execute-approved",
      triggeredBy: options.triggeredBy ?? "scheduler",
      dryRun,
    },
  });
  const counters: ExecutionCounters = {
    considered: 0,
    executed: 0,
    simulated: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
  };
  const circuit: ExecutionCircuit = {
    metaDisabled: false,
    metaDisableReason: null,
    metaError: null,
  };

  try {
  // Recover recs stuck in "executing" for more than 10 minutes (process died mid-run)
  try {
    if (!dryRun) {
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
      const staleRecs = await prisma.recommendation.findMany({
        where: { status: "executing", updatedAt: { lt: staleThreshold } },
        select: { id: true },
      });
      if (staleRecs.length > 0) {
        await prisma.$transaction([
          prisma.recommendation.updateMany({
            where: { id: { in: staleRecs.map((r) => r.id) } },
            data: {
              status: "failed",
              executionResult: json({ error: "Execution timed out — process likely died" }),
            },
          }),
          ...staleRecs.map((r) =>
            prisma.auditLog.create({
              data: {
                actor: "system",
                action: "execution_timeout_recovered",
                entityType: "recommendation",
                entityId: r.id,
                after: { error: "Execution timed out — process likely died" },
                meta: { dryRun: false, jobRunId: run.id },
              },
            })
          ),
        ]);
      }
    }
  } catch (err) {
    console.error("[execute-approved] stale-recovery failed — continuing:", err);
  }

  // Pick up both normal approved and override-approved (hard-block overrides)
  const approved = await prisma.recommendation.findMany({
    where: { status: { in: ["approved", "override_approved"] } },
    take: 10,
    orderBy: { reviewedAt: "asc" },
  });

  if (approved.length === 0) {
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        completedAt: new Date(),
        summary: json({ dryRun, ...counters }),
      },
    });
    await materializeJobsStatusSnapshot().catch((err) => console.error("[execute-approved] status snapshot failed", err));
    return {
      jobName: "execute-approved",
      runId: run.id,
      status: "success",
      summary: json({ dryRun, ...counters }),
      errors: [],
    };
  }

  const { executeRecommendation, isSupportedAction } = await import("@/lib/executor");

  for (const rec of approved) {
    counters.considered++;
    if (rec.platform === "meta" && circuit.metaDisabled) {
      counters.skipped++;
      await prisma.auditLog.create({
        data: {
          actor: "system",
          action: dryRun ? "execution_dry_run_skipped_connector_disabled" : "execution_skipped_connector_disabled",
          entityType: "recommendation",
          entityId: rec.id,
          after: json({
            error: circuit.metaDisableReason,
            connector: "meta",
            metaError: circuit.metaError,
            intendedChange: intendedChange(rec),
          }),
          meta: { dryRun, jobRunId: run.id, connector: "meta" },
        },
      });
      continue;
    }

    // Block unsupported actions before acquiring the idempotency lock.
    if (!isSupportedAction(rec.platform, rec.actionType)) {
      counters.blocked++;
      const error = `Unsupported action "${rec.actionType}" for platform "${rec.platform}" — blocked before execution`;
      if (dryRun) {
        await prisma.auditLog.create({
          data: {
            actor: "system",
            action: "execution_dry_run_blocked",
            entityType: "recommendation",
            entityId: rec.id,
            after: { error, intendedChange: intendedChange(rec) },
            meta: { dryRun: true, jobRunId: run.id, reason: "unsupported_action" },
          },
        });
      } else {
        await prisma.$transaction([
          prisma.recommendation.update({
            where: { id: rec.id },
            data: {
              status: "failed",
              executionResult: json({ error }),
            },
          }),
          prisma.auditLog.create({
            data: {
              actor: "system",
              action: "execution_blocked_unsupported_action",
              entityType: "recommendation",
              entityId: rec.id,
              after: { platform: rec.platform, actionType: rec.actionType },
              meta: { dryRun: false, jobRunId: run.id },
            },
          }),
        ]);
      }
      continue;
    }

    const originalStatus = rec.status; // capture before updateMany lock
    if (!dryRun) {
      // Idempotency lock — only proceeds if status is still approved/override_approved
      const locked = await prisma.recommendation.updateMany({
        where: { id: rec.id, status: { in: ["approved", "override_approved"] } },
        data: { status: "executing" } as Prisma.RecommendationUpdateManyMutationInput,
      });
      if (locked.count === 0) {
        counters.skipped++;
        continue;
      }
    }

    try {
      // Re-check guardrails using snapshot data — skip for override_approved (already overridden)
      if (originalStatus === "approved") {
        const { conversionCount, dailyBudgetPhp } = await deriveGuardrailInputs(rec);
        const guardInput: RecommendationInput = {
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
        };
        const guard = await checkGuardrails(guardInput);

        // H-9: warn if conditions changed since approval
        if (guard.status !== rec.guardStatus) {
          console.warn(
            `[execute-approved] Guard status changed for rec ${rec.id}: was "${rec.guardStatus}" at approval, now "${guard.status}". Reason: ${"reason" in guard ? guard.reason : "n/a"}`
          );
        }

        if (guard.status === "hard_block") {
          counters.blocked++;
          const action = dryRun ? "execution_dry_run_blocked" : "execution_blocked_by_guardrail";
          const audit = prisma.auditLog.create({
            data: {
              actor: "system",
              action,
              entityType: "recommendation",
              entityId: rec.id,
              after: { reason: guard.reason, intendedChange: intendedChange(rec) },
              meta: { dryRun, jobRunId: run.id, reason: "guardrail" },
            },
          });
          if (dryRun) {
            await audit;
          } else {
            await prisma.$transaction([
              prisma.recommendation.update({
                where: { id: rec.id },
                data: {
                  status: "failed",
                  executionResult: json({ error: `Guardrail re-check blocked: ${guard.reason}` }),
                },
              }),
              audit,
            ]);
          }
          continue;
        }
      }

      // Capture before-state
      let beforeState: Record<string, unknown> = {};
      try {
        if (rec.platform === "meta") {
          const { fetchMetaEntityState } = await import("@/lib/connectors/meta");
          beforeState = await fetchMetaEntityState(rec.targetEntityId);
        }
      } catch {
        beforeState = { error: "Could not fetch before-state" };
      }

      await prisma.auditLog.create({
        data: {
          actor: "system",
          action: dryRun ? "execution_dry_run_started" : "execution_started",
          entityType: "recommendation",
          entityId: rec.id,
          before: json(beforeState),
          after: json({ intendedChange: intendedChange(rec) }),
          meta: { dryRun, jobRunId: run.id },
        },
      });

      if (dryRun) {
        counters.simulated++;
        await prisma.auditLog.create({
          data: {
            actor: "system",
            action: "execution_dry_run_success",
            entityType: "recommendation",
            entityId: rec.id,
            before: json(beforeState),
            after: json({
              simulated: true,
              intendedChange: intendedChange(rec),
              result: "No connector call was made and recommendation status was not changed.",
            }),
            meta: { dryRun: true, jobRunId: run.id },
          },
        });
        continue;
      }

      const result = await executeRecommendation(rec);

      // H-7: atomic — status update and audit log succeed or fail together
      await prisma.$transaction([
        prisma.recommendation.update({
          where: { id: rec.id },
          data: { status: "executed", executedAt: new Date(), executionResult: json(result) },
        }),
        prisma.auditLog.create({
          data: {
            actor: "system",
            action: "execution_success",
            entityType: "recommendation",
            entityId: rec.id,
            before: json(beforeState),
            after: json({ result, intendedChange: intendedChange(rec) }),
            meta: { dryRun: false, jobRunId: run.id },
          },
        }),
      ]);
      counters.executed++;
    } catch (err) {
      // Sanitize DB errors to avoid leaking schema details (FK names, table names) into audit log
      const safeError = safeErrorMessage(err);
      const metaError = serializableMetaError(err);
      if (rec.platform === "meta" && classifyMetaError(err) === "global") {
        circuit.metaDisabled = true;
        circuit.metaDisableReason = safeError;
        circuit.metaError = metaError;
      }
      counters.failed++;
      const audit = prisma.auditLog.create({
        data: {
          actor: "system",
          action: dryRun ? "execution_dry_run_failed" : "execution_failed",
          entityType: "recommendation",
          entityId: rec.id,
          after: json({ error: safeError, metaError, intendedChange: intendedChange(rec) }),
          meta: { dryRun, jobRunId: run.id },
        },
      });
      if (dryRun) {
        await audit;
      } else {
        await prisma.$transaction([
          prisma.recommendation.update({
            where: { id: rec.id },
            data: { status: "failed", executionResult: json({ error: safeError, metaError }) },
          }),
          audit,
        ]);
      }
    }
  }

  await prisma.jobRun.update({
    where: { id: run.id },
    data: {
      status: finalStatus(counters),
      completedAt: new Date(),
      summary: json({ dryRun, ...counters }),
      errorLog: counters.failed > 0
        ? [
            `${counters.failed} recommendation execution attempt(s) failed`,
            circuit.metaDisabled ? `Meta disabled for this run: ${circuit.metaDisableReason}` : null,
          ].filter(Boolean).join("\n")
        : null,
    },
  });
  await materializeJobsStatusSnapshot().catch((err) => console.error("[execute-approved] status snapshot failed", err));
  return {
    jobName: "execute-approved",
    runId: run.id,
    status: finalStatus(counters),
    summary: json({ dryRun, ...counters }),
    errors: counters.failed > 0 ? [`${counters.failed} recommendation execution attempt(s) failed`] : [],
  };
  } catch (err) {
    const safeError = safeErrorMessage(err);
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        summary: json({ dryRun, ...counters }),
        errorLog: safeError,
      },
    }).catch(() => {});
    throw err;
  }
}
