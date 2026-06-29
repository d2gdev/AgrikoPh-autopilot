/**
 * Deduplicate MarketKeyword rows. Keeps one active row per normalized keyword
 * (trim + lowercase) — the earliest-created — and deactivates the rest. Non-
 * destructive (only flips `active`), so FK-linked history (research/shopping/
 * insights) stays intact and it's reversible.
 *   node scripts/dedupe-market-keywords.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

(async () => {
  const all = await prisma.marketKeyword.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, keyword: true, active: true },
  });

  const seen = new Set();
  const toDeactivate = [];
  for (const k of all) {
    const key = norm(k.keyword);
    if (!key) continue;
    if (seen.has(key)) {
      if (k.active) toDeactivate.push(k.id); // keep first, deactivate later dupes
    } else {
      seen.add(key);
    }
  }

  if (toDeactivate.length) {
    await prisma.marketKeyword.updateMany({
      where: { id: { in: toDeactivate } },
      data: { active: false },
    });
  }

  const activeNow = await prisma.marketKeyword.count({ where: { active: true } });
  console.log(`total rows: ${all.length}`);
  console.log(`distinct keywords: ${seen.size}`);
  console.log(`deactivated duplicates: ${toDeactivate.length}`);
  console.log(`active keywords now: ${activeNow}`);
  await prisma.$disconnect();
})().catch((e) => { console.error("ERR", String(e).slice(0, 300)); process.exit(1); });
