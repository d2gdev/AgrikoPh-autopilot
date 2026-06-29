import { fetchMarketIntelHandler } from "../jobs/fetch-market-intel";

// Runs the market-intel fetch directly (no HTTP maxDuration cap) so the Apify
// Meta run, which can take several minutes, completes and writes to the DB.
//   tsx scripts/run-fetch-market-intel.ts
async function main() {
  console.log("[run] Starting fetch-market-intel...");
  const result = await fetchMarketIntelHandler({ profile: "scheduled" });
  console.log("[run] Done:", JSON.stringify(result, null, 2));
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch((e) => {
  console.error("[run] Failed:", e);
  process.exit(1);
});
