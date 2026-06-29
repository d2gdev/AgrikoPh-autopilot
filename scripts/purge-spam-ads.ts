/**
 * purge-spam-ads.ts — delete spam serialized-story creatives already stored in
 * the competitorAd table (uses the same classifier as the live filters).
 *
 *   npx tsx scripts/purge-spam-ads.ts          # dry run — lists matches, deletes nothing
 *   npx tsx scripts/purge-spam-ads.ts --apply  # actually delete the matched rows
 */
import { prisma } from "../lib/db";
import { scoreSpamStoryAd } from "../lib/market-intel/spam-filter";

async function main() {
  const apply = process.argv.includes("--apply");

  const ads = await prisma.competitorAd.findMany({
    select: {
      id: true,
      pageName: true,
      adCopy: true,
      headline: true,
      description: true,
    },
  });

  const matches = ads
    .map((ad) => ({ ad, ...scoreSpamStoryAd(ad) }))
    .filter((m) => m.isSpam);

  console.log(`Scanned ${ads.length} competitor ads — ${matches.length} flagged as spam.\n`);

  for (const m of matches) {
    const preview = (m.ad.adCopy ?? m.ad.headline ?? "").replace(/\s+/g, " ").slice(0, 80);
    console.log(`  [score ${m.score}] ${m.ad.pageName ?? "(no page)"} — "${preview}…"  {${m.reasons.join(", ")}}`);
  }

  // Insights ("What changed" feed) whose underlying ad is spam.
  const spamAdIds = matches.map((m) => m.ad.id);
  const spamInsights = spamAdIds.length
    ? await prisma.marketInsight.findMany({
        where: { adId: { in: spamAdIds } },
        select: { id: true },
      })
    : [];
  console.log(`Linked spam insights ("What changed" entries): ${spamInsights.length}.`);

  if (matches.length === 0) {
    console.log("\nNothing to purge.");
  } else if (!apply) {
    console.log(`\nDRY RUN — no rows deleted. Re-run with --apply to delete ${matches.length} ads + ${spamInsights.length} insights.`);
  } else {
    // Delete insights first (they FK to ad with SetNull, but we want them gone).
    const delInsights = await prisma.marketInsight.deleteMany({
      where: { id: { in: spamInsights.map((i) => i.id) } },
    });
    const delAds = await prisma.competitorAd.deleteMany({
      where: { id: { in: spamAdIds } },
    });
    console.log(`\n✓ Deleted ${delAds.count} spam ads and ${delInsights.count} spam insights.`);
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("purge-spam-ads failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
