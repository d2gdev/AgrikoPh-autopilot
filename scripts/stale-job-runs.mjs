/**
 * Inspect or repair stale JobRun rows left in "running" after crashes/restarts.
 *
 * Dry-run by default:
 *   npm run jobs:stale
 *   npm run jobs:stale -- --older-than-minutes 720 --json
 *
 * Apply explicitly:
 *   npm run jobs:stale -- --apply --older-than-minutes 720
 */

import dotenv from "dotenv";
import process from "process";

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function allArgValues(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) values.push(process.argv[i + 1]);
  }
  return values;
}

function asPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const envFile = argValue("--env", ".env");
const olderThanMinutes = asPositiveInt(argValue("--older-than-minutes", "360"), 360);
const apply = process.argv.includes("--apply");
const jsonOutput = process.argv.includes("--json");
const jobFilters = allArgValues("--job");

dotenv.config({ path: envFile, override: true });

if (!process.env.DATABASE_URL && process.env.DATABASE_URL_PROD) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
}

if (!process.env.DATABASE_URL) {
  console.error(`DATABASE_URL not found (looked in ${envFile}; DATABASE_URL_PROD is accepted as a fallback).`);
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const checkedAt = new Date();
const staleBefore = new Date(checkedAt.getTime() - olderThanMinutes * 60_000);

function durationMinutes(startedAt) {
  return Math.round((checkedAt.getTime() - startedAt.getTime()) / 60_000);
}

function repairMessage(run) {
  const age = durationMinutes(run.startedAt);
  return [
    `[stale-job-repair] Marked failed at ${checkedAt.toISOString()}.`,
    `Run had been status=running for ${age} minutes, older than threshold ${olderThanMinutes} minutes.`,
    "This usually means the process exited, redeployed, or crashed before the job wrote a terminal state.",
    run.errorLog ? `Previous errorLog: ${run.errorLog}` : null,
  ].filter(Boolean).join(" ");
}

async function run() {
  await prisma.$connect();

  const staleRuns = await prisma.jobRun.findMany({
    where: {
      status: "running",
      startedAt: { lt: staleBefore },
      ...(jobFilters.length > 0 ? { jobName: { in: jobFilters } } : {}),
    },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      jobName: true,
      triggeredBy: true,
      startedAt: true,
      completedAt: true,
      status: true,
      errorLog: true,
    },
  });

  const rows = staleRuns.map((run) => ({
    id: run.id,
    jobName: run.jobName,
    triggeredBy: run.triggeredBy,
    startedAt: run.startedAt.toISOString(),
    ageMinutes: durationMinutes(run.startedAt),
  }));

  let updated = 0;
  if (apply) {
    for (const run of staleRuns) {
      const result = await prisma.jobRun.updateMany({
        where: { id: run.id, status: "running" },
        data: {
          status: "failed",
          completedAt: checkedAt,
          errorLog: repairMessage(run),
        },
      });
      updated += result.count;
    }
  }

  const result = {
    checkedAt: checkedAt.toISOString(),
    envFile,
    mode: apply ? "apply" : "dry-run",
    olderThanMinutes,
    jobFilters,
    matched: staleRuns.length,
    updated,
    staleRuns: rows,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\nStale JobRun ${apply ? "repair" : "dry-run"} - ${checkedAt.toISOString()} (env: ${envFile})`);
  console.log(`Threshold: running longer than ${olderThanMinutes} minutes\n`);
  if (rows.length === 0) {
    console.log("No stale running jobs found.");
  } else {
    console.table(rows);
    console.log(apply ? `Updated ${updated} stale running job(s) to failed.` : "No rows changed. Re-run with --apply to mark these failed.");
  }
}

try {
  await run();
} catch (err) {
  console.error(`\nStale JobRun check failed: ${String(err?.message || err).slice(0, 800)}\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
