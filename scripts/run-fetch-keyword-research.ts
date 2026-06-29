import { fetchKeywordResearchHandler } from "../jobs/fetch-keyword-research";

// Runs keyword research directly (no HTTP maxDuration cap): Keyword Planner search
// volumes for every active seed + long-tail idea expansion.
//   tsx scripts/run-fetch-keyword-research.ts
async function main() {
  console.log("[run] Starting fetch-keyword-research...");
  const result = await fetchKeywordResearchHandler();
  console.log("[run] Done:", JSON.stringify(result, null, 2));
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch((e) => {
  console.error("[run] Failed:", e);
  process.exit(1);
});
