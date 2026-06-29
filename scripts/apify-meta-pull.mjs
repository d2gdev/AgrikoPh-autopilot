/**
 * One-off: pull Meta Ad Library data via the curious_coder Apify actor
 * (PAY_PER_EVENT, runs on free credit) for our competitors + product keywords.
 * Saves raw JSON locally and summarises field coverage vs the in-house scraper.
 *
 *   node scripts/apify-meta-pull.mjs [count]
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import process from "process";

const env = readFileSync(".env", "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
const TOKEN = get("APIFY_API");
if (!TOKEN) { console.error("APIFY_API missing in .env"); process.exit(1); }

const ACTOR = "XtaWFhbtfxyzqrFmd"; // curious_coder/facebook-ads-library-scraper (pay-per-event)
const COUNT = Number(process.argv[2] || 3000);

const SEARCH_TERMS = [
  "turmeric tea", "ginger tea", "salabat", "herbal tea", "turmeric",
  "pure honey", "raw honey", "moringa", "malunggay",
  "organic rice", "black rice", "barley grass",
];

const adLibUrl = (term) =>
  "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=PH" +
  "&q=" + encodeURIComponent(term) + "&search_type=keyword_unordered&media_type=all";

const input = {
  urls: SEARCH_TERMS.map((t) => ({ url: adLibUrl(t), method: "GET" })),
  scrapeAdDetails: true,                 // rich fields: title/cta/link
  count: COUNT,
  limitPerSource: 250,                   // cap per product term
  scrapePageAds: { activeStatus: "all", sortBy: "impressions_desc", countryCode: "PH" },
};

const api = (path) => `https://api.apify.com/v2${path}${path.includes("?") ? "&" : "?"}token=${TOKEN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`Apify run: ${SEARCH_TERMS.length} search URLs, count=${COUNT}, country=PH, status=all, details=on`);
  const startRes = await fetch(api(`/acts/${ACTOR}/runs`), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const start = await startRes.json();
  if (!start.data?.id) { console.error("Failed to start:", JSON.stringify(start).slice(0, 400)); process.exit(1); }
  const runId = start.data.id, datasetId = start.data.defaultDatasetId;
  console.log(`Run ${runId} started (dataset ${datasetId}). Polling…`);

  let status = start.data.status; const t0 = Date.now();
  while (["READY", "RUNNING"].includes(status)) {
    await sleep(8000);
    const j = await (await fetch(api(`/actor-runs/${runId}`))).json();
    status = j.data?.status;
    const items = j.data?.stats?.itemCount ?? "?";
    const usd = j.data?.stats?.usdTotalCost ?? j.data?.usageTotalUsd ?? 0;
    process.stdout.write(`  [${Math.round((Date.now() - t0) / 1000)}s] status=${status} items=${items} ~$${Number(usd).toFixed(3)}\n`);
    if (Date.now() - t0 > 14 * 60 * 1000) { console.log("  (poll timeout — fetching dataset so far)"); break; }
  }

  const arr = await (await fetch(api(`/datasets/${datasetId}/items?clean=true&format=json`))).json();
  const list = Array.isArray(arr) ? arr : [];
  mkdirSync("tmp", { recursive: true });
  writeFileSync("tmp/apify-meta-raw.json", JSON.stringify(list, null, 2));
  console.log(`\nSaved ${list.length} ads -> tmp/apify-meta-raw.json`);

  const total = list.length || 1;
  const pct = (n) => Math.round((100 * n) / total) + "%";
  const has = (f) => list.filter((a) => { try { return !!f(a); } catch { return false; } }).length;
  console.log("\n=== top-level fields (first item) ===");
  console.log("  " + (list[0] ? Object.keys(list[0]).join(", ") : "(no items)"));
  const probe = {
    "title (headline)": (a) => a.snapshot?.title || a.title,
    "cta_text": (a) => a.snapshot?.cta_text || a.snapshot?.cta_type,
    "link_url (landing)": (a) => a.snapshot?.link_url,
    "body (copy)": (a) => a.snapshot?.body?.text || a.snapshot?.body,
    "page_name": (a) => a.page_name || a.snapshot?.page_name,
    "start_date": (a) => a.start_date || a.start_date_string,
    "is_active": (a) => a.is_active ?? a.snapshot?.is_active,
    "publisher_platform": (a) => a.publisher_platform,
  };
  console.log("\n=== field coverage over " + list.length + " ads ===");
  for (const [k, f] of Object.entries(probe)) console.log("  " + k.padEnd(22) + pct(has(f)) + " filled");

  const by = {};
  for (const x of list) {
    const id = x.page_id || "?";
    by[id] = by[id] || { id, name: x.page_name || x.snapshot?.page_name || "?", ads: 0, spend: 0 };
    by[id].ads++;
    if (x.spend && JSON.stringify(x.spend) !== "null") by[id].spend++;
  }
  const pages = Object.values(by).sort((p, q) => q.ads - p.ads);
  console.log("\n=== resolved advertiser pages (ads / spend-exposed / page_id / name) ===");
  pages.forEach((p) => console.log("  " + String(p.ads).padStart(3) + "  " + String(p.spend).padStart(3) + "   " + String(p.id).padEnd(18) + p.name));
  console.log("\ntotal distinct pages: " + pages.length);
})().catch((e) => { console.error("ERR", String(e).slice(0, 400)); process.exit(1); });
