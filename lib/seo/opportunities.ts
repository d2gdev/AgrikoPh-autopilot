import type {
  CtrOpportunity,
  GscQueryPageRow,
  GscQueryRow,
  OpportunityType,
} from "@/lib/seo/types";
import { parseNum, parsePercent } from "@/lib/seo/types";
import { normalizePagePath as normalizePath } from "@/lib/seo/page-health";

/**
 * Build a lookup of query → best (highest-impression) landing page from the
 * GSC query+page pairs. Returns null-safe map keyed by lowercased query.
 */
function buildBestPageByQuery(
  pairs: GscQueryPageRow[],
): Map<string, { page: string; clicks: number; impressions: number }> {
  const best = new Map<string, { page: string; clicks: number; impressions: number }>();
  for (const p of pairs) {
    if (!p || !p.query || !p.page) continue;
    const key = p.query.toLowerCase();
    const impressions = parseNum(p.impressions);
    const clicks = parseNum(p.clicks);
    const current = best.get(key);
    if (!current || impressions > current.impressions) {
      best.set(key, { page: p.page, clicks, impressions });
    }
  }
  return best;
}

/** Approximate organic CTR-by-position curve. */
export function benchmarkCtr(pos: number): number {
  if (pos <= 1) return 0.28;
  if (pos <= 2) return 0.15;
  if (pos <= 3) return 0.1;
  if (pos <= 4) return 0.07;
  if (pos <= 5) return 0.05;
  if (pos <= 6) return 0.04;
  if (pos <= 7) return 0.03;
  if (pos <= 8) return 0.025;
  if (pos <= 9) return 0.02;
  if (pos <= 10) return 0.018;
  if (pos <= 20) return 0.012;
  return 0.005;
}

/** Page-1 target rank used to model striking-distance upside. */
const TARGET_POSITION = 8;

// B2 — composite scoring constants.
//   score = potentialClicks × intentWeight × volumeBoost ÷ difficultyFactor
// All three factors default to 1.0 when the relevant data is absent, so with NO
// research/intent maps the score equals potentialClicks and the returned order
// is identical to the legacy ranking (monotonic in potentialClicks).
//
// INTENT_K: conversionRate 0.05 (a strong-converting page) → intentWeight ≈ 1.5.
const INTENT_K = 10;
// VOL_DIVISOR: log10-scaled so volume nudges rather than dominates. e.g.
//   1k searches → +~0.4, 100k → +~0.7 to the boost.
const VOL_DIVISOR = 7;
// DIFF_K: competitionIndex 100 (max difficulty) → difficultyFactor 2.0 (halves).
const DIFF_K = 1;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface KeywordResearchLookup {
  avgMonthlySearches: number | null;
  competitionIndex: number | null;
}

export function computeCtrOpportunities(
  queries: GscQueryRow[],
  pairs?: GscQueryPageRow[],
  research?: Map<string, KeywordResearchLookup>,
  pageConversion?: Map<string, number>,
): CtrOpportunity[] {
  const out: CtrOpportunity[] = [];
  const bestPageByQuery = pairs && pairs.length ? buildBestPageByQuery(pairs) : null;

  for (const row of queries) {
    const ctr = parsePercent(row.ctr);
    const pos = parseNum(row.position);
    const impr = row.impressions;
    const clicks = row.clicks;

    if (impr < 30) continue;
    // Missing/zero position would get the most generous benchmarkCtr(0);
    // skip so those rows don't float to the top on bad data.
    if (pos <= 0) continue;

    const bench = benchmarkCtr(pos);

    // Evaluate each signal independently; pick the highest-impact classification
    // by estimated potential rather than first-match-wins branch order.
    type Candidate = { type: OpportunityType; potential: number };
    const candidates: Candidate[] = [];

    if (impr >= 100 && clicks === 0) {
      candidates.push({
        type: "high_impression_no_click",
        potential: Math.max(0, Math.round((bench - ctr) * impr)),
      });
    }
    if (ctr < bench * 0.5) {
      candidates.push({
        type: "low_ctr",
        potential: Math.max(0, Math.round((bench - ctr) * impr)),
      });
    }
    if (pos > 3 && pos <= 20) {
      // Model the upside of reaching page 1, not just closing the gap at the
      // current poor rank.
      candidates.push({
        type: "striking_distance",
        potential: Math.max(0, Math.round((benchmarkCtr(TARGET_POSITION) - ctr) * impr)),
      });
    }

    const actionableCandidates = candidates.filter((candidate) => candidate.potential > 0);
    if (actionableCandidates.length === 0) continue;

    const best = actionableCandidates.reduce((a, b) => (b.potential > a.potential ? b : a));
    const type = best.type;
    const potentialClicks = best.potential;

    let reason: string;
    switch (type) {
      case "high_impression_no_click":
        reason = `${impr.toLocaleString()} impressions at #${pos.toFixed(1)} but zero clicks — rewrite title/meta`;
        break;
      case "low_ctr":
        reason = `Ranks #${pos.toFixed(1)} but CTR ${(ctr * 100).toFixed(1)}% vs ~${(bench * 100).toFixed(0)}% expected`;
        break;
      case "striking_distance":
        reason = `Ranks #${pos.toFixed(1)} — on-page push to page 1 could lift clicks`;
        break;
    }

    const match = bestPageByQuery ? bestPageByQuery.get(row.query.toLowerCase()) : null;
    const page = match ? match.page : null;

    // ── B2 composite scoring ──
    const queryKey = row.query.trim().toLowerCase();
    const res = research ? research.get(queryKey) : undefined;
    const volume = res && res.avgMonthlySearches != null ? res.avgMonthlySearches : null;
    const difficulty = res && res.competitionIndex != null ? res.competitionIndex : null;

    // conversionRate fraction for this query's landing page (intent signal).
    const convRate =
      page && pageConversion ? pageConversion.get(normalizePath(page)) : undefined;

    const intentWeight = clamp(1 + (convRate ?? 0) * INTENT_K, 1, 5);
    const volumeBoost =
      volume != null && volume > 0
        ? clamp(1 + Math.log10(1 + volume) / VOL_DIVISOR, 1, 3)
        : 1;
    const difficultyFactor =
      difficulty != null
        ? clamp(1 + (clamp(difficulty, 0, 100) / 100) * DIFF_K, 1, 3)
        : 1;

    const score = (potentialClicks * intentWeight * volumeBoost) / difficultyFactor;

    out.push({
      query: row.query,
      impressions: impr,
      clicks,
      ctr,
      position: pos,
      type,
      potentialClicks,
      reason,
      page,
      pageClicks: match ? match.clicks : null,
      pageImpressions: match ? match.impressions : null,
      score,
      volume,
      difficulty,
    });
  }

  out.sort(
    (a, b) =>
      b.score - a.score ||
      b.potentialClicks - a.potentialClicks ||
      b.impressions - a.impressions,
  );
  return out.slice(0, 25);
}
