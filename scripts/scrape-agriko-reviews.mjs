/**
 * Scrape Agriko product reviews (reviewer name + text + rating) from the Google
 * Shopping product viewer and store them in ProductReview.
 *   node scripts/scrape-agriko-reviews.mjs
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const prisma = new PrismaClient();
const env = readFileSync(".env", "utf8");
const KEY =
  (env.match(/^SERPER_API_KEY=(.*)$/m) || [])[1]?.trim() ||
  (env.match(/^SERPER_DEV_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) { console.error("SERPER key missing"); process.exit(1); }

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1) Find Agriko products from the shopping feed.
  const res = await fetch("https://google.serper.dev/shopping", {
    method: "POST",
    headers: { "X-API-KEY": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q: "agriko", gl: "ph", num: 40 }),
  });
  const data = await res.json();
  const products = (data.shopping || [])
    .filter((p) => /agriko/i.test(p.title || ""))
    .slice(0, 6);
  console.log(`Agriko products found: ${products.length}`);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let stored = 0;

  for (const p of products) {
    console.log(`\n→ ${p.title.slice(0, 60)} (${p.source})`);
    const page = await browser.newPage({ locale: "en-US", userAgent: UA, viewport: { width: 1365, height: 900 } });
    try {
      await page.goto(p.link, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await sleep(4000);
      // Open the product viewer.
      const entry = await page.$('[data-attrid="apg-product-result"], product-viewer-entrypoint');
      if (entry) { await entry.click({ timeout: 5000 }).catch(() => {}); await sleep(4500); }
      // Try to reveal reviews: click any element mentioning Reviews, then scroll.
      for (const label of ["Reviews", "reviews", "All reviews"]) {
        const t = page.getByText(label, { exact: false }).first();
        if (await t.count().catch(() => 0)) { await t.click({ timeout: 3000 }).catch(() => {}); await sleep(2500); break; }
      }
      for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 1500); await sleep(1200); }

      // Heuristic extraction: each review usually has a star aria-label, some text, and a reviewer name.
      const candidates = await page.evaluate(() => {
        const out = [];
        const stars = Array.from(document.querySelectorAll('[aria-label*="out of 5"], [aria-label*="stars"]'));
        for (const n of stars) {
          let el = n, block = "";
          for (let i = 0; i < 6 && el; i++) {
            el = el.parentElement; if (!el) break;
            const txt = (el.innerText || "").trim();
            if (txt.length > 15 && txt.length < 900) { block = txt; break; }
          }
          out.push({ aria: n.getAttribute("aria-label") || "", block });
        }
        return out.slice(0, 60);
      });

      for (const c of candidates) {
        const m = c.aria.match(/([\d.]+)\s*(?:out of 5|stars)/i);
        const rating = m ? parseFloat(m[1]) : null;
        // Pull a plausible reviewer name (line that looks like a person) and review text.
        const lines = c.block.split("\n").map((s) => s.trim()).filter(Boolean);
        const nameLine = lines.find((l) => /^[A-Z][a-z]+(?:\s+[A-Z][a-z.]*)?$/.test(l) && l.length < 40);
        const textLine = lines.filter((l) => l !== nameLine && l.length > 20).sort((a, b) => b.length - a.length)[0];
        if (!textLine && !nameLine) continue;
        try {
          await prisma.productReview.create({
            data: {
              productId: p.productId ?? null,
              productTitle: p.title,
              source: p.source ?? null,
              reviewerName: nameLine ?? null,
              rating,
              text: textLine ?? null,
              reviewDate: null,
            },
          });
          stored++;
        } catch (e) { /* unique dupe — skip */ }
      }
      console.log(`  candidates: ${candidates.length}, stored so far: ${stored}`);
    } catch (e) {
      console.log(`  ERR ${String(e).slice(0, 120)}`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  await browser.close();
  const total = await prisma.productReview.count();
  console.log(`\n=== ProductReview rows in DB: ${total} (stored this run: ${stored}) ===`);
  const sample = await prisma.productReview.findMany({ take: 8, orderBy: { createdAt: "desc" }, select: { productTitle: true, reviewerName: true, rating: true, text: true } });
  sample.forEach((r) => console.log("  " + JSON.stringify({ p: (r.productTitle || "").slice(0, 28), who: r.reviewerName, r: r.rating, t: (r.text || "").slice(0, 60) })));
  await prisma.$disconnect();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
