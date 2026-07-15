/**
 * Pure, dependency-free price de-noising math for Market Intelligence price-gap
 * detection. No I/O, no prisma, no Date.now() — callers always pass `asOf`.
 *
 * This module is ADVISORY ONLY: it computes signal numbers, it never writes
 * or changes a price anywhere.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type PricePoint = { price: number; capturedAt: Date };

export function isMeaningfulPriceChange(previousPrice: number, currentPrice: number, minimumPct = 5): boolean {
  if (!Number.isFinite(previousPrice) || !Number.isFinite(currentPrice) || previousPrice <= 0 || currentPrice <= 0) {
    return false;
  }
  return (Math.abs(currentPrice - previousPrice) / previousPrice) * 100 >= minimumPct;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const lo = sorted[mid - 1] as number;
    const hi = sorted[mid] as number;
    return (lo + hi) / 2;
  }
  return sorted[mid] as number;
}

/**
 * De-noised median price over a trailing window ending at `asOf`.
 *
 * 1. Keep points with `0 <= (asOf - capturedAt) <= windowDays` (inclusive both ends).
 * 2. Compute the RAW median of that in-window set.
 * 3. Reject any point deviating more than `outlierPct`% from the raw median.
 * 4. Return the median of the survivors, or `null` if fewer than 2 survive
 *    (a single capture is exactly the noise we refuse to act on).
 */
export function smoothedMedian(
  series: PricePoint[],
  opts: { windowDays: number; outlierPct: number; asOf: Date },
): number | null {
  const { windowDays, outlierPct, asOf } = opts;
  const windowMs = windowDays * MS_PER_DAY;
  const asOfMs = asOf.getTime();

  const inWindow = series.filter((p) => {
    const diff = asOfMs - p.capturedAt.getTime();
    return diff >= 0 && diff <= windowMs;
  });

  if (inWindow.length === 0) return null;

  const rawMedian = median(inWindow.map((p) => p.price));

  const survivors = inWindow.filter((p) => {
    if (rawMedian === 0) return true; // avoid divide-by-zero; nothing meaningful to reject against
    const deviationPct = (Math.abs(p.price - rawMedian) / rawMedian) * 100;
    return deviationPct <= outlierPct;
  });

  if (survivors.length < 2) return null;

  return median(survivors.map((p) => p.price));
}

export type GapStabilityResult = {
  stable: boolean;
  smoothed: number | null;
  gapPctNow: number | null;
  daysStable: number;
};

/**
 * Determines whether a price gap vs `ownPrice` has been stably present across
 * the trailing `minDays` day-marks (asOf, asOf-1d, ..., asOf-(minDays-1)d),
 * each evaluated with its own `windowDays`-sized smoothedMedian lookback
 * ending on that day-mark.
 *
 * - A day-mark is "computable" when smoothedMedian returns non-null for it.
 * - `stable` requires EVERY computable day-mark to show a gap strictly
 *   greater than `gapPct`, AND at least `minDays - 2` day-marks computable
 *   (tolerates up to 2 missing capture days).
 * - `daysStable` counts the contiguous run of satisfied day-marks starting
 *   from the most recent (`asOf` itself) and walking backward; a missing
 *   (null) day-mark is skipped (tolerated) without breaking the run, but the
 *   first COMPUTABLE day-mark that fails the gap condition stops the count.
 * - `smoothed` / `gapPctNow` reflect the most recent (asOf itself) computation.
 */
export function gapIsStable(input: {
  ownPrice: number;
  series: PricePoint[];
  gapPct: number;
  minDays: number;
  windowDays: number;
  outlierPct: number;
  asOf: Date;
}): GapStabilityResult {
  const { ownPrice, series, gapPct, minDays, windowDays, outlierPct, asOf } = input;
  const asOfMs = asOf.getTime();

  let smoothedNow: number | null = null;
  let gapPctNow: number | null = null;
  let computable = 0;
  let allSatisfied = true;
  let daysStable = 0;
  let streakBroken = false;

  for (let i = 0; i < minDays; i++) {
    const dayMark = new Date(asOfMs - i * MS_PER_DAY);
    const smoothed = smoothedMedian(series, { windowDays, outlierPct, asOf: dayMark });

    if (i === 0) {
      smoothedNow = smoothed;
      gapPctNow = smoothed !== null ? ((ownPrice - smoothed) / ownPrice) * 100 : null;
    }

    if (smoothed === null) {
      // Missing capture day at this mark — tolerated, does not break the streak.
      continue;
    }

    computable++;
    const gapPctAtMark = ((ownPrice - smoothed) / ownPrice) * 100;
    const satisfied = gapPctAtMark > gapPct;

    if (!satisfied) {
      allSatisfied = false;
    }

    if (!streakBroken) {
      if (satisfied) {
        daysStable++;
      } else {
        streakBroken = true;
      }
    }
  }

  const stable = allSatisfied && computable >= minDays - 2;

  return { stable, smoothed: smoothedNow, gapPctNow, daysStable };
}
