import { prisma } from "@/lib/db";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { fetchAdsDataHandler } from "@/jobs/fetch-ads-data";
import { fetchSeoDataHandler } from "@/jobs/fetch-seo-data";
import { runFetchBlogContentLocked, type IndexResult } from "@/jobs/fetch-blog-content";
import { fetchGscDataHandler } from "@/jobs/fetch-gsc-data";
import { fetchMarketIntelHandler } from "@/jobs/fetch-market-intel";
import { fetchKeywordResearchHandler } from "@/jobs/fetch-keyword-research";
import { runSkillsHandler } from "@/jobs/run-skills";
import { snapshotSeoHistoryHandler } from "@/jobs/snapshot-seo-history";
import { isJobSuccessful, type JobResult, type JobStatus } from "@/lib/jobs/types";
import { materializeJobsStatusSnapshot } from "@/lib/dashboard/jobs-status";

type DashboardRefreshStepSummary = {
  status: JobStatus;
  runId: string | null;
  errors: number;
};

type DashboardRefreshSummary = {
  jobs: Record<string, DashboardRefreshStepSummary>;
  newRecs: number;
  failedJobs: string[];
  partialJobs: string[];
  skippedJobs: string[];
};

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function blogResultToJobResult(result: IndexResult): JobResult<{
  indexed: number;
  skipped: number;
  snapshotsCreated: number;
  timings?: Record<string, number>;
}> {
  return {
    jobName: result.jobName,
    runId: result.runId,
    status: result.status,
    summary: {
      indexed: result.indexed,
      skipped: result.skipped,
      snapshotsCreated: result.snapshotsCreated,
      timings: result.timings,
    },
    errors: result.errors,
  };
}

function failedStep(jobName: string, err: unknown): JobResult<Record<string, never>> {
  return {
    jobName,
    runId: "",
    status: "failed",
    summary: {},
    errors: [errorMessage(err)],
  };
}

function skippedStep(jobName: string): JobResult<Record<string, never>> {
  return {
    jobName,
    runId: "",
    status: "skipped",
    summary: {},
    errors: [`${jobName} is already running`],
  };
}

async function runLocked<TSummary>(
  jobName: string,
  run: () => Promise<JobResult<TSummary>>,
): Promise<JobResult<TSummary> | JobResult<Record<string, never>>> {
  const acquired = await acquireJobLock(jobName);
  if (!acquired) return skippedStep(jobName);

  try {
    return await run();
  } catch (err) {
    return failedStep(jobName, err);
  } finally {
    await releaseJobLock(jobName);
  }
}

function addStep(summary: DashboardRefreshSummary, result: JobResult<unknown>) {
  summary.jobs[result.jobName] = {
    status: result.status,
    runId: result.runId || null,
    errors: result.errors.length,
  };

  if (result.status === "failed") summary.failedJobs.push(result.jobName);
  if (result.status === "partial") summary.partialJobs.push(result.jobName);
  if (result.status === "skipped") summary.skippedJobs.push(result.jobName);
}

function dashboardStatus(summary: DashboardRefreshSummary): JobStatus {
  const dataJobs = Object.entries(summary.jobs)
    .filter(([jobName]) => jobName !== "run-skills" && jobName !== "snapshot-seo-history")
    .map(([, step]) => step);
  if (!dataJobs.some((step) => isJobSuccessful(step.status))) return "failed";
  if (summary.failedJobs.length > 0) return "partial";
  if (summary.partialJobs.length > 0 || summary.skippedJobs.length > 0) return "partial";
  return "success";
}

export async function createDashboardRefreshRun(): Promise<{ runId: string } | null> {
  const acquired = await acquireJobLock("dashboard-refresh");
  if (!acquired) return null;

  const run = await prisma.jobRun.create({
    data: { jobName: "dashboard-refresh", triggeredBy: "user" },
    select: { id: true },
  });

  return { runId: run.id };
}

export async function runDashboardRefreshHandler(
  runId: string,
  options: { releaseDashboardLock?: boolean } = {},
): Promise<JobResult<DashboardRefreshSummary>> {
  const summary: DashboardRefreshSummary = {
    jobs: {},
    newRecs: 0,
    failedJobs: [],
    partialJobs: [],
    skippedJobs: [],
  };
  const errors: string[] = [];

  try {
    const fetchSteps = await Promise.all([
      runLocked("fetch-ads-data", fetchAdsDataHandler),
      runLocked("fetch-seo-data", fetchSeoDataHandler),
      (async () => {
        const locked = await runFetchBlogContentLocked();
        return locked.acquired ? blogResultToJobResult(locked.result) : skippedStep("fetch-blog-content");
      })(),
      runLocked("fetch-gsc-data", fetchGscDataHandler),
    ]);

    for (const step of fetchSteps) {
      addStep(summary, step);
      errors.push(...step.errors.map((error) => `${step.jobName}: ${error}`));
    }

    const seoStep = fetchSteps.find((step) => step.jobName === "fetch-seo-data");
    const gscStep = fetchSteps.find((step) => step.jobName === "fetch-gsc-data");
    if ((seoStep && isJobSuccessful(seoStep.status)) || (gscStep && isJobSuccessful(gscStep.status))) {
      const seoHistory = await runLocked("snapshot-seo-history", async () => {
        const history = await snapshotSeoHistoryHandler();
        if (history && typeof history === "object" && "skipped" in history && history.skipped) {
          const reason = "reason" in history && typeof history.reason === "string" ? history.reason : "SEO history snapshot skipped";
          return {
            jobName: "snapshot-seo-history",
            runId: "",
            status: "skipped" as const,
            summary: history,
            errors: [reason],
          };
        }
        return {
          jobName: "snapshot-seo-history",
          runId: "",
          status: "success" as const,
          summary: history ?? {},
          errors: [],
        };
      });
      addStep(summary, seoHistory);
      errors.push(...seoHistory.errors.map((error) => `${seoHistory.jobName}: ${error}`));
    } else {
      const skipped = skippedStep("snapshot-seo-history");
      addStep(summary, skipped);
      errors.push("snapshot-seo-history: skipped because fetch-seo-data and fetch-gsc-data did not succeed");
    }

    const marketSteps = await Promise.all([
      runLocked("fetch-market-intel", () => fetchMarketIntelHandler({ profile: "smoke" })),
      runLocked("fetch-keyword-research", fetchKeywordResearchHandler),
    ]);

    for (const step of marketSteps) {
      addStep(summary, step);
      errors.push(...step.errors.map((error) => `${step.jobName}: ${error}`));
    }

    const anyFetchSucceeded = [...fetchSteps, ...marketSteps].some((step) => isJobSuccessful(step.status));
    if (anyFetchSucceeded) {
      const skills = await runLocked("run-skills", runSkillsHandler);
      addStep(summary, skills);
      if ("newRecs" in skills && typeof skills.newRecs === "number") {
        summary.newRecs = skills.newRecs;
      }
      errors.push(...skills.errors.map((error) => `${skills.jobName}: ${error}`));
    } else {
      const skipped = skippedStep("run-skills");
      addStep(summary, skipped);
      errors.push("run-skills: skipped because all fetch jobs failed");
    }

    const status = dashboardStatus(summary);
    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        completedAt: new Date(),
        status,
        summary: json(summary),
        errorLog: errors.length > 0 ? errors.join("\n").slice(0, 10_000) : null,
      },
    });
    await materializeJobsStatusSnapshot().catch((err) => console.error("[dashboard-refresh] status snapshot failed", err));

    return { jobName: "dashboard-refresh", runId, status, summary, errors };
  } catch (err) {
    const message = errorMessage(err);
    errors.push(message);
    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        completedAt: new Date(),
        status: "failed",
        summary: json(summary),
        errorLog: errors.join("\n").slice(0, 10_000),
      },
    });
    await materializeJobsStatusSnapshot().catch((snapshotErr) => console.error("[dashboard-refresh] status snapshot failed", snapshotErr));

    return { jobName: "dashboard-refresh", runId, status: "failed", summary, errors };
  } finally {
    if (options.releaseDashboardLock ?? true) {
      await releaseJobLock("dashboard-refresh");
    }
  }
}
