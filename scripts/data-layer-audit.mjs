/**
 * Data-layer freshness audit.
 *
 * Unlike connector-health (which only checks that credentials are present),
 * this verifies that real data is actually LANDING in the database: row counts,
 * how recent the newest record is, and whether the last job run succeeded.
 *
 * Run where DATABASE_URL points at the database with real data (usually prod):
 *   node scripts/data-layer-audit.mjs
 *   node scripts/data-layer-audit.mjs --env .env.production
 */

import process from "process";

// Allow `--env <file>` to pick which dotenv file to load (defaults to .env).
const envArgIdx = process.argv.indexOf("--env");
const envFile = envArgIdx >= 0 ? process.argv[envArgIdx + 1] : ".env";
const dotenv = await import("dotenv");
dotenv.config({ path: envFile });

if (!process.env.DATABASE_URL && process.env.DATABASE_URL_PROD) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
}

if (!process.env.DATABASE_URL) {
  console.error(`DATABASE_URL not found (looked in ${envFile}; DATABASE_URL_PROD is accepted as a fallback).`);
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const sevenDaysAgo = new Date(now - 7 * DAY);

// Each data stream: the Prisma model, the timestamp field that marks "freshness",
// the cron job that feeds it, and how stale it's allowed to get before we warn.
const STREAMS = [
  { model: "rawSnapshot", ts: "fetchedAt", job: "fetch-seo-data", rawSource: "gsc",            staleDays: 8,  label: "Raw Snapshot: GSC Queries" },
  { model: "rawSnapshot", ts: "fetchedAt", job: "fetch-seo-data", rawSource: "gsc_pages",      staleDays: 8,  label: "Raw Snapshot: GSC Pages" },
  { model: "rawSnapshot", ts: "fetchedAt", job: "fetch-seo-data", rawSource: "gsc_query_page", staleDays: 8,  label: "Raw Snapshot: GSC Query+Page" },
  { model: "rawSnapshot", ts: "fetchedAt", job: "fetch-seo-data", rawSource: "ga4",            staleDays: 8,  label: "Raw Snapshot: GA4" },
  { model: "rawSnapshot", ts: "fetchedAt", job: "fetch-ads-data", rawSource: "meta",           staleDays: 2,  label: "Raw Snapshot: Meta Ads" },
  { model: "competitorAd",          ts: "capturedAt", job: "fetch-market-intel",        staleDays: 2,  label: "Competitor Ads (Meta)" },
  { model: "competitorAdCapture",   ts: "capturedAt", job: "fetch-market-intel",        staleDays: 8,  label: "Competitor Ad Captures" },
  { model: "shoppingResult",        ts: "capturedAt", job: "fetch-market-intel",        staleDays: 2,  label: "Shopping Results" },
  { model: "shoppingPriceHistory",  ts: "capturedAt", job: "fetch-market-intel",        staleDays: 2,  label: "Price History" },
  { model: "keywordResearchResult", ts: "capturedAt", job: "fetch-keyword-research",    staleDays: 8,  label: "Keyword Planner Research" },
  { model: "gscQuery",              ts: "capturedAt", job: "fetch-gsc-data",            staleDays: 8,  label: "GSC Search Analytics (Agriko)" },
  { model: "pageAnalytics",         ts: "capturedAt", job: "fetch-seo-data",            staleDays: 8,  label: "GA4 Page Analytics" },
  { model: "marketInsight",         ts: "createdAt",  job: null,                        staleDays: 8,  label: "Market Insights" },
  { model: "articleSnapshot",       ts: "capturedAt", job: "fetch-blog-content",        staleDays: 8,  label: "Article Snapshots" },
  { model: "internalLinkEdge",      ts: "capturedAt", job: "fetch-blog-content",        staleDays: 8,  label: "Internal Link Edges" },
  { model: "opportunity",           ts: "updatedAt",  job: null,                        staleDays: 8,  label: "Opportunities" },
  { model: "storeTask",             ts: "updatedAt",  job: null,                        staleDays: 8,  label: "Store Tasks" },
  { model: "competitor",            ts: "createdAt",  job: null,                        staleDays: null, label: "Competitors (config)" },
  { model: "competitorSocialPage",  ts: "createdAt",  job: null,                        staleDays: null, label: "Competitor Social Pages (config)" },
  { model: "marketKeyword",         ts: "createdAt",  job: null,                        staleDays: null, label: "Market Keywords (config)" },
  { model: "articleRecord",         ts: "updatedAt",  job: "fetch-blog-content",        staleDays: 8,  label: "Blog Articles" },
];

function fmtAge(date) {
  if (!date) return "—";
  const hrs = (now - date.getTime()) / (60 * 60 * 1000);
  if (hrs < 48) return `${hrs.toFixed(1)}h ago`;
  return `${(hrs / 24).toFixed(1)}d ago`;
}

function verdict(stream, total, newest) {
  if (total === 0) return "❌ EMPTY";
  if (stream.staleDays == null) return "• config";
  if (!newest) return "⚠️  no timestamp";
  const ageDays = (now - newest.getTime()) / DAY;
  return ageDays > stream.staleDays ? `⚠️  STALE (${ageDays.toFixed(1)}d)` : "✅ fresh";
}

console.log(`\nData-layer audit  —  ${new Date(now).toISOString()}  (env: ${envFile})\n`);
console.log("Stream                                  Total    Last7d   Newest          Verdict");
console.log("─".repeat(92));

async function run() {
  await prisma.$connect();
  for (const s of STREAMS) {
    try {
      const delegate = prisma[s.model];
      const baseWhere = s.rawSource ? { source: s.rawSource } : {};
      const total = await delegate.count({ where: baseWhere });
      const last7d = await delegate.count({ where: { ...baseWhere, [s.ts]: { gte: sevenDaysAgo } } });
      const newestRow = total > 0
        ? await delegate.findFirst({ where: baseWhere, orderBy: { [s.ts]: "desc" }, select: { [s.ts]: true, ...(s.model === "rawSnapshot" ? { payload: true } : {}) } })
        : null;
      const newest = newestRow ? newestRow[s.ts] : null;
      const emptyPayload =
        s.model === "rawSnapshot" &&
        newestRow?.payload &&
        typeof newestRow.payload === "object" &&
        Object.keys(newestRow.payload).length === 0;
      const streamVerdict = emptyPayload ? "⚠️  empty payload" : verdict(s, total, newest);
      console.log(
        `${s.label.padEnd(40)}${String(total).padStart(6)}   ${String(last7d).padStart(6)}   ${fmtAge(newest).padEnd(14)}  ${streamVerdict}`
      );
    } catch (err) {
      console.log(`${s.label.padEnd(40)}  ERROR: ${String(err.message || err).slice(0, 40)}`);
    }
  }

  // Last run per data-feeding job.
  console.log("\nJob runs (latest per job):");
  console.log("─".repeat(92));
  const jobNames = [...new Set(STREAMS.map((s) => s.job).filter(Boolean))];
  for (const jobName of jobNames) {
    const last = await prisma.jobRun.findFirst({
      where: { jobName },
      orderBy: { startedAt: "desc" },
      select: { status: true, startedAt: true, completedAt: true, errorLog: true, summary: true },
    });
    if (!last) {
      console.log(`${jobName.padEnd(28)} ❌ never run`);
      continue;
    }
    const icon = last.status === "success" ? "✅" : last.status === "partial" ? "⚠️ " : last.status === "failed" ? "❌" : "⏳";
    const err = last.errorLog ? `  err: ${last.errorLog.slice(0, 60)}` : "";
    console.log(`${jobName.padEnd(28)} ${icon} ${String(last.status).padEnd(8)} ${fmtAge(last.startedAt).padEnd(12)}${err}`);
  }

  console.log("");
  await prisma.$disconnect();
}

try {
  await run();
} catch (err) {
  const message = String(err?.message || err);
  if (message.includes("Can't reach database server")) {
    console.error("\nCannot reach the database. Check DATABASE_URL and make sure Postgres is running/reachable.\n");
  } else {
    console.error(`\nData-layer audit failed: ${message.slice(0, 500)}\n`);
  }
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
}
