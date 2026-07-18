import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fetchAdsDataHandler } from "@/jobs/fetch-ads-data";
import { fetchSeoDataHandler } from "@/jobs/fetch-seo-data";
import { snapshotSeoHistoryHandler } from "@/jobs/snapshot-seo-history";
import { runFetchBlogContentLocked } from "@/jobs/fetch-blog-content";
import { runSkillsHandler } from "@/jobs/run-skills";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { notifyJobFailure, checkAndAlertJobHealth, checkAndAlertDataFreshness } from "@/lib/alerts";
import { generateExactMapProposals } from "@/lib/content-pilot/exact-map-suggestions";
import {
  CONTENT_PROPOSAL_REPLACEMENT_BLOCKING_STATUSES,
  filterBlockedContentProposalInputs,
} from "@/lib/content-pilot/proposal-dedupe";
import { replacePendingContentProposals } from "@/lib/content-pilot/proposal-replacement";
import { isJobSuccessful, type JobResult, type JobStatus } from "@/lib/jobs/types";
import { cleanupDashboardRetention } from "@/lib/retention";
import { syncTopicalMapSeoTasks } from "@/lib/seo-tasks/topical-map-scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SettledJob = PromiseSettledResult<{ status: JobStatus; errors?: string[] } | JobResult<unknown>>;

async function runDailyBlogIndex() {
  const locked = await runFetchBlogContentLocked();
  return locked.acquired
    ? locked.result
    : { status: "skipped" as const, errors: ["fetch-blog-content is already running"] };
}

function settledStatus(result: SettledJob): JobStatus | "error" {
  return result.status === "fulfilled" ? result.value.status : "error";
}

function settledSucceeded(result: SettledJob): boolean {
  return result.status === "fulfilled" && isJobSuccessful(result.value.status);
}

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const acquired = await acquireJobLock("daily");
  if (!acquired) {
    return Response.json({ skipped: true, reason: "daily job already running" }, { status: 409 });
  }

  try {
    const results: Record<string, unknown> = {};

    async function notifyBadResult(jobName: string, result: SettledJob) {
      if (result.status === "rejected") {
        console.error(`[cron/daily] ${jobName}:`, result.reason);
        await notifyJobFailure({ jobName, route: "/api/cron/daily", error: result.reason });
        return;
      }

      if (result.value.status === "skipped") return;

      if (!isJobSuccessful(result.value.status)) {
        const message = result.value.errors?.join("\n") || `${jobName} finished with status ${result.value.status}`;
        console.error(`[cron/daily] ${jobName}:`, message);
        await notifyJobFailure({ jobName, route: "/api/cron/daily", error: message });
      }
    }

    // Fetch ads, SEO, and blog content in parallel, then run skills against fresh snapshots
    const [adsResult, seoResult, blogResult] = await Promise.allSettled([
      fetchAdsDataHandler(),
      fetchSeoDataHandler(),
      runDailyBlogIndex(),
    ]);

    await notifyBadResult("fetch-ads-data", adsResult);
    results.fetchAds = settledStatus(adsResult);
    await notifyBadResult("fetch-seo-data", seoResult);
    results.fetchSeo = settledStatus(seoResult);
    await notifyBadResult("fetch-blog-content", blogResult);
    results.fetchBlog = settledStatus(blogResult);

    // Persist a durable SEO trend point from the fresh gsc snapshot. Only when
    // the SEO fetch succeeded, so we never record a point from a stale/absent
    // snapshot. Non-fatal: a failure here must not abort the daily pipeline.
    if (settledSucceeded(seoResult)) {
      try {
        await snapshotSeoHistoryHandler();
        results.seoHistory = "ok";
      } catch (err) {
        console.error("[cron/daily] snapshotSeoHistory:", err);
        await notifyJobFailure({ jobName: "snapshot-seo-history", route: "/api/cron/daily", error: err });
        results.seoHistory = "error";
      }
    } else {
      results.seoHistory = "skipped";
    }

    // M-6: only run skills if at least one data-fetch job succeeded — no point
    // running against stale-or-absent snapshots when all connectors are down.
    const anyFetchSucceeded = [adsResult, seoResult, blogResult].some(settledSucceeded);
    if (!anyFetchSucceeded) {
      console.warn("[cron/daily] All fetch jobs failed — skipping skills run");
      results.runSkills = "skipped";
    } else {
      try {
        const skillsResult = await runSkillsHandler();
        results.runSkills = skillsResult.status;
        if (!isJobSuccessful(skillsResult.status)) {
          await notifyJobFailure({
            jobName: "run-skills",
            route: "/api/cron/daily",
            error: skillsResult.errors.join("\n") || `run-skills finished with status ${skillsResult.status}`,
          });
        }
      } catch (err) {
        console.error("[cron/daily] runSkills:", err);
        await notifyJobFailure({ jobName: "run-skills", route: "/api/cron/daily", error: err });
        results.runSkills = "error";
      }
    }

    // Generate content proposals after fresh data is in — runs even if only
    // blog or SEO fetch succeeded (both feed proposal scoring).
    if (settledSucceeded(blogResult) || settledSucceeded(seoResult)) {
      try {
        const proposals = await generateExactMapProposals(prisma);

        // Skip creating new pending rows if nothing was found.
        if (proposals.length > 0) {
          const fresh = await filterBlockedContentProposalInputs(
            prisma,
            proposals,
            CONTENT_PROPOSAL_REPLACEMENT_BLOCKING_STATUSES,
          );
          if (fresh.length > 0) {
            const replacement = await replacePendingContentProposals(prisma, fresh.map((p) => ({ articleHandle: p.articleHandle,
                    proposalType: p.proposalType,
                    changeType: p.changeType,
                    priority: p.priority,
                    impact: p.impact,
                    effort: p.effort,
                    title: p.title,
                    description: p.description,
                    proposedState: p.proposedState as object,
                    sourceData: p.sourceData as object })), [], { governed: true });
            results.generateProposals = { created: replacement.created, total: proposals.length };
          } else {
            results.generateProposals = { created: 0, total: proposals.length };
          }
        } else {
          results.generateProposals = { created: 0, total: 0 };
        }
      } catch (err) {
        console.error("[cron/daily] generateProposals:", err);
        await notifyJobFailure({ jobName: "generate-proposals", route: "/api/cron/daily", error: err });
        results.generateProposals = "error";
      }
    } else {
      results.generateProposals = "skipped";
    }

    // Keep the active topical map materialized as a rolling 90-day operator
    // work window. This only creates or cancels local proposal/review records.
    try {
      results.topicalMapTasks = await syncTopicalMapSeoTasks();
    } catch (err) {
      console.error("[cron/daily] syncTopicalMapSeoTasks:", err);
      await notifyJobFailure({
        jobName: "sync-topical-map-seo-tasks",
        route: "/api/cron/daily",
        error: err,
      });
      results.topicalMapTasks = "error";
    }

    // TTL cleanup. Raw snapshots tied to recommendations are retained because
    // deleting them would cascade-delete recommendation history.
    try {
      results.cleanup = await cleanupDashboardRetention();
    } catch (err) {
      console.error("[cron/daily] cleanup:", err);
      results.cleanup = "error";
    }

    // Health checks: stale jobs and repeated partials
    try {
      await checkAndAlertJobHealth();
    } catch (err) {
      console.error("[cron/daily] health check alerts:", err);
    }

    // Data freshness: catch streams that silently stop collecting rows
    try {
      await checkAndAlertDataFreshness();
    } catch (err) {
      console.error("[cron/daily] data freshness alerts:", err);
    }

    return NextResponse.json({ ok: true, results, ranAt: new Date().toISOString() });
  } finally {
    await releaseJobLock("daily");
  }
}
