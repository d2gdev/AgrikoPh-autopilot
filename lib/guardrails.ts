import { prisma } from "@/lib/db";

type Thresholds = {
  hardBlockBidChangePct: number;
  hardBlockBudgetChangePct: number;
  hardBlockMinConversions: number;
  hardBlockPauseDailyBudget: number;
  softFlagChangePct: number;
  softFlagPauseDailyBudget: number;
  softFlagMinConfidence: number;
};

let _thresholdsCache: Thresholds | null = null;
let _thresholdsCachedAt = 0;
let _inflightFetch: Promise<Thresholds> | null = null;
const THRESHOLD_TTL_MS = 5 * 60 * 1000;

export interface RecommendationInput {
  actionType: string;
  targetEntityType: string;
  targetEntityId: string;
  targetEntityName: string;
  currentValue?: string | null;
  proposedValue?: string | null;
  changePercent?: number | null;
  confidenceScore?: number | null;
  conversionCount?: number | null;
  dailyBudgetPhp?: number | null;
}

export type GuardResult =
  | { status: "clear" }
  | { status: "soft_flag"; reason: string }
  | { status: "hard_block"; reason: string };

// Conversion data is required for budget/bid changes and campaign pauses — not for pausing individual ads
// (0-conversion ads are precisely the ones that should be paused; the risk of false-negative tracking
// is low at the ad level since the campaign and other ads in the snapshot still show conversions)
const CONVERSION_SENSITIVE_ACTIONS = new Set(["pause_campaign", "adjust_budget", "change_bid"]);

async function getThresholds(): Promise<Thresholds> {
  const now = Date.now();
  if (_thresholdsCache && now - _thresholdsCachedAt < THRESHOLD_TTL_MS) return _thresholdsCache;
  // Concurrency guard: if a fetch is already in-flight, await it instead of
  // launching a second DB call (prevents partial-write races on the cache).
  if (_inflightFetch) return _inflightFetch;
  _inflightFetch = (async () => {
    const configs = await prisma.guardrailConfig.findMany();
    const map = Object.fromEntries(configs.map((c) => [c.key, Number(c.value)]));
    _thresholdsCache = {
      hardBlockBidChangePct: map["HARD_BLOCK_BID_CHANGE_PCT"] ?? 50,
      hardBlockBudgetChangePct: map["HARD_BLOCK_BUDGET_CHANGE_PCT"] ?? 200,
      hardBlockMinConversions: map["HARD_BLOCK_MIN_CONVERSIONS"] ?? 10,
      hardBlockPauseDailyBudget: map["HARD_BLOCK_PAUSE_DAILY_BUDGET"] ?? 10000,
      softFlagChangePct: map["SOFT_FLAG_CHANGE_PCT"] ?? 30,
      softFlagPauseDailyBudget: map["SOFT_FLAG_PAUSE_DAILY_BUDGET"] ?? 200,
      softFlagMinConfidence: map["SOFT_FLAG_MIN_CONFIDENCE"] ?? 0.5,
    };
    _thresholdsCachedAt = Date.now();
    return _thresholdsCache;
  })().finally(() => { _inflightFetch = null; });
  return _inflightFetch;
}

export async function checkGuardrails(
  rec: RecommendationInput
): Promise<GuardResult> {
  const t = await getThresholds();
  const pct = Math.abs(rec.changePercent ?? 0);

  // Hard blocks
  if (
    (rec.actionType === "change_bid") &&
    pct > t.hardBlockBidChangePct
  ) {
    return {
      status: "hard_block",
      reason: `Bid change of ${pct.toFixed(1)}% exceeds hard limit of ${t.hardBlockBidChangePct}%`,
    };
  }

  if (
    (rec.actionType === "adjust_budget" || rec.actionType === "increase_budget" || rec.actionType === "decrease_budget") &&
    pct > t.hardBlockBudgetChangePct
  ) {
    return {
      status: "hard_block",
      reason: `Budget change of ${pct.toFixed(1)}% exceeds hard limit of ${t.hardBlockBudgetChangePct}%`,
    };
  }

  if (
    CONVERSION_SENSITIVE_ACTIONS.has(rec.actionType) &&
    (rec.conversionCount == null || rec.conversionCount < t.hardBlockMinConversions)
  ) {
    return {
      status: "hard_block",
      reason: `Only ${rec.conversionCount ?? 0} conversions in window — need at least ${t.hardBlockMinConversions} for confidence`,
    };
  }

  // dailyBudgetPhp defaults to 0 when omitted — unknown budget does not trigger pause blocks
  if (
    rec.actionType === "pause_campaign" &&
    (rec.dailyBudgetPhp ?? 0) > t.hardBlockPauseDailyBudget
  ) {
    return {
      status: "hard_block",
      reason: `Campaign spends ₱${rec.dailyBudgetPhp?.toLocaleString()}/day — pausing requires senior override (limit: ₱${t.hardBlockPauseDailyBudget.toLocaleString()})`,
    };
  }

  // Soft flags — changePercent check only applies to budget/bid actions
  const BUDGET_BID_ACTIONS = ["adjust_budget", "change_bid", "increase_budget", "decrease_budget"];
  if (BUDGET_BID_ACTIONS.includes(rec.actionType) && pct > t.softFlagChangePct) {
    return {
      status: "soft_flag",
      reason: `Change of ${pct.toFixed(1)}% exceeds soft threshold of ${t.softFlagChangePct}%`,
    };
  }

  if (
    rec.actionType === "pause_campaign" &&
    (rec.dailyBudgetPhp ?? 0) > t.softFlagPauseDailyBudget
  ) {
    return {
      status: "soft_flag",
      reason: `Campaign spends ₱${rec.dailyBudgetPhp?.toLocaleString()}/day — review carefully before pausing`,
    };
  }

  if ((rec.confidenceScore ?? 1) < t.softFlagMinConfidence) {
    return {
      status: "soft_flag",
      reason: `Low confidence score: ${((rec.confidenceScore ?? 0) * 100).toFixed(0)}% (minimum: ${(t.softFlagMinConfidence * 100).toFixed(0)}%)`,
    };
  }

  return { status: "clear" };
}
