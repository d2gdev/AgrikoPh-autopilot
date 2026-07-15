import { appendFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchSerperOrganicResults } from "@/lib/connectors/serper-organic";
import { captureDailyBrandSerp, serializeBrandSerpObservations } from "@/lib/seo/brand-serp";

const outputDir = process.env.BRAND_SERP_OUTPUT_DIR ?? "docs/seo";
const rawDir = path.join(outputDir, "raw");
const csvPath = path.join(outputDir, "brand-serp-observations.csv");
const observedAt = new Date().toISOString();

const captures = await captureDailyBrandSerp({
  observedAt,
  fetchResults: fetchSerperOrganicResults,
});

await mkdir(rawDir, { recursive: true });

let includeHeader = false;
try {
  includeHeader = (await stat(csvPath)).size === 0;
} catch {
  includeHeader = true;
}

const observations = captures.flatMap(capture => capture.observations);
await appendFile(csvPath, serializeBrandSerpObservations(observations, { includeHeader }), "utf8");

const stamp = observedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const rawPath = path.join(rawDir, `brand-serp-${stamp}.json`);
await writeFile(rawPath, `${JSON.stringify(captures, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ observedAt, captures: captures.length, observations: observations.length, csvPath, rawPath }));
