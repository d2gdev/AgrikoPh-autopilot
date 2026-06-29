import { prisma } from "@/lib/db";

let cached: string | null = null;
let cachedAt = 0;
const TTL_MS = 60_000;

export async function getBrandGuidelines(): Promise<string> {
  if (cached !== null && Date.now() - cachedAt < TTL_MS) return cached;
  const row = await prisma.guardrailConfig.findUnique({ where: { key: "BRAND_GUIDELINES" } });
  cached = row?.value ?? "";
  cachedAt = Date.now();
  return cached;
}
