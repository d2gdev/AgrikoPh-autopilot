/**
 * backfill-ad-angles.ts — classify creativeAngle for existing competitor ads
 * that don't have one yet. Runs in batches until none remain.
 *
 *   npx tsx scripts/backfill-ad-angles.ts
 */
import { prisma } from "../lib/db";
import { fillCreativeAngles } from "../lib/market-intel/classify-angles";

async function main() {
  // --reset re-classifies everything (e.g. after a prompt/model fix) by clearing
  // existing labels first.
  if (process.argv.includes("--reset")) {
    const { count } = await prisma.competitorAd.updateMany({
      where: { creativeAngle: { not: null } },
      data: { creativeAngle: null },
    });
    console.log(`reset ${count} existing angle labels to null`);
  }

  let total = 0;
  for (;;) {
    const { classified } = await fillCreativeAngles({ limit: 100 });
    total += classified;
    console.log(`classified ${classified} (running total ${total})`);
    if (classified === 0) break;
  }
  console.log(`✓ done — ${total} ads classified`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("backfill-ad-angles failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
