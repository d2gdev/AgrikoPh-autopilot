export type OpportunityPriority = "P0" | "P1" | "P2" | "P3";

export function classifyOpportunityPriority(score: number): OpportunityPriority {
  if (score >= 80) return "P0";
  if (score >= 60) return "P1";
  if (score >= 35) return "P2";
  return "P3";
}

export function normalizeOpportunityScore(value: unknown): number {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}
