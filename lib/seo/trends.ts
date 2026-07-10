import type { GscQueryRow, QueryMover, SeoTotals, SeoTrends } from "@/lib/seo/types";
import { parseNum } from "@/lib/seo/types";

function totals(rows: GscQueryRow[]): SeoTotals {
  let clicks = 0;
  let impressions = 0;
  let weightedPos = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    weightedPos += parseNum(r.position) * r.impressions;
  }
  return {
    clicks,
    impressions,
    avgCtr: impressions > 0 ? clicks / impressions : 0,
    avgPosition: impressions > 0 ? weightedPos / impressions : 0,
  };
}

export function computeTrends(
  current: GscQueryRow[],
  previous: GscQueryRow[] | null,
  currentFetchedAt: string | null,
  previousFetchedAt: string | null,
): SeoTrends {
  const currentTotals = totals(current);
  const previousTotals = previous ? totals(previous) : null;

  let movers: QueryMover[] = [];

  if (previous) {
    // A1: normalize query keys to match lib/seo/keywords.ts (trim().toLowerCase())
    // so casing/whitespace differences don't produce phantom risers/fallers.
    const normalize = (q: unknown) => String(q).trim().toLowerCase();
    const prevMap = new Map<string, GscQueryRow>();
    for (const r of previous) prevMap.set(normalize(r.query), r);
    const currentMap = new Map<string, GscQueryRow>();
    for (const r of current) currentMap.set(normalize(r.query), r);

    const all: QueryMover[] = [...new Set([...currentMap.keys(), ...prevMap.keys()])].map((key) => {
      const cur = currentMap.get(key);
      const prev = prevMap.get(key);
      const currentClicks = cur?.clicks ?? 0;
      const currentImpressions = cur?.impressions ?? 0;
      const prevClicks = prev ? prev.clicks : 0;
      const prevImpr = prev ? prev.impressions : 0;
      const clicksDelta = currentClicks - prevClicks;
      const impressionsDelta = currentImpressions - prevImpr;
      const positionDelta = cur && prev ? parseNum(cur.position) - parseNum(prev.position) : 0;
      return {
        query: cur?.query ?? prev?.query ?? key,
        clicks: currentClicks,
        clicksDelta,
        impressionsDelta,
        positionDelta,
        direction: clicksDelta >= 0 ? "up" : "down",
      };
    });

    const risers = [...all]
      .filter((mover) => mover.clicksDelta > 0)
      .sort((a, b) => b.clicksDelta - a.clicksDelta)
      .slice(0, 8);
    const fallers = [...all]
      .filter((mover) => mover.clicksDelta < 0)
      .sort((a, b) => a.clicksDelta - b.clicksDelta)
      .slice(0, 8);
    movers = [...risers, ...fallers];
  }

  return {
    current: currentTotals,
    previous: previousTotals,
    currentFetchedAt,
    previousFetchedAt,
    movers,
  };
}
