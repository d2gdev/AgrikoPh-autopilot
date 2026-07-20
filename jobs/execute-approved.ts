import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { checkGuardrails, type RecommendationInput } from "@/lib/guardrails";
import type { Recommendation } from "@prisma/client";
import { deriveGuardrailInputs } from "@/lib/recommendations/guardrail-inputs";
import { classifyMetaError, serializableMetaError } from "@/lib/connectors/meta-errors";
import type { JobResult, JobStatus } from "@/lib/jobs/types";
import { materializeJobsStatusSnapshot } from "@/lib/dashboard/jobs-status";
import { sendOperatorAlert } from "@/lib/alerts";
import type { TopicalMapApplyDiagnostic, TopicalMapApplyErrorCode } from "@/lib/store-tasks/apply-topical-map";

export type ExecuteApprovedOptions = {
  liveRequested?: boolean;
  triggeredBy?: string;
  recommendationId?: string;
};

type ExecutionCounters = {
  considered: number;
  executed: number;
  simulated: number;
  failed: number;
  skipped: number;
  blocked: number;
  superseded: number;
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

export function resolveExecutionMode(liveRequested = false) {
  const liveEnabled = process.env.EXECUTE_APPROVED_LIVE_ENABLED === "true";
  return { liveEnabled, dryRun: !(liveRequested && liveEnabled) };
}

export async function executeApprovedHandler(options: ExecuteApprovedOptions = {}): Promise<JobResult<Prisma.InputJsonValue>> {
  const { dryRun } = resolveExecutionMode(options.liveRequested);
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
    superseded: 0,
  };
  const circuit: ExecutionCircuit = {
    metaDisabled: false,
    metaDisableReason: null,
    metaError: null,
  };

  try {
  // Recover recs stuck in "executing" for more than 10 minutes (process died mid-run)
    if (!dryRun) {
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
      let staleRecs: Recommendation[] = [];
      try {
        staleRecs = await prisma.recommendation.findMany({
          where: {
            status: "executing",
            updatedAt: { lt: staleThreshold },
            ...(options.recommendationId ? { id: options.recommendationId } : {}),
          },
        });
      } catch (err) {
        console.error("[execute-approved] stale selection failed — continuing:", err);
      }
      if (staleRecs.length > 0) {
        for (const stale of staleRecs) {
          if (stale.platform === "shopify" && stale.actionType === "apply_topical_map_store_task") {
            const { reobserveTopicalMapReceipt, receiptJson } = await import("@/lib/store-tasks/apply-topical-map");
            let receipt: Awaited<ReturnType<typeof reobserveTopicalMapReceipt>> = null;
            try { receipt = await reobserveTopicalMapReceipt(prisma, stale); }
            catch (err) {
              console.error(`[execute-approved] stale Shopify reobservation failed for ${stale.id} — continuing:`, err);
              continue;
            }
            if (receipt) {
              await prisma.$transaction([
                prisma.storeTask.update({ where: { id: stale.targetEntityId }, data: { status: "completed", completedAt: new Date(), completionNote: "Recovered and verified after interrupted execution.", executionReceipt: receiptJson(receipt) } }),
                prisma.recommendation.update({ where: { id: stale.id }, data: { status: "executed", executedAt: new Date(), executionResult: receiptJson(receipt) } }),
                prisma.storeTaskExecutionLock.deleteMany({ where: { taskId: stale.targetEntityId, ownerId: stale.id } }),
                prisma.auditLog.create({ data: { actor: "system", action: "execution_timeout_reconciled", entityType: "recommendation", entityId: stale.id, after: receiptJson(receipt), meta: { jobRunId: run.id } } }),
              ]);
            } else {
              await prisma.$transaction([
                prisma.storeTask.updateMany({ where: { id: stale.targetEntityId, status: { in: ["applying", "reconciliation_needed"] } }, data: { status: "failed", completedAt: new Date(), completionNote: "Interrupted execution was not present on Shopify. Re-sync before retrying." } }),
                prisma.recommendation.update({ where: { id: stale.id }, data: { status: "failed", executionResult: json({ error: "Interrupted execution could not be verified" }) } }),
                prisma.storeTaskExecutionLock.deleteMany({ where: { taskId: stale.targetEntityId, ownerId: stale.id } }),
                prisma.auditLog.create({ data: { actor: "system", action: "execution_timeout_recovery_failed", entityType: "recommendation", entityId: stale.id, after: { error: "Interrupted execution could not be verified" }, meta: { dryRun: false, jobRunId: run.id } } }),
              ]);
            }
          } else if (stale.platform === "shopify"
            && stale.actionType === "remove_homepage_offer_catalog") {
            try {
              const { applyApprovedHomepageSchemaRecommendation } = await import(
                "@/lib/recommendations/homepage-schema"
              );
              const receipt = await applyApprovedHomepageSchemaRecommendation(stale);
              await prisma.$transaction([
                prisma.recommendation.update({
                  where: { id: stale.id },
                  data: {
                    status: "executed",
                    executedAt: new Date(),
                    executionResult: json(receipt),
                  },
                }),
                prisma.auditLog.create({
                  data: {
                    actor: "system",
                    action: "homepage_schema_execution_timeout_reconciled",
                    entityType: "recommendation",
                    entityId: stale.id,
                    after: json(receipt),
                    meta: { jobRunId: run.id },
                  },
                }),
              ]);
            } catch (err) {
              console.error(
                `[execute-approved] stale homepage schema reobservation failed for ${stale.id} — continuing:`,
                err,
              );
            }
          } else if (stale.platform === "shopify"
            && stale.actionType === "fix_robots_sitemap_url") {
            try {
              const { applyApprovedRobotsSitemapRecommendation } = await import(
                "@/lib/recommendations/robots-sitemap"
              );
              const receipt =
                await applyApprovedRobotsSitemapRecommendation(stale);
              await prisma.$transaction([
                prisma.recommendation.update({
                  where: { id: stale.id },
                  data: {
                    status: "executed",
                    executedAt: new Date(),
                    executionResult: json(receipt),
                  },
                }),
                prisma.auditLog.create({
                  data: {
                    actor: "system",
                    action: "robots_sitemap_execution_timeout_reconciled",
                    entityType: "recommendation",
                    entityId: stale.id,
                    after: json(receipt),
                    meta: { jobRunId: run.id },
                  },
                }),
              ]);
            } catch (err) {
              console.error(
                `[execute-approved] stale robots sitemap reobservation failed for ${stale.id} — continuing:`,
                err,
              );
            }
          } else if (stale.platform === "shopify"
            && stale.actionType === "sync_theme_source_assets") {
            try {
              const { applyApprovedThemeSourceSyncRecommendation } = await import(
                "@/lib/recommendations/theme-source-sync"
              );
              const receipt =
                await applyApprovedThemeSourceSyncRecommendation(stale);
              await prisma.$transaction([
                prisma.recommendation.update({
                  where: { id: stale.id },
                  data: {
                    status: "executed",
                    executedAt: new Date(),
                    executionResult: json(receipt),
                  },
                }),
                prisma.auditLog.create({
                  data: {
                    actor: "system",
                    action: "theme_source_sync_execution_timeout_reconciled",
                    entityType: "recommendation",
                    entityId: stale.id,
                    after: json(receipt),
                    meta: { jobRunId: run.id },
                  },
                }),
              ]);
            } catch (err) {
              console.error(
                `[execute-approved] stale theme source sync reobservation failed for ${stale.id} — continuing:`,
                err,
              );
            }
          } else if (stale.platform === "shopify"
            && stale.actionType === "flush_shopify_theme_page_cache") {
            try {
              const { applyApprovedThemeCacheFlushRecommendation } =
                await import("@/lib/recommendations/theme-cache-flush");
              const receipt =
                await applyApprovedThemeCacheFlushRecommendation(stale);
              await prisma.$transaction([
                prisma.recommendation.update({
                  where: { id: stale.id },
                  data: {
                    status: "executed",
                    executedAt: new Date(),
                    executionResult: json(receipt),
                  },
                }),
                prisma.auditLog.create({
                  data: {
                    actor: "system",
                    action:
                      "theme_cache_flush_execution_timeout_reconciled",
                    entityType: "recommendation",
                    entityId: stale.id,
                    after: json(receipt),
                    meta: { jobRunId: run.id },
                  },
                }),
              ]);
            } catch (err) {
              console.error(
                `[execute-approved] stale theme cache flush reobservation failed for ${stale.id} — continuing:`,
                err,
              );
            }
          } else if (stale.platform === "shopify"
            && stale.actionType === "refresh_shopify_article_page_cache") {
            try {
              const { applyApprovedArticleCacheRefreshRecommendation } =
                await import("@/lib/recommendations/article-cache-refresh");
              const receipt =
                await applyApprovedArticleCacheRefreshRecommendation(stale);
              await prisma.$transaction([
                prisma.recommendation.update({
                  where: { id: stale.id },
                  data: {
                    status: "executed",
                    executedAt: new Date(),
                    executionResult: json(receipt),
                  },
                }),
                prisma.auditLog.create({
                  data: {
                    actor: "system",
                    action:
                      "article_cache_refresh_execution_timeout_reconciled",
                    entityType: "recommendation",
                    entityId: stale.id,
                    after: json(receipt),
                    meta: { jobRunId: run.id },
                  },
                }),
              ]);
            } catch (err) {
              console.error(
                `[execute-approved] stale article cache refresh failed for ${stale.id} — continuing:`,
                err,
              );
            }
          } else {
            await prisma.$transaction([
              prisma.recommendation.update({ where: { id: stale.id }, data: { status: "failed", executionResult: json({ error: "Execution timed out — process likely died" }) } }),
              prisma.auditLog.create({ data: { actor: "system", action: "execution_timeout_recovered", entityType: "recommendation", entityId: stale.id, after: { error: "Execution timed out — process likely died" }, meta: { dryRun: false, jobRunId: run.id } } }),
            ]);
          }
        }
      }
    }

  // Pick up both normal approved and override-approved (hard-block overrides)
  const approved = await prisma.recommendation.findMany({
    where: {
      status: { in: ["approved", "override_approved"] },
      ...(options.recommendationId ? { id: options.recommendationId } : {}),
    },
    take: options.recommendationId ? 1 : 10,
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
    let verifiedShopifyReceipt: Record<string, unknown> | null = null;
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
      if (rec.platform === "shopify" && rec.actionType === "apply_topical_map_store_task") {
        if (dryRun) {
          counters.simulated++;
          await prisma.auditLog.create({ data: { actor: "system", action: "execution_dry_run_success", entityType: "recommendation", entityId: rec.id, after: { simulated: true, intendedChange: intendedChange(rec), result: "No Shopify call was made." }, meta: { dryRun: true, jobRunId: run.id } } });
          continue;
        }
        const { dispatchClaimedTopicalMapStoreTask, receiptJson } = await import("@/lib/store-tasks/apply-topical-map");
        const receipt = await dispatchClaimedTopicalMapStoreTask(prisma, { ...rec, status: "executing" });
        verifiedShopifyReceipt = receipt as unknown as Record<string, unknown>;
        await prisma.$transaction([
          prisma.storeTask.update({ where: { id: receipt.taskId }, data: { status: "completed", completedAt: new Date(), completionNote: "Shopify update verified.", executionReceipt: receiptJson(receipt) } }),
          prisma.recommendation.update({ where: { id: rec.id }, data: { status: "executed", executedAt: new Date(), executionResult: receiptJson(receipt) } }),
          prisma.auditLog.create({ data: { actor: "system", action: "topical_map_store_task_applied", entityType: "StoreTask", entityId: receipt.taskId, after: receiptJson(receipt), meta: { jobRunId: run.id } } }),
          prisma.auditLog.create({ data: { actor: "system", action: "execution_success", entityType: "recommendation", entityId: rec.id, after: receiptJson(receipt), meta: { dryRun: false, jobRunId: run.id } } }),
          prisma.storeTaskExecutionLock.deleteMany({ where: { targetUrl: receipt.targetUrl, taskId: receipt.taskId, ownerId: rec.id } }),
        ]);
        counters.executed++;
        continue;
      }
      if (rec.platform === "shopify" && rec.actionType === "update_product_image_alt_text") {
        if (dryRun) {
          counters.simulated++;
          await prisma.auditLog.create({
            data: {
              actor: "system",
              action: "execution_dry_run_success",
              entityType: "recommendation",
              entityId: rec.id,
              after: {
                simulated: true,
                intendedChange: intendedChange(rec),
                result: "No Shopify call was made.",
              },
              meta: { dryRun: true, jobRunId: run.id },
            },
          });
          continue;
        }
        const { applyApprovedImageAltTextRecommendation } = await import(
          "@/lib/images/alt-text-recommendation"
        );
        const receipt = await applyApprovedImageAltTextRecommendation({
          ...rec,
          status: "executing",
        });
        await prisma.$transaction([
          prisma.recommendation.update({
            where: { id: rec.id },
            data: {
              status: "executed",
              executedAt: new Date(),
              executionResult: json(receipt),
            },
          }),
          prisma.auditLog.create({
            data: {
              actor: "system",
              action: "image_alt_text_applied",
              entityType: "recommendation",
              entityId: rec.id,
              after: json(receipt),
              meta: { dryRun: false, jobRunId: run.id },
            },
          }),
        ]);
        counters.executed++;
        continue;
      }
      if (rec.platform === "shopify"
        && rec.actionType === "remove_homepage_offer_catalog") {
        if (dryRun) {
          counters.simulated++;
          await prisma.auditLog.create({
            data: {
              actor: "system",
              action: "execution_dry_run_success",
              entityType: "recommendation",
              entityId: rec.id,
              after: {
                simulated: true,
                intendedChange: intendedChange(rec),
                result: "No Shopify call was made.",
              },
              meta: { dryRun: true, jobRunId: run.id },
            },
          });
          continue;
        }
        const { applyApprovedHomepageSchemaRecommendation } = await import(
          "@/lib/recommendations/homepage-schema"
        );
        const receipt = await applyApprovedHomepageSchemaRecommendation({
          ...rec,
          status: "executing",
        });
        verifiedShopifyReceipt = receipt;
        await prisma.$transaction([
          prisma.recommendation.update({
            where: { id: rec.id },
            data: {
              status: "executed",
              executedAt: new Date(),
              executionResult: json(receipt),
            },
          }),
          prisma.auditLog.create({
            data: {
              actor: "system",
              action: "homepage_schema_applied",
              entityType: "recommendation",
              entityId: rec.id,
              after: json(receipt),
              meta: { dryRun: false, jobRunId: run.id },
            },
          }),
        ]);
        counters.executed++;
        continue;
      }
      if (rec.platform === "shopify"
        && rec.actionType === "fix_robots_sitemap_url") {
        if (dryRun) {
          counters.simulated++;
          await prisma.auditLog.create({
            data: {
              actor: "system",
              action: "execution_dry_run_success",
              entityType: "recommendation",
              entityId: rec.id,
              after: {
                simulated: true,
                intendedChange: intendedChange(rec),
                result: "No Shopify call was made.",
              },
              meta: { dryRun: true, jobRunId: run.id },
            },
          });
          continue;
        }
        const { applyApprovedRobotsSitemapRecommendation } = await import(
          "@/lib/recommendations/robots-sitemap"
        );
        const receipt = await applyApprovedRobotsSitemapRecommendation({
          ...rec,
          status: "executing",
        });
        verifiedShopifyReceipt = receipt;
        await prisma.$transaction([
          prisma.recommendation.update({
            where: { id: rec.id },
            data: {
              status: "executed",
              executedAt: new Date(),
              executionResult: json(receipt),
            },
          }),
          prisma.auditLog.create({
            data: {
              actor: "system",
              action: "robots_sitemap_applied",
              entityType: "recommendation",
              entityId: rec.id,
              after: json(receipt),
              meta: { dryRun: false, jobRunId: run.id },
            },
          }),
        ]);
        counters.executed++;
        continue;
      }
      if (rec.platform === "shopify"
        && rec.actionType === "sync_theme_source_assets") {
        if (dryRun) {
          counters.simulated++;
          await prisma.auditLog.create({
            data: {
              actor: "system",
              action: "execution_dry_run_success",
              entityType: "recommendation",
              entityId: rec.id,
              after: {
                simulated: true,
                intendedChange: intendedChange(rec),
                result: "No Shopify call was made.",
              },
              meta: { dryRun: true, jobRunId: run.id },
            },
          });
          continue;
        }
        const { applyApprovedThemeSourceSyncRecommendation } = await import(
          "@/lib/recommendations/theme-source-sync"
        );
        const receipt = await applyApprovedThemeSourceSyncRecommendation({
          ...rec,
          status: "executing",
        });
        verifiedShopifyReceipt = receipt;
        await prisma.$transaction([
          prisma.recommendation.update({
            where: { id: rec.id },
            data: {
              status: "executed",
              executedAt: new Date(),
              executionResult: json(receipt),
            },
          }),
          prisma.auditLog.create({
            data: {
              actor: "system",
              action: "theme_source_assets_applied",
              entityType: "recommendation",
              entityId: rec.id,
              after: json(receipt),
              meta: { dryRun: false, jobRunId: run.id },
            },
          }),
        ]);
        counters.executed++;
        continue;
      }
      if (rec.platform === "shopify"
        && rec.actionType === "flush_shopify_theme_page_cache") {
        if (dryRun) {
          counters.simulated++;
          await prisma.auditLog.create({
            data: {
              actor: "system",
              action: "execution_dry_run_success",
              entityType: "recommendation",
              entityId: rec.id,
              after: {
                simulated: true,
                intendedChange: intendedChange(rec),
                result: "No Shopify call was made.",
              },
              meta: { dryRun: true, jobRunId: run.id },
            },
          });
          continue;
        }
        const { applyApprovedThemeCacheFlushRecommendation } = await import(
          "@/lib/recommendations/theme-cache-flush"
        );
        const receipt = await applyApprovedThemeCacheFlushRecommendation({
          ...rec,
          status: "executing",
        });
        verifiedShopifyReceipt = receipt;
        await prisma.$transaction([
          prisma.recommendation.update({
            where: { id: rec.id },
            data: {
              status: "executed",
              executedAt: new Date(),
              executionResult: json(receipt),
            },
          }),
          prisma.auditLog.create({
            data: {
              actor: "system",
              action: "theme_page_cache_flushed",
              entityType: "recommendation",
              entityId: rec.id,
              after: json(receipt),
              meta: { dryRun: false, jobRunId: run.id },
            },
          }),
        ]);
        counters.executed++;
        continue;
      }
      if (rec.platform === "shopify"
        && rec.actionType === "refresh_shopify_article_page_cache") {
        if (dryRun) {
          counters.simulated++;
          await prisma.auditLog.create({
            data: {
              actor: "system",
              action: "execution_dry_run_success",
              entityType: "recommendation",
              entityId: rec.id,
              after: {
                simulated: true,
                intendedChange: intendedChange(rec),
                result: "No Shopify call was made.",
              },
              meta: { dryRun: true, jobRunId: run.id },
            },
          });
          continue;
        }
        const { applyApprovedArticleCacheRefreshRecommendation } =
          await import("@/lib/recommendations/article-cache-refresh");
        const receipt =
          await applyApprovedArticleCacheRefreshRecommendation({
            ...rec,
            status: "executing",
          });
        verifiedShopifyReceipt = receipt;
        await prisma.$transaction([
          prisma.recommendation.update({
            where: { id: rec.id },
            data: {
              status: "executed",
              executedAt: new Date(),
              executionResult: json(receipt),
            },
          }),
          prisma.auditLog.create({
            data: {
              actor: "system",
              action: "article_page_cache_refreshed",
              entityType: "recommendation",
              entityId: rec.id,
              after: json(receipt),
              meta: { dryRun: false, jobRunId: run.id },
            },
          }),
        ]);
        counters.executed++;
        continue;
      }
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
          const auditData = {
            actor: "system",
            action,
            entityType: "recommendation",
            entityId: rec.id,
            after: { reason: guard.reason, intendedChange: intendedChange(rec) },
            meta: { dryRun, jobRunId: run.id, reason: "guardrail" },
          };
          if (dryRun) {
            await prisma.auditLog.create({ data: auditData });
          } else {
            await prisma.$transaction([
              prisma.recommendation.update({
                where: { id: rec.id },
                data: {
                  status: "failed",
                  executionResult: json({ error: `Guardrail re-check blocked: ${guard.reason}` }),
                },
              }),
              prisma.auditLog.create({ data: auditData }),
            ]);
            await sendOperatorAlert("hard_block", {
              recommendationId: rec.id,
              targetEntityName: rec.targetEntityName,
              actionType: rec.actionType,
              reason: guard.reason,
            });
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
      const topicalMapError = err && typeof err === "object" && "code" in err
        ? err as { code?: TopicalMapApplyErrorCode; diagnostic?: TopicalMapApplyDiagnostic }
        : null;
      const staleCodes = new Set<TopicalMapApplyErrorCode>([
        "APPROVED_BYTES_CHANGED", "OBSERVATION_CHANGED", "STRATEGY_CHANGED", "RULE_CHANGED",
      ]);
      if (!dryRun && rec.platform === "shopify" && rec.actionType === "apply_topical_map_store_task" && topicalMapError?.code && staleCodes.has(topicalMapError.code)) {
        const code = topicalMapError.code;
        await prisma.$transaction([
          prisma.storeTask.updateMany({
            where: { id: rec.targetEntityId, status: { in: ["pending", "applying"] } },
            data: { status: "dismissed", completedAt: new Date(), completionNote: `Superseded (${code}). Sync topical map to create current work.` },
          }),
          prisma.recommendation.updateMany({
            where: { id: rec.id, status: "executing" },
            data: {
              status: "rejected", reviewedBy: "execute-approved", reviewedAt: new Date(),
              reviewNote: `Superseded topical-map work: ${code}`,
              executionResult: json({ code, superseded: true, jobRunId: run.id }),
            },
          }),
          prisma.storeTaskExecutionLock.deleteMany({ where: { taskId: rec.targetEntityId, ownerId: rec.id } }),
          prisma.auditLog.create({ data: { actor: "system", action: "topical_map_store_task_superseded", entityType: "StoreTask", entityId: rec.targetEntityId, after: json({ code, recommendationId: rec.id }), meta: { jobRunId: run.id } } }),
        ]);
        counters.superseded++;
        continue;
      }
      if (!dryRun
        && rec.platform === "shopify"
        && rec.actionType === "remove_homepage_offer_catalog"
        && verifiedShopifyReceipt) {
        await Promise.all([
          prisma.recommendation.updateMany({
            where: { id: rec.id, status: "executing" },
            data: {
              executionResult: json({
                reconciliationNeeded: true,
                receipt: verifiedShopifyReceipt,
              }),
            },
          }),
          prisma.auditLog.create({
            data: {
              actor: "system",
              action: "homepage_schema_reconciliation_needed",
              entityType: "recommendation",
              entityId: rec.id,
              after: json({
                reconciliationNeeded: true,
                receipt: verifiedShopifyReceipt,
              }),
              meta: { dryRun: false, jobRunId: run.id },
            },
          }),
        ]);
        continue;
      }
      if (!dryRun
        && rec.platform === "shopify"
        && rec.actionType === "fix_robots_sitemap_url"
        && verifiedShopifyReceipt) {
        await Promise.all([
          prisma.recommendation.updateMany({
            where: { id: rec.id, status: "executing" },
            data: {
              executionResult: json({
                reconciliationNeeded: true,
                receipt: verifiedShopifyReceipt,
              }),
            },
          }),
          prisma.auditLog.create({
            data: {
              actor: "system",
              action: "robots_sitemap_reconciliation_needed",
              entityType: "recommendation",
              entityId: rec.id,
              after: json({
                reconciliationNeeded: true,
                receipt: verifiedShopifyReceipt,
              }),
              meta: { dryRun: false, jobRunId: run.id },
            },
          }),
        ]);
        continue;
      }
      if (!dryRun
        && rec.platform === "shopify"
        && rec.actionType === "sync_theme_source_assets"
        && verifiedShopifyReceipt) {
        await Promise.all([
          prisma.recommendation.updateMany({
            where: { id: rec.id, status: "executing" },
            data: {
              executionResult: json({
                reconciliationNeeded: true,
                receipt: verifiedShopifyReceipt,
              }),
            },
          }),
          prisma.auditLog.create({
            data: {
              actor: "system",
              action: "theme_source_sync_reconciliation_needed",
              entityType: "recommendation",
              entityId: rec.id,
              after: json({
                reconciliationNeeded: true,
                receipt: verifiedShopifyReceipt,
              }),
              meta: { dryRun: false, jobRunId: run.id },
            },
          }),
        ]);
        continue;
      }
      if (!dryRun
        && rec.platform === "shopify"
        && rec.actionType === "flush_shopify_theme_page_cache"
        && verifiedShopifyReceipt) {
        await Promise.all([
          prisma.recommendation.updateMany({
            where: { id: rec.id, status: "executing" },
            data: {
              executionResult: json({
                reconciliationNeeded: true,
                receipt: verifiedShopifyReceipt,
              }),
            },
          }),
          prisma.auditLog.create({
            data: {
              actor: "system",
              action: "theme_cache_flush_reconciliation_needed",
              entityType: "recommendation",
              entityId: rec.id,
              after: json({
                reconciliationNeeded: true,
                receipt: verifiedShopifyReceipt,
              }),
              meta: { dryRun: false, jobRunId: run.id },
            },
          }),
        ]);
        continue;
      }
      if (!dryRun
        && rec.platform === "shopify"
        && rec.actionType === "refresh_shopify_article_page_cache"
        && verifiedShopifyReceipt) {
        await Promise.all([
          prisma.recommendation.updateMany({
            where: { id: rec.id, status: "executing" },
            data: {
              executionResult: json({
                reconciliationNeeded: true,
                receipt: verifiedShopifyReceipt,
              }),
            },
          }),
          prisma.auditLog.create({
            data: {
              actor: "system",
              action: "article_cache_refresh_reconciliation_needed",
              entityType: "recommendation",
              entityId: rec.id,
              after: json({
                reconciliationNeeded: true,
                receipt: verifiedShopifyReceipt,
              }),
              meta: { dryRun: false, jobRunId: run.id },
            },
          }),
        ]);
        continue;
      }
      counters.failed++;
      const diagnostic = topicalMapError?.diagnostic;
      const safeShopifyFailure = {
        code: topicalMapError?.code ?? "SHOPIFY_FAILED",
        mutationSent: diagnostic?.mutationSent ?? false,
        ...(diagnostic?.shopifyMessage ? { shopifyMessage: diagnostic.shopifyMessage } : {}),
        reobservation: diagnostic?.reobservation ?? "not_attempted",
        jobRunId: run.id,
      };
      const auditData = {
        actor: "system",
        action: dryRun ? "execution_dry_run_failed" : "execution_failed",
        entityType: "recommendation",
        entityId: rec.id,
        after: json(rec.platform === "shopify" && rec.actionType === "apply_topical_map_store_task"
          ? { ...safeShopifyFailure, intendedChange: intendedChange(rec) }
          : { error: safeError, metaError, intendedChange: intendedChange(rec) }),
        meta: { dryRun, jobRunId: run.id },
      };
      if (dryRun) {
        await prisma.auditLog.create({ data: auditData });
      } else {
        if (rec.platform === "shopify" && rec.actionType === "apply_topical_map_store_task") {
          const uncertain = topicalMapError?.code === "SHOPIFY_VERIFICATION_UNCERTAIN";
          if (verifiedShopifyReceipt) {
            await Promise.all([
              prisma.storeTask.updateMany({ where: { id: rec.targetEntityId, status: "applying" }, data: { status: "reconciliation_needed", completionNote: "Shopify was verified, but local joint finalization failed. Automatic reconciliation is required.", executionReceipt: json(verifiedShopifyReceipt) } }),
              prisma.recommendation.updateMany({ where: { id: rec.id, status: "executing" }, data: { executionResult: json({ reconciliationNeeded: true, receipt: verifiedShopifyReceipt }) } }),
              prisma.auditLog.create({ data: { ...auditData, after: json({ ...safeShopifyFailure, mutationSent: true, reobservation: "expected_state", reconciliationNeeded: true, intendedChange: intendedChange(rec) }) } }),
            ]);
            continue;
          }
          if (uncertain) {
            await prisma.$transaction([
              prisma.storeTask.updateMany({ where: { id: rec.targetEntityId, status: "applying" }, data: { status: "reconciliation_needed", completionNote: "Shopify mutation outcome is uncertain. Automatic reobservation is required before any retry.", executionReceipt: json({ reconciliationNeeded: true, recommendationId: rec.id, taskId: rec.targetEntityId }) } }),
              prisma.recommendation.updateMany({ where: { id: rec.id, status: "executing" }, data: { executionResult: json({ ...safeShopifyFailure, reconciliationNeeded: true, taskId: rec.targetEntityId }) } }),
              prisma.auditLog.create({ data: auditData }),
            ]);
            continue;
          }
          await prisma.$transaction([
            prisma.storeTask.updateMany({ where: { id: rec.targetEntityId, status: { in: ["pending", "applying"] } }, data: { status: "failed", completedAt: new Date(), completionNote: "Guarded execution failed before a verified Shopify receipt. Re-sync to reobserve and create fresh work." } }),
            prisma.recommendation.update({ where: { id: rec.id }, data: { status: "failed", executionResult: json(safeShopifyFailure) } }),
            prisma.storeTaskExecutionLock.deleteMany({ where: { taskId: rec.targetEntityId, ownerId: rec.id } }),
            prisma.auditLog.create({ data: auditData }),
          ]);
          continue;
        }
        await prisma.$transaction([
          prisma.recommendation.update({
            where: { id: rec.id },
            data: { status: "failed", executionResult: json({ error: safeError, metaError }) },
          }),
          prisma.auditLog.create({ data: auditData }),
        ]);
        await sendOperatorAlert("execution_failed", {
          recommendationId: rec.id,
          targetEntityName: rec.targetEntityName,
          actionType: rec.actionType,
          error: safeError,
        });
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
