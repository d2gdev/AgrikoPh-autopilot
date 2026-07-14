import { prisma } from "@/lib/db";
import { cleanupTopicalMapAdvisories } from "@/lib/store-tasks/topical-map-advisories";

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await cleanupTopicalMapAdvisories(prisma, {
    apply,
    actor: "topical-map-advisory-cleanup",
  });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error("[cleanup-topical-map-advisories] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
