export type OrganicOpportunityType =
  | "ctr_gap"
  | "content_gap"
  | "metadata_fix"
  | "internal_link"
  | "schema_fix"
  | "keyword_gap"
  | "refresh"
  | "new_content";

export type OrganicOpportunityInput = {
  type: OrganicOpportunityType;
  impressions?: number | null;
  clicks?: number | null;
  position?: number | null;
  expectedCtr?: number | null;
  searchVolume?: number | null;
  ga4Sessions?: number | null;
  ga4Conversions?: number | null;
  revenueSignal?: number | null;
  businessRelevance?: "high" | "medium" | "low" | null;
  confidence?: number | null;
  effort?: "low" | "medium" | "high" | null;
  sourceFreshnessHours?: number | null;
};

export type OrganicPriority = {
  score: number;
  priority: "P0" | "P1" | "P2" | "P3";
  impact: "High" | "Medium" | "Low";
  effort: "Low" | "Medium" | "High";
  components: Record<string, number>;
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function logScore(value: number | null | undefined, divisor: number): number {
  const n = Math.max(0, Number(value ?? 0));
  return clamp(Math.log10(n + 1) * divisor);
}

function positionScore(position: number | null | undefined): number {
  if (!position || !Number.isFinite(position)) return 0;
  if (position >= 5 && position <= 20) return 18;
  if (position > 20 && position <= 40) return 10;
  if (position > 0 && position < 5) return 6;
  return 0;
}

function ctrUpside(input: OrganicOpportunityInput): number {
  const impressions = Number(input.impressions ?? 0);
  if (!impressions || !input.expectedCtr) return 0;
  const actualCtr = Number(input.clicks ?? 0) / Math.max(impressions, 1);
  return clamp((input.expectedCtr - actualCtr) * 500, 0, 20);
}

function relevanceScore(value: OrganicOpportunityInput["businessRelevance"]): number {
  if (value === "high") return 12;
  if (value === "medium") return 7;
  if (value === "low") return 2;
  return 5;
}

function effortPenalty(value: OrganicOpportunityInput["effort"]): number {
  if (value === "high") return 14;
  if (value === "medium") return 7;
  return 0;
}

function freshnessPenalty(hours: number | null | undefined): number {
  if (hours == null) return 4;
  if (hours <= 96) return 0;
  if (hours <= 168) return 4;
  return 10;
}

function confidenceScore(confidence: number | null | undefined): number {
  const c = confidence == null ? 0.6 : clamp(confidence, 0, 1);
  return c * 12;
}

function classify(score: number): OrganicPriority["priority"] {
  if (score >= 80) return "P0";
  if (score >= 60) return "P1";
  if (score >= 35) return "P2";
  return "P3";
}

function impact(score: number): OrganicPriority["impact"] {
  if (score >= 60) return "High";
  if (score >= 35) return "Medium";
  return "Low";
}

function effortLabel(value: OrganicOpportunityInput["effort"]): OrganicPriority["effort"] {
  if (value === "high") return "High";
  if (value === "medium") return "Medium";
  return "Low";
}

export function scoreOrganicOpportunity(input: OrganicOpportunityInput): OrganicPriority {
  const demand = Math.max(
    logScore(input.impressions, 12),
    logScore(input.searchVolume, 10),
    logScore(input.ga4Sessions, 8),
  );
  const ranking = positionScore(input.position);
  const ctr = input.type === "ctr_gap" ? ctrUpside(input) : 0;
  const revenue = clamp(
    Number(input.ga4Conversions ?? 0) * 5 +
      Math.log10(Math.max(0, Number(input.revenueSignal ?? 0)) + 1) * 6,
    0,
    15,
  );
  const relevance = relevanceScore(input.businessRelevance);
  const confidence = confidenceScore(input.confidence);
  const typeBoost =
    input.type === "metadata_fix" || input.type === "internal_link"
      ? 6
      : input.type === "content_gap" || input.type === "keyword_gap"
        ? 8
        : 4;
  const effort = effortPenalty(input.effort);
  const freshness = freshnessPenalty(input.sourceFreshnessHours);

  const raw = demand + ranking + ctr + revenue + relevance + confidence + typeBoost - effort - freshness;
  const score = Math.round(clamp(raw));

  return {
    score,
    priority: classify(score),
    impact: impact(score),
    effort: effortLabel(input.effort),
    components: {
      demand: Math.round(demand * 100) / 100,
      ranking,
      ctr,
      revenue: Math.round(revenue * 100) / 100,
      relevance,
      confidence: Math.round(confidence * 100) / 100,
      typeBoost,
      effort: -effort,
      freshness: -freshness,
    },
  };
}
