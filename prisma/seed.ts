import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Seed default guardrail config
  const defaults = [
    { key: "HARD_BLOCK_BID_CHANGE_PCT", value: "50", label: "Max bid change % (hard block)", valueType: "number" },
    { key: "HARD_BLOCK_BUDGET_CHANGE_PCT", value: "200", label: "Max budget change % (hard block)", valueType: "number" },
    { key: "HARD_BLOCK_MIN_CONVERSIONS", value: "10", label: "Min conversions required (hard block)", valueType: "number" },
    { key: "HARD_BLOCK_PAUSE_DAILY_BUDGET", value: "10000", label: "Pause campaign if daily budget exceeds ₱ (hard block)", valueType: "currency" },
    { key: "SOFT_FLAG_CHANGE_PCT", value: "30", label: "Change % that triggers soft flag warning", valueType: "number" },
    { key: "SOFT_FLAG_PAUSE_DAILY_BUDGET", value: "200", label: "Pause campaign if daily budget exceeds ₱ (soft flag)", valueType: "currency" },
    { key: "SOFT_FLAG_MIN_CONFIDENCE", value: "0.5", label: "Min confidence score (below = soft flag)", valueType: "number" },
  ];

  for (const d of defaults) {
    await prisma.guardrailConfig.upsert({
      where: { key: d.key },
      update: {},
      create: d,
    });
  }

  console.log("Seeded guardrail defaults");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
