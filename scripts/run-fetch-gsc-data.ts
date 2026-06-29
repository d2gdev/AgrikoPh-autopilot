import { fetchGscDataHandler } from "../jobs/fetch-gsc-data";

// Runs the GSC snapshot directly (no HTTP maxDuration cap).
//   tsx scripts/run-fetch-gsc-data.ts
async function main() {
  console.log("[run] Starting fetch-gsc-data...");
  const result = await fetchGscDataHandler();
  console.log("[run] Done:", JSON.stringify(result, null, 2));
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch((e) => {
  console.error("[run] Failed:", e);
  process.exit(1);
});
