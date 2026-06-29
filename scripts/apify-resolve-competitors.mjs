/**
 * Resolve competitor brand names -> numeric Facebook page_id via the Apify
 * actor, by searching each name and matching the returned page_name.
 *   node scripts/apify-resolve-competitors.mjs
 */
import { readFileSync, writeFileSync } from "fs";

const env = readFileSync(".env", "utf8");
const TOKEN = (env.match(/^APIFY_API=(.*)$/m) || [])[1]?.trim();
const ACTOR = "XtaWFhbtfxyzqrFmd";
if (!TOKEN) { console.error("APIFY_API missing"); process.exit(1); }

const NAMES = [
  "Healthy Options", "Charlotte Organics", "Organics.ph", "Salveo Barley Grass",
  "Naturefood Organics", "Luxe Organix", "NutriHydro Plant Nutrients",
  "Trinitea", "PYX Food Products", "Sambong Tea ph", "Better Turmeric Herbal",
  "KleenenFit", "Golden Digest Detox Trinitea", "Doc Roger's Herbal Tea",
  "Yamang Bukid", "Sunnywood superfoods",
];

const adLibUrl = (term) =>
  "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=PH" +
  "&q=" + encodeURIComponent(term) + "&search_type=keyword_unordered&media_type=all";

const api = (p) => `https://api.apify.com/v2${p}${p.includes("?") ? "&" : "?"}token=${TOKEN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

(async () => {
  const input = {
    urls: NAMES.map((t) => ({ url: adLibUrl(t), method: "GET" })),
    scrapeAdDetails: false, count: 600, limitPerSource: 40,
    scrapePageAds: { activeStatus: "all", countryCode: "PH" },
  };
  const s = await (await fetch(api(`/acts/${ACTOR}/runs`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).json();
  if (!s.data?.id) { console.error("start fail", JSON.stringify(s).slice(0, 200)); process.exit(1); }
  let st = s.data.status; const did = s.data.defaultDatasetId, rid = s.data.id;
  while (["READY", "RUNNING"].includes(st)) { await sleep(8000); st = (await (await fetch(api(`/actor-runs/${rid}`))).json()).data?.status; }
  const list = await (await fetch(api(`/datasets/${did}/items?clean=true&format=json`))).json();
  const arr = Array.isArray(list) ? list : [];

  // group by page
  const pages = {};
  for (const a of arr) {
    const id = a.page_id, name = a.page_name;
    if (!id) continue;
    pages[id] = pages[id] || { id, name, ads: 0 };
    pages[id].ads++;
  }
  const allPages = Object.values(pages);

  console.log("name -> resolved page_id (ads) | page_name");
  const resolved = [];
  for (const term of NAMES) {
    const tnorm = norm(term);
    const tokens = tnorm.split(" ").filter((w) => w.length > 2);
    // score pages by how many distinctive tokens appear in page_name
    const scored = allPages.map((p) => {
      const pn = norm(p.name);
      const hits = tokens.filter((tk) => pn.includes(tk)).length;
      return { ...p, hits };
    }).filter((p) => p.hits > 0).sort((a, b) => b.hits - a.hits || b.ads - a.ads);
    const best = scored[0];
    if (best) {
      resolved.push({ term, pageId: best.id, pageName: best.name, ads: best.ads });
      console.log(`  ${term.padEnd(28)} ${best.id.padEnd(18)} (${best.ads}) | ${best.name}`);
    } else {
      console.log(`  ${term.padEnd(28)} NOT FOUND`);
    }
  }
  writeFileSync("tmp/competitor-pageids.json", JSON.stringify(resolved, null, 2));
  console.log("\nsaved -> tmp/competitor-pageids.json (" + resolved.length + " resolved)");
})().catch((e) => { console.error("ERR", String(e).slice(0, 200)); process.exit(1); });
