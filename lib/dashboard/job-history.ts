import { prisma } from "@/lib/db";
import { JOB_NAMES } from "@/lib/dashboard/jobs-status";

const HISTORY_PER_JOB = 7;

export type JobRunEntry = {
  status: string;
  startedAt: string;
};

export type JobHistoryMap = Record<string, JobRunEntry[]>;

export async function getJobHistory(): Promise<JobHistoryMap> {
  const result: JobHistoryMap = Object.fromEntries(JOB_NAMES.map((name) => [name, []]));

  const runsByJob = await Promise.all(
    JOB_NAMES.map(async (jobName) => ({
      jobName,
      runs: await prisma.jobRun.findMany({
        where: { jobName },
        orderBy: { startedAt: "desc" },
        take: HISTORY_PER_JOB,
        select: { status: true, startedAt: true },
      }),
    })),
  );

  for (const { jobName, runs } of runsByJob) {
    result[jobName] = runs.map((run) => ({
      status: run.status,
      startedAt: run.startedAt.toISOString(),
    }));
  }

  return result;
}
