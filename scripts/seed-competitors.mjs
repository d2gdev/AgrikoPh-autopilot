/**
 * Seed the authoritative competitor set with numeric Facebook page_ids for the
 * Apify Meta source. Deactivates old pages whose pageId isn't a numeric id
 * (handles, URLs, keyword pseudo-pages) so only clean targets stay active.
 *
 * Run on the server:  node scripts/seed-competitors.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const COMPETITORS = [
  // Direct tea / herbal
  { name: "Trinitea", pageId: "1093927063796921", pageName: "Golden Digest Detox Trinitea" },
  { name: "PYX Food Products", pageId: "213034178566499", pageName: "PYX Food Products" },
  { name: "Sambong Tea PH", pageId: "102147731710868", pageName: "Sambong Tea ph" },
  { name: "Better Turmeric Herbal", pageId: "973667989169090", pageName: "Better Turmeric Herbal" },
  { name: "KleenenFit", pageId: "418054424720954", pageName: "KleenenFit (Vita-Tea)" },
  { name: "Doc Roger's Herbal Tea", pageId: "818316954692458", pageName: "Doc Roger's Herbal Tea" },
  { name: "Ron's Cloves Tea PH", pageId: "736320506230267", pageName: "Ron's Cloves Tea Philippines" },
  { name: "Ecarma Health Options", pageId: "104487547822298", pageName: "Ecarma Health Options" },
  { name: "Yamang Bukid", pageId: "105418955171297", pageName: "Yamang Bukid Insulin Plant Tea" },
  // Organic / wellness
  { name: "Healthy Options", pageId: "205050162852588", pageName: "Healthy Options" },
  { name: "Charlotte Organics PH", pageId: "104778032065262", pageName: "Charlotte Organics PH" },
  { name: "Naturefood Organics", pageId: "103335978155957", pageName: "Naturefood Organics" },
  { name: "Luxe Organix PH", pageId: "1827590223960280", pageName: "Luxe Organix Philippines" },
  { name: "Salveo Barley Grass", pageId: "102140559207351", pageName: "Salveo Organic Barley Grass" },
  { name: "NutriHydro Plant Nutrients", pageId: "106400534458483", pageName: "NutriHydro Plant Nutrients" },
  { name: "Sunnywood Superfoods", pageId: "685045158031038", pageName: "Sunnywood superfoods corp." },
  { name: "Organics.ph", pageId: "880746965451366", pageName: "Organics.ph" },
];

(async () => {
  // 1) Deactivate every existing social page whose pageId isn't a clean numeric id.
  const allPages = await prisma.competitorSocialPage.findMany({ select: { id: true, pageId: true } });
  const toDeactivate = allPages.filter((p) => !p.pageId || !/^\d+$/.test(p.pageId)).map((p) => p.id);
  if (toDeactivate.length) {
    await prisma.competitorSocialPage.updateMany({ where: { id: { in: toDeactivate } }, data: { active: false } });
  }
  console.log(`Deactivated ${toDeactivate.length} non-numeric social pages.`);

  // 2) Upsert competitors + their numeric facebook page.
  let added = 0, updated = 0;
  for (const c of COMPETITORS) {
    const comp = await prisma.competitor.upsert({
      where: { name: c.name },
      create: { name: c.name, active: true },
      update: { active: true },
    });
    const existing = await prisma.competitorSocialPage.findFirst({
      where: { competitorId: comp.id, pageId: c.pageId },
      select: { id: true },
    });
    if (existing) {
      await prisma.competitorSocialPage.update({
        where: { id: existing.id },
        data: { active: true, platform: "facebook", pageName: c.pageName },
      });
      updated++;
    } else {
      await prisma.competitorSocialPage.create({
        data: { competitorId: comp.id, platform: "facebook", pageName: c.pageName, pageId: c.pageId, active: true },
      });
      added++;
    }
  }
  const activeNumeric = await prisma.competitorSocialPage.count({ where: { active: true } });
  console.log(`Competitors seeded: ${added} new pages, ${updated} updated.`);
  console.log(`Active social pages now: ${activeNumeric}`);
  await prisma.$disconnect();
})().catch((e) => { console.error("ERR", String(e).slice(0, 300)); process.exit(1); });
