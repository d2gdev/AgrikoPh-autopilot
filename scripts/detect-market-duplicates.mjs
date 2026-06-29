#!/usr/bin/env node
// @ts-check
/**
 * Duplicate detection for Market Intelligence tables.
 *
 * Finds rows that share the same logical key within each MI table so that
 * any violating rows can be cleaned up BEFORE unique constraints are added.
 *
 * Exits 0 if no duplicates found, 1 if any duplicates found (CI-friendly).
 *
 * Usage:
 *   node scripts/detect-market-duplicates.mjs
 *   node scripts/detect-market-duplicates.mjs --env .env.production
 *   node scripts/detect-market-duplicates.mjs --fix   # TODO: cleanup not yet implemented
 */

import process from "process";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

const envArgIdx = args.indexOf("--env");
const envFile = envArgIdx >= 0 ? args[envArgIdx + 1] : ".env";

const fixMode = args.includes("--fix");

// ---------------------------------------------------------------------------
// Env / DB connection
// ---------------------------------------------------------------------------
const dotenv = await import("dotenv");
dotenv.config({ path: envFile });

if (!process.env.DATABASE_URL && process.env.DATABASE_URL_PROD) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
}

if (!process.env.DATABASE_URL) {
  console.error(
    `DATABASE_URL not found (looked in ${envFile}; DATABASE_URL_PROD is accepted as a fallback).`
  );
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Output path
// ---------------------------------------------------------------------------
const REPORT_PATH = path.resolve(
  ".superpowers/sdd/phase3-duplicate-report.json"
);

// ---------------------------------------------------------------------------
// Helper: run a raw GROUP BY query and return duplicate groups
// ---------------------------------------------------------------------------

/**
 * @typedef {{ groupKey: string, count: number, exampleIds: string[] }} DupGroup
 */

/**
 * @typedef {{ table: string, keyFields: string[], dupGroups: number, totalDupRows: number, examples: string[] }} TableResult
 */

/**
 * Execute a raw SQL query that returns duplicate groups.
 * The query must SELECT: key columns, a `cnt` alias for COUNT(*), and an `example_ids` alias
 * for an array_agg of ids.
 *
 * @param {string} sql
 * @returns {Promise<Array<{cnt: bigint|number, example_ids: string[], [key: string]: unknown}>>}
 */
async function rawDupQuery(sql) {
  // @ts-ignore — $queryRawUnsafe returns unknown[]
  return prisma.$queryRawUnsafe(sql);
}

/**
 * Summarise raw duplicate rows into a TableResult.
 *
 * @param {string} table
 * @param {string[]} keyFields
 * @param {Array<{cnt: bigint|number, example_ids: string[], [key: string]: unknown}>} rows
 * @returns {TableResult}
 */
function summarise(table, keyFields, rows) {
  const dupGroups = rows.length;
  const totalDupRows = rows.reduce((acc, r) => acc + Number(r.cnt), 0);
  // Show up to 3 example key combinations
  const examples = rows.slice(0, 3).map((r) => {
    const parts = keyFields.map((f) => `${f}=${JSON.stringify(r[f] ?? r[f.toLowerCase()] ?? "?")}`);
    return parts.join(", ");
  });
  return { table, keyFields, dupGroups, totalDupRows, examples };
}

// ---------------------------------------------------------------------------
// Per-table duplicate checks
// ---------------------------------------------------------------------------

/**
 * KeywordResearchResult
 * Existing unique: source + keyword + locationNameForDedupe + languageCodeForDedupe + captureDate
 */
async function checkKeywordResearchResult() {
  const rows = await rawDupQuery(`
    SELECT
      source,
      keyword,
      "locationNameForDedupe",
      "languageCodeForDedupe",
      DATE("captureDate") AS capturedate,
      COUNT(*) AS cnt,
      ARRAY_AGG(id ORDER BY "createdAt") AS example_ids
    FROM "KeywordResearchResult"
    GROUP BY source, keyword, "locationNameForDedupe", "languageCodeForDedupe", DATE("captureDate")
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 100
  `);
  return summarise(
    "KeywordResearchResult",
    ["source", "keyword", "locationNameForDedupe", "languageCodeForDedupe", "captureDate"],
    rows
  );
}

/**
 * ShoppingResult
 * Existing unique: keyword + productKey + captureDate
 */
async function checkShoppingResult() {
  const rows = await rawDupQuery(`
    SELECT
      keyword,
      "productKey",
      DATE("captureDate") AS capturedate,
      COUNT(*) AS cnt,
      ARRAY_AGG(id ORDER BY "createdAt") AS example_ids
    FROM "ShoppingResult"
    GROUP BY keyword, "productKey", DATE("captureDate")
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 100
  `);
  return summarise(
    "ShoppingResult",
    ["keyword", "productKey", "captureDate"],
    rows
  );
}

/**
 * ShoppingPriceHistory
 * Check TWO keys:
 *   Old (existing constraint): productKey + captureDate
 *   Context (proposed):        productKey + captureDate + COALESCE(marketKeywordId,'') + COALESCE(competitorId,'')
 */
async function checkShoppingPriceHistory() {
  const [oldRows, ctxRows] = await Promise.all([
    rawDupQuery(`
      SELECT
        "productKey",
        DATE("captureDate") AS capturedate,
        COUNT(*) AS cnt,
        ARRAY_AGG(id ORDER BY "createdAt") AS example_ids
      FROM "ShoppingPriceHistory"
      GROUP BY "productKey", DATE("captureDate")
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 100
    `),
    rawDupQuery(`
      SELECT
        "productKey",
        DATE("captureDate") AS capturedate,
        COALESCE("marketKeywordId", '') AS "marketKeywordId",
        COALESCE("competitorId", '') AS "competitorId",
        COUNT(*) AS cnt,
        ARRAY_AGG(id ORDER BY "createdAt") AS example_ids
      FROM "ShoppingPriceHistory"
      GROUP BY "productKey", DATE("captureDate"), COALESCE("marketKeywordId", ''), COALESCE("competitorId", '')
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 100
    `),
  ]);

  const oldResult = summarise(
    "ShoppingPriceHistory (old key: productKey+captureDate)",
    ["productKey", "captureDate"],
    oldRows
  );
  const ctxResult = summarise(
    "ShoppingPriceHistory (context key: +marketKeywordId+competitorId)",
    ["productKey", "captureDate", "marketKeywordId", "competitorId"],
    ctxRows
  );
  return [oldResult, ctxResult];
}

/**
 * CompetitorAd
 * Existing unique: adArchiveId
 */
async function checkCompetitorAd() {
  const rows = await rawDupQuery(`
    SELECT
      "adArchiveId",
      COUNT(*) AS cnt,
      ARRAY_AGG(id ORDER BY "createdAt") AS example_ids
    FROM "CompetitorAd"
    GROUP BY "adArchiveId"
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 100
  `);
  return summarise("CompetitorAd", ["adArchiveId"], rows);
}

/**
 * CompetitorAdCapture
 * Existing unique: adArchiveId + captureDate
 */
async function checkCompetitorAdCapture() {
  const rows = await rawDupQuery(`
    SELECT
      "adArchiveId",
      DATE("captureDate") AS capturedate,
      COUNT(*) AS cnt,
      ARRAY_AGG(id ORDER BY "createdAt") AS example_ids
    FROM "CompetitorAdCapture"
    GROUP BY "adArchiveId", DATE("captureDate")
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 100
  `);
  return summarise("CompetitorAdCapture", ["adArchiveId", "captureDate"], rows);
}

/**
 * CompetitorSocialPage
 * Existing unique: identityKey
 */
async function checkCompetitorSocialPage() {
  const rows = await rawDupQuery(`
    SELECT
      "identityKey",
      COUNT(*) AS cnt,
      ARRAY_AGG(id ORDER BY "createdAt") AS example_ids
    FROM "CompetitorSocialPage"
    GROUP BY "identityKey"
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 100
  `);
  return summarise("CompetitorSocialPage", ["identityKey"], rows);
}

/**
 * MarketInsight
 * NO unique constraint — this is the main gap.
 * Key: type + title + status + COALESCE(competitorId,'') + COALESCE(keywordId,'') + COALESCE(adId,'') + DATE(createdAt)
 */
async function checkMarketInsight() {
  const rows = await rawDupQuery(`
    SELECT
      type,
      title,
      status,
      COALESCE("competitorId", '') AS "competitorId",
      COALESCE("keywordId", '') AS "keywordId",
      COALESCE("adId", '') AS "adId",
      DATE("createdAt") AS createdat,
      COUNT(*) AS cnt,
      ARRAY_AGG(id ORDER BY "createdAt") AS example_ids
    FROM "MarketInsight"
    GROUP BY
      type, title, status,
      COALESCE("competitorId", ''),
      COALESCE("keywordId", ''),
      COALESCE("adId", ''),
      DATE("createdAt")
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 100
  `);
  return summarise(
    "MarketInsight",
    ["type", "title", "status", "competitorId", "keywordId", "adId", "createdAt (date)"],
    rows
  );
}

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------

/**
 * @param {TableResult} result
 */
function printResult(result) {
  const status = result.dupGroups === 0 ? "✅ CLEAN" : "❌ DUPLICATES";
  console.log(`\n  ${status}  ${result.table}`);
  if (result.dupGroups > 0) {
    console.log(`           Duplicate groups : ${result.dupGroups}`);
    console.log(`           Total dup rows   : ${result.totalDupRows}`);
    console.log(`           Examples:`);
    for (const ex of result.examples) {
      console.log(`             • ${ex}`);
    }
  }
}

// ---------------------------------------------------------------------------
// --fix stub
// ---------------------------------------------------------------------------
function runFix() {
  console.log("\n⚠️  --fix flag detected.");
  console.log("   TODO: Duplicate cleanup is not yet implemented in this script.");
  console.log("   Cleanup will be addressed in a dedicated task (Phase 3 Task 3).");
  console.log("   Run without --fix to generate the duplicate report only.\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nMarket Intelligence duplicate detection  —  ${new Date().toISOString()}`);
  console.log(`Env: ${envFile}`);
  console.log("=".repeat(72));

  if (fixMode) {
    runFix();
  }

  await prisma.$connect();

  /** @type {TableResult[]} */
  const results = [];

  const checks = [
    checkKeywordResearchResult,
    checkShoppingResult,
    checkShoppingPriceHistory, // returns two results
    checkCompetitorAd,
    checkCompetitorAdCapture,
    checkCompetitorSocialPage,
    checkMarketInsight,
  ];

  for (const check of checks) {
    try {
      const result = await check();
      if (Array.isArray(result)) {
        results.push(...result);
      } else {
        results.push(result);
      }
    } catch (err) {
      const tableName = check.name.replace(/^check/, "");
      console.error(`  ERROR checking ${tableName}: ${String(err?.message || err).slice(0, 120)}`);
      results.push({
        table: tableName,
        keyFields: [],
        dupGroups: -1,
        totalDupRows: -1,
        examples: [`ERROR: ${String(err?.message || err).slice(0, 80)}`],
      });
    }
  }

  // Print summary
  console.log("\nResults:");
  for (const r of results) {
    printResult(r);
  }

  // Aggregate totals
  const totalDupGroups = results.reduce((acc, r) => acc + Math.max(r.dupGroups, 0), 0);
  const totalDupRows = results.reduce((acc, r) => acc + Math.max(r.totalDupRows, 0), 0);
  const errors = results.filter((r) => r.dupGroups < 0).length;

  console.log("\n" + "=".repeat(72));
  if (errors > 0) {
    console.log(`⚠️  ${errors} table check(s) errored — see above.`);
  }
  if (totalDupGroups === 0 && errors === 0) {
    console.log("✅  No duplicates found across all Market Intelligence tables.");
  } else {
    console.log(
      `❌  Found ${totalDupGroups} duplicate group(s) totalling ${totalDupRows} rows across ${
        results.filter((r) => r.dupGroups > 0).length
      } table(s).`
    );
  }

  // Write JSON report
  const report = {
    generatedAt: new Date().toISOString(),
    env: envFile,
    totalDupGroups,
    totalDupRows,
    errors,
    tables: results,
  };

  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`\nReport written to: ${REPORT_PATH}`);
  } catch (writeErr) {
    console.error(`\nFailed to write report: ${String(writeErr?.message || writeErr)}`);
  }

  await prisma.$disconnect();

  // Exit 1 if any duplicates found (CI signal)
  if (totalDupGroups > 0 || errors > 0) {
    process.exit(1);
  }
  process.exit(0);
}

try {
  await main();
} catch (err) {
  const message = String(err?.message || err);
  if (message.includes("Can't reach database server")) {
    console.error("\nCannot reach the database. Check DATABASE_URL and make sure Postgres is running/reachable.\n");
  } else {
    console.error(`\nDuplicate detection failed: ${message.slice(0, 500)}\n`);
  }
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
}
