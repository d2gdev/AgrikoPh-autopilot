/**
 * Deduplicate logical dashboard rows before adding idempotency indexes.
 *
 * Dry-run by default. Use --apply to delete duplicate rows, keeping the newest
 * row in each logical group.
 *
 * Usage:
 *   npm run data:dedupe
 *   npm run data:dedupe -- --apply --json
 *   npm run data:dedupe -- --env .env.production --tables gsc,keyword,shopping,price,insight
 *
 * RawSnapshot date-level cleanup is intentionally opt-in with
 * --include-raw-snapshots because deleting snapshots cascades to Recommendation.
 */

import dotenv from "dotenv";
import process from "process";

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
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
const apply = process.argv.includes("--apply");
const jsonOutput = process.argv.includes("--json");
const includeRawSnapshots = process.argv.includes("--include-raw-snapshots");
const tableFilter = new Set(
  String(argValue("--tables", ""))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

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

const CHECKS = [
  {
    key: "raw",
    name: "RawSnapshot source + calendar date range",
    optIn: true,
    reason: "Deletes cascade to Recommendation through snapshotId; use only after confirming recommendation history can be pruned.",
    summarySql: `
      select count(*)::int as duplicate_groups, coalesce(sum(row_count - 1), 0)::int as duplicate_rows
      from (
        select source, "dateRangeStart"::date, "dateRangeEnd"::date, count(*)::int as row_count
        from "RawSnapshot"
        group by source, "dateRangeStart"::date, "dateRangeEnd"::date
        having count(*) > 1
      ) d
    `,
    deleteSql: `
      with ranked as (
        select
          id,
          row_number() over (
            partition by source, "dateRangeStart"::date, "dateRangeEnd"::date
            order by "fetchedAt" desc, id desc
          ) as rn
        from "RawSnapshot"
      ),
      deleted as (
        delete from "RawSnapshot" t
        using ranked r
        where t.id = r.id and r.rn > 1
        returning t.id
      )
      select count(*)::int as deleted_rows from deleted
    `,
  },
  {
    key: "gsc",
    name: "GscQuery query + page + date range",
    summarySql: `
      select count(*)::int as duplicate_groups, coalesce(sum(row_count - 1), 0)::int as duplicate_rows
      from (
        select query, page, "dateRangeStart", "dateRangeEnd", count(*)::int as row_count
        from "GscQuery"
        group by query, page, "dateRangeStart", "dateRangeEnd"
        having count(*) > 1
      ) d
    `,
    deleteSql: `
      with ranked as (
        select
          id,
          row_number() over (
            partition by query, page, "dateRangeStart", "dateRangeEnd"
            order by "capturedAt" desc, "createdAt" desc, id desc
          ) as rn
        from "GscQuery"
      ),
      deleted as (
        delete from "GscQuery" t
        using ranked r
        where t.id = r.id and r.rn > 1
        returning t.id
      )
      select count(*)::int as deleted_rows from deleted
    `,
  },
  {
    key: "keyword",
    name: "KeywordResearchResult source + keyword + locale + capture date",
    summarySql: `
      select count(*)::int as duplicate_groups, coalesce(sum(row_count - 1), 0)::int as duplicate_rows
      from (
        select source, keyword, coalesce("locationName", ''), coalesce("languageCode", ''), "capturedAt"::date, count(*)::int as row_count
        from "KeywordResearchResult"
        group by source, keyword, coalesce("locationName", ''), coalesce("languageCode", ''), "capturedAt"::date
        having count(*) > 1
      ) d
    `,
    deleteSql: `
      with ranked as (
        select
          id,
          row_number() over (
            partition by source, keyword, coalesce("locationName", ''), coalesce("languageCode", ''), "capturedAt"::date
            order by "capturedAt" desc, "createdAt" desc, id desc
          ) as rn
        from "KeywordResearchResult"
      ),
      deleted as (
        delete from "KeywordResearchResult" t
        using ranked r
        where t.id = r.id and r.rn > 1
        returning t.id
      )
      select count(*)::int as deleted_rows from deleted
    `,
  },
  {
    key: "shopping",
    name: "ShoppingResult keyword + productKey + capture date",
    summarySql: `
      select count(*)::int as duplicate_groups, coalesce(sum(row_count - 1), 0)::int as duplicate_rows
      from (
        select keyword, "productKey", "capturedAt"::date, count(*)::int as row_count
        from "ShoppingResult"
        group by keyword, "productKey", "capturedAt"::date
        having count(*) > 1
      ) d
    `,
    deleteSql: `
      with ranked as (
        select
          id,
          row_number() over (
            partition by keyword, "productKey", "capturedAt"::date
            order by "capturedAt" desc, "createdAt" desc, id desc
          ) as rn
        from "ShoppingResult"
      ),
      deleted as (
        delete from "ShoppingResult" t
        using ranked r
        where t.id = r.id and r.rn > 1
        returning t.id
      )
      select count(*)::int as deleted_rows from deleted
    `,
  },
  {
    key: "price",
    name: "ShoppingPriceHistory productKey + capture date",
    summarySql: `
      select count(*)::int as duplicate_groups, coalesce(sum(row_count - 1), 0)::int as duplicate_rows
      from (
        select "productKey", "capturedAt"::date, count(*)::int as row_count
        from "ShoppingPriceHistory"
        group by "productKey", "capturedAt"::date
        having count(*) > 1
      ) d
    `,
    deleteSql: `
      with ranked as (
        select
          id,
          row_number() over (
            partition by "productKey", "capturedAt"::date
            order by "capturedAt" desc, "createdAt" desc, id desc
          ) as rn
        from "ShoppingPriceHistory"
      ),
      deleted as (
        delete from "ShoppingPriceHistory" t
        using ranked r
        where t.id = r.id and r.rn > 1
        returning t.id
      )
      select count(*)::int as deleted_rows from deleted
    `,
  },
  {
    key: "insight",
    name: "MarketInsight open type + title + entity + created date",
    summarySql: `
      select count(*)::int as duplicate_groups, coalesce(sum(row_count - 1), 0)::int as duplicate_rows
      from (
        select type, title, coalesce("competitorId", ''), coalesce("keywordId", ''), coalesce("adId", ''), "createdAt"::date, count(*)::int as row_count
        from "MarketInsight"
        where status = 'open'
        group by type, title, coalesce("competitorId", ''), coalesce("keywordId", ''), coalesce("adId", ''), "createdAt"::date
        having count(*) > 1
      ) d
    `,
    deleteSql: `
      with ranked as (
        select
          id,
          row_number() over (
            partition by type, title, coalesce("competitorId", ''), coalesce("keywordId", ''), coalesce("adId", ''), "createdAt"::date
            order by "createdAt" desc, id desc
          ) as rn
        from "MarketInsight"
        where status = 'open'
      ),
      deleted as (
        delete from "MarketInsight" t
        using ranked r
        where t.id = r.id and r.rn > 1
        returning t.id
      )
      select count(*)::int as deleted_rows from deleted
    `,
  },
];

function selectedChecks() {
  return CHECKS.filter((check) => {
    if (check.optIn && !includeRawSnapshots) return false;
    if (tableFilter.size > 0 && !tableFilter.has(check.key)) return false;
    return true;
  });
}

async function oneValue(sql) {
  const rows = await prisma.$queryRawUnsafe(sql);
  return compact(rows[0] ?? {});
}

async function run() {
  await prisma.$connect();

  const checks = selectedChecks();
  const before = [];
  const applied = [];

  for (const check of checks) {
    before.push({ key: check.key, name: check.name, ...(await oneValue(check.summarySql)) });
  }

  if (apply) {
    for (const check of checks) {
      applied.push({ key: check.key, name: check.name, ...(await oneValue(check.deleteSql)) });
    }
  }

  const after = [];
  for (const check of checks) {
    after.push({ key: check.key, name: check.name, ...(await oneValue(check.summarySql)) });
  }

  return {
    checkedAt: new Date().toISOString(),
    envFile,
    mode: apply ? "apply" : "dry-run",
    selectedTables: checks.map((check) => check.key),
    skipped: CHECKS
      .filter((check) => check.optIn && !includeRawSnapshots)
      .map((check) => ({ key: check.key, name: check.name, reason: check.reason })),
    before,
    applied,
    after,
  };
}

try {
  const result = await run();
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Dashboard dedupe ${result.mode} (${result.checkedAt})`);
    if (result.skipped.length > 0) {
      console.log("Skipped opt-in tables:");
      for (const row of result.skipped) console.log(`- ${row.name}: ${row.reason}`);
    }
    console.log("\nBefore:");
    for (const row of result.before) console.log(`- ${row.name}: ${row.duplicate_groups} groups, ${row.duplicate_rows} duplicate rows`);
    if (apply) {
      console.log("\nDeleted:");
      for (const row of result.applied) console.log(`- ${row.name}: ${row.deleted_rows} rows`);
      console.log("\nAfter:");
      for (const row of result.after) console.log(`- ${row.name}: ${row.duplicate_groups} groups, ${row.duplicate_rows} duplicate rows`);
    } else {
      console.log("\nDry-run only. Re-run with --apply to delete duplicate rows.");
    }
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
