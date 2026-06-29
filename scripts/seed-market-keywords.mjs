/**
 * Seed + reconcile the MarketKeyword seed list from the Agriko keyword roadmap.
 * For each normalized keyword it keeps ONE canonical active row (locationName
 * "Philippines", languageCode "en", tagged with its cluster category) and
 * deactivates any duplicate rows. New keywords are created. Non-destructive:
 * duplicates are only deactivated (active=false), never deleted.
 *   node scripts/seed-market-keywords.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const LOCATION = "Philippines";
const LANG = "en";

// [keyword, cluster category]
const KEYWORDS = [
  // Rice commerce
  ["organic rice", "Rice commerce"],
  ["black rice", "Rice commerce"],
  ["red rice", "Rice commerce"],
  ["brown rice", "Rice commerce"],
  ["filipino organic rice", "Rice commerce"],
  ["organic black rice philippines", "Rice commerce"],
  ["black rice philippines", "Rice commerce"],
  ["organic red rice philippines", "Rice commerce"],
  ["red rice philippines", "Rice commerce"],
  ["organic rice philippines", "Rice commerce"],
  ["buy organic rice online philippines", "Rice commerce"],
  ["organic rice delivery philippines", "Rice commerce"],
  ["black rice price philippines", "Rice commerce"],
  ["red rice price philippines", "Rice commerce"],
  ["organic brown rice philippines", "Rice commerce"],
  ["organic white rice philippines", "Rice commerce"],
  ["roasted black rice drink", "Rice commerce"],
  // Herbal blends
  ["turmeric tea", "Herbal blends"],
  ["ginger tea", "Herbal blends"],
  ["turmeric tea philippines", "Herbal blends"],
  ["5 in 1 turmeric tea", "Herbal blends"],
  ["5 in 1 power shot", "Herbal blends"],
  ["cacao turmeric drink", "Herbal blends"],
  ["turmeric ginger moringa drink", "Herbal blends"],
  ["ginger tea powder", "Herbal blends"],
  ["herbal tea recipes", "Herbal blends"],
  // Pure powders
  ["turmeric powder", "Pure powders"],
  ["ginger powder", "Pure powders"],
  ["moringa powder", "Pure powders"],
  ["malunggay powder", "Pure powders"],
  ["blue ternate powder", "Pure powders"],
  ["turmeric powder philippines", "Pure powders"],
  ["moringa powder philippines", "Pure powders"],
  ["malunggay powder philippines", "Pure powders"],
  ["ginger powder philippines", "Pure powders"],
  ["pure turmeric powder", "Pure powders"],
  ["pure ginger powder", "Pure powders"],
  ["blue ternate powder philippines", "Pure powders"],
  ["butterfly pea powder philippines", "Pure powders"],
  // Education and comparison
  ["black rice benefits", "Education and comparison"],
  ["red rice benefits", "Education and comparison"],
  ["red rice vs black rice", "Education and comparison"],
  ["black rice nutrition", "Education and comparison"],
  ["red rice nutrition", "Education and comparison"],
  ["organic rice benefits", "Education and comparison"],
  ["types of organic rice", "Education and comparison"],
  ["how to cook black rice", "Education and comparison"],
  ["how to cook red rice", "Education and comparison"],
  ["black rice water ratio", "Education and comparison"],
  ["red rice water ratio", "Education and comparison"],
  ["how to store rice", "Education and comparison"],
  ["best way to store rice", "Education and comparison"],
  ["turmeric tea benefits", "Education and comparison"],
  ["how to make turmeric tea", "Education and comparison"],
  ["ginger tea benefits", "Education and comparison"],
  ["blue ternate benefits", "Education and comparison"],
  ["moringa benefits", "Education and comparison"],
  ["malunggay benefits", "Education and comparison"],
  ["guyabano health benefits", "Education and comparison"],
  // Farm and provenance
  ["organic farming philippines", "Farm and provenance"],
  ["sustainable rice farming philippines", "Farm and provenance"],
  ["mindanao organic farm", "Farm and provenance"],
  ["filipino organic farm", "Farm and provenance"],
  ["natural pest management organic farm", "Farm and provenance"],
  ["biodiversity organic farming", "Farm and provenance"],
  // Honey & other commerce
  ["organic honey philippines", "Honey and other"],
  ["raw honey philippines", "Honey and other"],
  ["organic kids cereal philippines", "Honey and other"],
];

const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

(async () => {
  const masterCat = new Map(KEYWORDS.map(([k, c]) => [norm(k), c]));

  const existing = await prisma.marketKeyword.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, keyword: true, locationName: true, languageCode: true, active: true, category: true },
  });

  // Group existing rows by normalized keyword.
  const groups = new Map();
  for (const row of existing) {
    const k = norm(row.keyword);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }

  let created = 0, canonicalUpdated = 0, deactivated = 0;

  // 1) Reconcile existing groups: one canonical Philippines/en active row, rest off.
  for (const [k, rows] of groups) {
    // Prefer an existing (Philippines, en) row as canonical to avoid unique clashes.
    const canonical =
      rows.find((r) => r.locationName === LOCATION && r.languageCode === LANG) ?? rows[0];
    const category = masterCat.get(k) ?? canonical.category ?? null;

    await prisma.marketKeyword.update({
      where: { id: canonical.id },
      data: { active: true, locationName: LOCATION, languageCode: LANG, category },
    });
    canonicalUpdated++;

    const others = rows.filter((r) => r.id !== canonical.id && r.active);
    if (others.length) {
      await prisma.marketKeyword.updateMany({
        where: { id: { in: others.map((r) => r.id) } },
        data: { active: false },
      });
      deactivated += others.length;
    }
  }

  // 2) Create master keywords that don't exist yet.
  for (const [kw, category] of KEYWORDS) {
    const k = norm(kw);
    if (groups.has(k)) continue;
    await prisma.marketKeyword.create({
      data: { keyword: kw, category, locationName: LOCATION, languageCode: LANG, active: true },
    });
    groups.set(k, [{ id: "new" }]); // guard against in-list dupes
    created++;
  }

  const activeNow = await prisma.marketKeyword.count({ where: { active: true } });
  console.log(`master keywords: ${KEYWORDS.length}`);
  console.log(`existing distinct groups reconciled: ${canonicalUpdated}`);
  console.log(`duplicates deactivated: ${deactivated}`);
  console.log(`new keywords created: ${created}`);
  console.log(`active keywords now: ${activeNow}`);
  await prisma.$disconnect();
})().catch((e) => { console.error("ERR", String(e).slice(0, 300)); process.exit(1); });
