import { getLatestGscData, getPreviousGscQueries } from "@/lib/seo/data";
import { computeTrends } from "@/lib/seo/trends";
import type { QueryMover } from "@/lib/seo/types";

const MOVERS_PER_DIRECTION = 3;

export type GscMoversResult = {
  risers: QueryMover[];
  fallers: QueryMover[];
  fetchedAt: string | null;
};

export async function getGscMovers(): Promise<GscMoversResult> {
  const latest = await getLatestGscData();
  const previous = await getPreviousGscQueries(latest);

  const trends = computeTrends(
    latest.queries,
    previous,
    latest.fetchedAt?.toISOString() ?? null,
    null,
  );

  const risers = [...trends.movers]
    .filter((m) => m.clicksDelta > 0)
    .sort((a, b) => b.clicksDelta - a.clicksDelta)
    .slice(0, MOVERS_PER_DIRECTION);

  const fallers = [...trends.movers]
    .filter((m) => m.clicksDelta < 0)
    .sort((a, b) => a.clicksDelta - b.clicksDelta)
    .slice(0, MOVERS_PER_DIRECTION);

  return { risers, fallers, fetchedAt: latest.fetchedAt?.toISOString() ?? null };
}
