/**
 * Read-only dashboard pipeline baseline.
 *
 * Captures the evidence needed before changing the dashboard pipeline:
 * job outcomes, long-running jobs, current locks, data freshness, and likely
 * duplicate logical rows in append-heavy dashboard tables.
 *
 * Usage:
 *   npm run dashboard:baseline
 *   npm run dashboard:baseline -- --env .env.production --days 30
 *   npm run dashboard:baseline -- --json
 */

import dotenv from "dotenv";
import process from "process";

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const envFile = argValue("--env", ".env");
const jsonOutput = process.argv.includes("--json");
const daysRaw = Number(argValue("--days", "30"));
const days = Number.isInteger(daysRaw) && daysRaw > 0 ? daysRaw : 30;

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

function asNumber(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (value == null) return 0;
  return Number(value);
}

function ageHours(date) {
  if (!date) return null;
  return Math.round(((checkedAt.getTime() - new Date(date).getTime()) / (60 * 60 * 1000)) * 10) / 10;
}

function compactRows(rows) {
  return rows.map((row) => {
    const next = {};
    for (const [key, value] of Object.entries(row)) {
      next[key] = typeof value === "bigint" ? Number(value) : value;
    }
    return next;
  });
}

async function duplicateSummary(name, sql) {
  const rows = await prisma.$queryRawUnsafe(sql);
  const row = rows[0] ?? {};
  return {
    name,
    duplicateGroups: asNumber(row.duplicate_groups),
    extraRows: asNumber(row.extra_rows),
  };
}

async function freshnessSummary(name, sql) {
  const rows = await prisma.$queryRawUnsafe(sql);
  const row = rows[0] ?? {};
  const latestAt = row.latest_at ? new Date(row.latest_at) : null;
  return {
    name,
    totalRows: asNumber(row.total_rows),
    latestAt: latestAt?.toISOString() ?? null,
    ageHours: ageHours(latestAt),
  };
}

async function run() {
  await prisma.$connect();

  const [
    jobStatusCounts,
    latestJobs,
    longRunningJobs,
    activeLocks,
    duplicateChecks,
    freshness,
  ] = await Promise.all([
    prisma.$queryRawUnsafe(`
      select "jobName", status, count(*)::int as count
      from "JobRun"
      where "startedAt" >= now() - interval '${days} days'
      group by "jobName", status
      order by "jobName", status
    `),
    prisma.$queryRawUnsafe(`
      select distinct on ("jobName")
        "jobName",
        status,
        "startedAt",
        "completedAt",
        left(coalesce("errorLog", ''), 300) as error_excerpt
      from "JobRun"
      order by "jobName", "startedAt" desc
    `),
    prisma.$queryRawUnsafe(`
      select
        id,
        "jobName",
        status,
        "startedAt",
        "completedAt",
        round(extract(epoch from (coalesce("completedAt", now()) - "startedAt")))::int as duration_seconds,
        left(coalesce("errorLog", ''), 300) as error_excerpt
      from "JobRun"
      where "startedAt" >= now() - interval '${days} days'
      order by duration_seconds desc
      limit 25
    `),
    prisma.jobLock.findMany({
      orderBy: { lockedAt: "asc" },
      select: { jobName: true, lockedAt: true, expiresAt: true },
    }),
    Promise.all([
      duplicateSummary(
        "RawSnapshot source + calendar date range",
        `
          select count(*)::int as duplicate_groups, coalesce(sum(row_count - 1), 0)::int as extra_rows
          from (
            select source, "dateRangeStart"::date, "dateRangeEnd"::date, count(*)::int as row_count
            from "RawSnapshot"
            group by source, "dateRangeStart"::date, "dateRangeEnd"::date
            having count(*) > 1
          ) d
        `
      ),
      duplicateSummary(
        "GscQuery query + page + date range",
        `
          select count(*)::int as duplicate_groups, coalesce(sum(row_count - 1), 0)::int as extra_rows
          from (
            select query, page, "dateRangeStart", "dateRangeEnd", count(*)::int as row_count
            from "GscQuery"
            group by query, page, "dateRangeStart", "dateRangeEnd"
            having count(*) > 1
          ) d
        `
      ),
      duplicateSummary(
        "KeywordResearchResult source + keyword + locale + capture date",
        `
          select count(*)::int as duplicate_groups, coalesce(sum(row_count - 1), 0)::int as extra_rows
          from (
            select source, keyword, coalesce("locationName", ''), coalesce("languageCode", ''), "capturedAt"::date, count(*)::int as row_count
            from "KeywordResearchResult"
            group by source, keyword, coalesce("locationName", ''), coalesce("languageCode", ''), "capturedAt"::date
            having count(*) > 1
          ) d
        `
      ),
      duplicateSummary(
        "ShoppingResult keyword + productKey + capture date",
        `
          select count(*)::int as duplicate_groups, coalesce(sum(row_count - 1), 0)::int as extra_rows
          from (
            select keyword, "productKey", "capturedAt"::date, count(*)::int as row_count
            from "ShoppingResult"
            group by keyword, "productKey", "capturedAt"::date
            having count(*) > 1
          ) d
        `
      ),
      duplicateSummary(
        "ShoppingPriceHistory productKey + capture date",
        `
          select count(*)::int as duplicate_groups, coalesce(sum(row_count - 1), 0)::int as extra_rows
          from (
            select "productKey", "capturedAt"::date, count(*)::int as row_count
            from "ShoppingPriceHistory"
            group by "productKey", "capturedAt"::date
            having count(*) > 1
          ) d
        `
      ),
      duplicateSummary(
        "MarketInsight open type + title + entity + created date",
        `
          select count(*)::int as duplicate_groups, coalesce(sum(row_count - 1), 0)::int as extra_rows
          from (
            select type, title, coalesce("competitorId", ''), coalesce("keywordId", ''), coalesce("adId", ''), "createdAt"::date, count(*)::int as row_count
            from "MarketInsight"
            where status = 'open'
            group by type, title, coalesce("competitorId", ''), coalesce("keywordId", ''), coalesce("adId", ''), "createdAt"::date
            having count(*) > 1
          ) d
        `
      ),
    ]),
    Promise.all([
      freshnessSummary(
        "RawSnapshot: meta",
        `select count(*)::int as total_rows, max("fetchedAt") as latest_at from "RawSnapshot" where source = 'meta'`
      ),
      freshnessSummary(
        "RawSnapshot: gsc",
        `select count(*)::int as total_rows, max("fetchedAt") as latest_at from "RawSnapshot" where source = 'gsc'`
      ),
      freshnessSummary(
        "RawSnapshot: ga4",
        `select count(*)::int as total_rows, max("fetchedAt") as latest_at from "RawSnapshot" where source = 'ga4'`
      ),
      freshnessSummary(
        "GscQuery",
        `select count(*)::int as total_rows, max("capturedAt") as latest_at from "GscQuery"`
      ),
      freshnessSummary(
        "PageAnalytics",
        `select count(*)::int as total_rows, max("capturedAt") as latest_at from "PageAnalytics"`
      ),
      freshnessSummary(
        "ArticleRecord",
        `select count(*)::int as total_rows, max("updatedAt") as latest_at from "ArticleRecord"`
      ),
      freshnessSummary(
        "ShoppingResult",
        `select count(*)::int as total_rows, max("capturedAt") as latest_at from "ShoppingResult"`
      ),
      freshnessSummary(
        "KeywordResearchResult",
        `select count(*)::int as total_rows, max("capturedAt") as latest_at from "KeywordResearchResult"`
      ),
      freshnessSummary(
        "MarketInsight",
        `select count(*)::int as total_rows, max("createdAt") as latest_at from "MarketInsight"`
      ),
    ]),
  ]);

  const lockRows = activeLocks.map((lock) => ({
    ...lock,
    ageHours: ageHours(lock.lockedAt),
    expiresInSeconds: Math.round((lock.expiresAt.getTime() - checkedAt.getTime()) / 1000),
  }));

  const result = {
    checkedAt: checkedAt.toISOString(),
    envFile,
    windowDays: days,
    jobStatusCounts: compactRows(jobStatusCounts),
    latestJobs: compactRows(latestJobs),
    longRunningJobs: compactRows(longRunningJobs),
    activeLocks: lockRows,
    duplicateChecks,
    freshness,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\nDashboard baseline - ${result.checkedAt} (env: ${envFile}, window: ${days}d)\n`);
  console.log("Job status counts:");
  console.table(result.jobStatusCounts);
  console.log("\nLatest job per name:");
  console.table(result.latestJobs);
  console.log("\nLongest jobs:");
  console.table(result.longRunningJobs);
  console.log("\nActive locks:");
  console.table(result.activeLocks);
  console.log("\nDuplicate checks:");
  console.table(result.duplicateChecks);
  console.log("\nFreshness:");
  console.table(result.freshness);
}

try {
  await run();
} catch (err) {
  console.error(`\nDashboard baseline failed: ${String(err?.message || err).slice(0, 800)}\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
