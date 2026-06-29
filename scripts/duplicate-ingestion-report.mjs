/**
 * Read-only duplicate ingestion detail report.
 *
 * Shows the duplicate groups behind dashboard-baseline's aggregate counts.
 * It does not delete or update anything.
 *
 * Usage:
 *   npm run data:duplicates
 *   npm run data:duplicates -- --json --limit 20
 *   npm run data:duplicates -- --env .env.production --limit 50
 */

import dotenv from "dotenv";
import process from "process";

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function asPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function compact(value) {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, compact(entry)]));
  }
  return value;
}

const envFile = argValue("--env", ".env");
const limit = asPositiveInt(argValue("--limit", "20"), 20);
const maxIds = asPositiveInt(argValue("--max-ids", "10"), 10);
const jsonOutput = process.argv.includes("--json");

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

const CHECKS = [
  {
    name: "RawSnapshot source + calendar date range",
    proposedUniqueKey: `source + dateRangeStart::date + dateRangeEnd::date`,
    sql: `
      with ranked as (
        select
          id,
          source,
          "dateRangeStart"::date as date_range_start,
          "dateRangeEnd"::date as date_range_end,
          "fetchedAt",
          "jobRunId",
          row_number() over (
            partition by source, "dateRangeStart"::date, "dateRangeEnd"::date
            order by "fetchedAt" desc, id desc
          ) as rn,
          count(*) over (
            partition by source, "dateRangeStart"::date, "dateRangeEnd"::date
          ) as group_count
        from "RawSnapshot"
      )
      select
        source,
        date_range_start,
        date_range_end,
        group_count::int,
        max("fetchedAt") as newest_at,
        min("fetchedAt") as oldest_at,
        max(id) filter (where rn = 1) as suggested_keep_id,
        array_agg(id order by "fetchedAt" desc, id desc) as ids,
        array_agg("jobRunId" order by "fetchedAt" desc, id desc) as job_run_ids
      from ranked
      where group_count > 1
      group by source, date_range_start, date_range_end, group_count
      order by group_count desc, newest_at desc
      limit ${limit}
    `,
  },
  {
    name: "KeywordResearchResult keyword + locale + capture date",
    proposedUniqueKey: `source + keyword + locationName + languageCode + capturedAt::date`,
    sql: `
      with ranked as (
        select
          id,
          source,
          keyword,
          coalesce("locationName", '') as location_name,
          coalesce("languageCode", '') as language_code,
          "capturedAt"::date as captured_date,
          "capturedAt",
          "jobRunId",
          "avgMonthlySearches",
          row_number() over (
            partition by source, keyword, coalesce("locationName", ''), coalesce("languageCode", ''), "capturedAt"::date
            order by "capturedAt" desc, id desc
          ) as rn,
          count(*) over (
            partition by source, keyword, coalesce("locationName", ''), coalesce("languageCode", ''), "capturedAt"::date
          ) as group_count
        from "KeywordResearchResult"
      )
      select
        source,
        keyword,
        location_name,
        language_code,
        captured_date,
        group_count::int,
        max("capturedAt") as newest_at,
        min("capturedAt") as oldest_at,
        max(id) filter (where rn = 1) as suggested_keep_id,
        array_agg(id order by "capturedAt" desc, id desc) as ids,
        array_agg("jobRunId" order by "capturedAt" desc, id desc) as job_run_ids,
        array_agg("avgMonthlySearches" order by "capturedAt" desc, id desc) as avg_monthly_searches
      from ranked
      where group_count > 1
      group by source, keyword, location_name, language_code, captured_date, group_count
      order by group_count desc, newest_at desc
      limit ${limit}
    `,
  },
  {
    name: "ShoppingResult keyword + productKey + capture date",
    proposedUniqueKey: `keyword + productKey + capturedAt::date`,
    sql: `
      with ranked as (
        select
          id,
          keyword,
          "productKey",
          title,
          store,
          price,
          "capturedAt"::date as captured_date,
          "capturedAt",
          "jobRunId",
          row_number() over (
            partition by keyword, "productKey", "capturedAt"::date
            order by "capturedAt" desc, id desc
          ) as rn,
          count(*) over (
            partition by keyword, "productKey", "capturedAt"::date
          ) as group_count
        from "ShoppingResult"
      )
      select
        keyword,
        "productKey" as product_key,
        max(title) as sample_title,
        max(store) as sample_store,
        captured_date,
        group_count::int,
        max("capturedAt") as newest_at,
        min("capturedAt") as oldest_at,
        max(id) filter (where rn = 1) as suggested_keep_id,
        array_agg(id order by "capturedAt" desc, id desc) as ids,
        array_agg("jobRunId" order by "capturedAt" desc, id desc) as job_run_ids,
        array_agg(price order by "capturedAt" desc, id desc) as prices
      from ranked
      where group_count > 1
      group by keyword, "productKey", captured_date, group_count
      order by group_count desc, newest_at desc
      limit ${limit}
    `,
  },
  {
    name: "ShoppingPriceHistory productKey + capture date",
    proposedUniqueKey: `productKey + capturedAt::date`,
    sql: `
      with ranked as (
        select
          id,
          "productKey",
          title,
          store,
          price,
          "capturedAt"::date as captured_date,
          "capturedAt",
          "jobRunId",
          row_number() over (
            partition by "productKey", "capturedAt"::date
            order by "capturedAt" desc, id desc
          ) as rn,
          count(*) over (
            partition by "productKey", "capturedAt"::date
          ) as group_count
        from "ShoppingPriceHistory"
      )
      select
        "productKey" as product_key,
        max(title) as sample_title,
        max(store) as sample_store,
        captured_date,
        group_count::int,
        max("capturedAt") as newest_at,
        min("capturedAt") as oldest_at,
        max(id) filter (where rn = 1) as suggested_keep_id,
        array_agg(id order by "capturedAt" desc, id desc) as ids,
        array_agg("jobRunId" order by "capturedAt" desc, id desc) as job_run_ids,
        array_agg(price order by "capturedAt" desc, id desc) as prices
      from ranked
      where group_count > 1
      group by "productKey", captured_date, group_count
      order by group_count desc, newest_at desc
      limit ${limit}
    `,
  },
  {
    name: "MarketInsight open type + title + entity + created date",
    proposedUniqueKey: `type + title + competitorId + keywordId + adId + createdAt::date where status = open`,
    sql: `
      with ranked as (
        select
          id,
          type,
          title,
          status,
          severity,
          coalesce("competitorId", '') as competitor_id,
          coalesce("keywordId", '') as keyword_id,
          coalesce("adId", '') as ad_id,
          "createdAt"::date as created_date,
          "createdAt",
          row_number() over (
            partition by type, title, coalesce("competitorId", ''), coalesce("keywordId", ''), coalesce("adId", ''), "createdAt"::date
            order by "createdAt" desc, id desc
          ) as rn,
          count(*) over (
            partition by type, title, coalesce("competitorId", ''), coalesce("keywordId", ''), coalesce("adId", ''), "createdAt"::date
          ) as group_count
        from "MarketInsight"
        where status = 'open'
      )
      select
        type,
        title,
        max(status) as sample_status,
        max(severity) as sample_severity,
        competitor_id,
        keyword_id,
        ad_id,
        created_date,
        group_count::int,
        max("createdAt") as newest_at,
        min("createdAt") as oldest_at,
        max(id) filter (where rn = 1) as suggested_keep_id,
        array_agg(id order by "createdAt" desc, id desc) as ids,
        array_agg(status order by "createdAt" desc, id desc) as statuses,
        array_agg(severity order by "createdAt" desc, id desc) as severities
      from ranked
      where group_count > 1
      group by type, title, competitor_id, keyword_id, ad_id, created_date, group_count
      order by group_count desc, newest_at desc
      limit ${limit}
    `,
  },
];

async function run() {
  await prisma.$connect();

  const reports = [];
  for (const check of CHECKS) {
    const rows = await prisma.$queryRawUnsafe(check.sql);
    const groups = rows.map((row) => {
      const ids = row.ids ?? [];
      const extraIds = ids.slice(1);
      const next = compact(row);
      for (const key of ["ids", "job_run_ids", "prices", "avg_monthly_searches", "statuses", "severities"]) {
        if (Array.isArray(next[key])) next[key] = next[key].slice(0, maxIds);
      }
      return {
        ...next,
        total_ids: ids.length,
        ids_truncated: ids.length > maxIds,
        duplicate_extra_ids: compact(extraIds.slice(0, maxIds)),
        duplicate_extra_ids_truncated: extraIds.length > maxIds,
      };
    });
    const totalExtraRows = groups.reduce((sum, row) => sum + Math.max(0, Number(row.group_count ?? 0) - 1), 0);
    reports.push({
      name: check.name,
      proposedUniqueKey: check.proposedUniqueKey,
      displayedGroups: groups.length,
      displayedExtraRows: totalExtraRows,
      groups,
    });
  }

  return {
    checkedAt: checkedAt.toISOString(),
    envFile,
    limit,
    maxIds,
    reports,
  };
}

try {
  const result = await run();

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\nDuplicate ingestion detail report - ${result.checkedAt} (env: ${envFile}, limit: ${limit}, max ids: ${maxIds})`);
    for (const report of result.reports) {
      console.log(`\n${report.name}`);
      console.log(`Proposed key: ${report.proposedUniqueKey}`);
      console.log(`Displayed groups: ${report.displayedGroups}; displayed extra rows: ${report.displayedExtraRows}`);
      if (report.groups.length === 0) {
        console.log("No duplicate groups found.");
      } else {
        console.table(report.groups.map((group) => {
          const { ids, job_run_ids, duplicate_extra_ids, ...printable } = group;
          return {
            ...printable,
            ids: Array.isArray(ids) ? ids.length : ids,
            duplicate_extra_ids: Array.isArray(duplicate_extra_ids) ? duplicate_extra_ids.length : duplicate_extra_ids,
            job_run_ids: Array.isArray(job_run_ids) ? job_run_ids.filter(Boolean).length : job_run_ids,
          };
        }));
      }
    }
  }
} catch (err) {
  console.error(`\nDuplicate ingestion report failed: ${String(err?.message || err).slice(0, 800)}\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
