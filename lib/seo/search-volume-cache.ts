import { prisma } from "@/lib/db";
import { fetchSearchVolume } from "@/lib/connectors/dataforseo-keywords";

// Search volume changes slowly (monthly) — a 30-day cache means we hit the
// metered DataForSEO API at most once per keyword per month.
const STALE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_QUERIES = 50;

/**
 * Populate/refresh cached DataForSEO monthly search volume for the given query
 * keywords. Bounded to the top MAX_QUERIES, and only fetches keywords missing or
 * older than STALE_MS — a single bulk DataForSEO call. Non-fatal: returns the
 * number of rows written (0 when the connector is disabled/out of quota).
 */
export async function fillSearchVolumeCache(queries: string[], now: Date = new Date()): Promise<number> {
  const keys = Array.from(
    new Set(queries.map((q) => q.trim().toLowerCase()).filter((k) => k.length > 0)),
  ).slice(0, MAX_QUERIES);
  if (keys.length === 0) return 0;

  const existing = await prisma.keywordSearchVolume.findMany({
    where: { keyword: { in: keys } },
    select: { keyword: true, fetchedAt: true },
  });
  const fresh = new Set(
    existing
      .filter((e) => now.getTime() - e.fetchedAt.getTime() < STALE_MS)
      .map((e) => e.keyword),
  );
  const toFetch = keys.filter((k) => !fresh.has(k));
  if (toFetch.length === 0) return 0;

  const { disabled, volumes } = await fetchSearchVolume(toFetch);
  if (disabled || volumes.size === 0) return 0;

  let filled = 0;
  for (const [keyword, searchVolume] of volumes) {
    await prisma.keywordSearchVolume.upsert({
      where: { keyword },
      create: { keyword, searchVolume, source: "dataforseo", fetchedAt: now },
      update: { searchVolume, source: "dataforseo", fetchedAt: now },
    });
    filled++;
  }
  return filled;
}
