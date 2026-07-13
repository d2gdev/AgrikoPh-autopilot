import { prisma } from "@/lib/db";
import { cleanupTopicalMapAdvisories } from "@/lib/store-tasks/topical-map-advisories";

const apply = process.argv.includes("--apply");
const result = await cleanupTopicalMapAdvisories(prisma, {
  apply,
  actor: "topical-map-advisory-cleanup",
});
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result }, null, 2));
await prisma.$disconnect();
