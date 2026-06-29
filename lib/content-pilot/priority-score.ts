export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingRisk = "critical" | "high" | "medium" | "low";
export type ChangeType = "metadata" | "internal_link" | "content" | "new_article";

export interface ContentFinding {
  type:
    | "gsc-quick-win"
    | "missing-meta"
    | "orphan-link"
    | "thin-content"
    | "stale-content"
    | "new-content-gap";
  articleHandle?: string;
  articleTitle?: string;
  trafficScore: number;
  businessValue: number;
  severity: FindingSeverity;
  confidence: number;
  risk: FindingRisk;
  evidence: Record<string, unknown>;
  proposedState: Record<string, unknown>;
  title: string;
  description: string;
  changeType: ChangeType;
}

const SEVERITY_POINTS: Record<FindingSeverity, number> = {
  critical: 20,
  high: 15,
  medium: 8,
  low: 3,
};

const RISK_PENALTY: Record<FindingRisk, number> = {
  critical: 6,
  high: 4,
  medium: 2,
  low: 0,
};

export function scoreFinding(f: ContentFinding): number {
  return (
    f.trafficScore +
    f.businessValue +
    SEVERITY_POINTS[f.severity] +
    Math.round(f.confidence * 10) -
    RISK_PENALTY[f.risk]
  );
}

export function classifyPriority(score: number): "P1" | "P2" | "P3" {
  if (score >= 75) return "P1";
  if (score >= 50) return "P2";
  return "P3";
}

export function findingToImpact(score: number): "High" | "Medium" | "Low" {
  const priority = classifyPriority(score);
  if (priority === "P1") return "High";
  if (priority === "P2") return "Medium";
  return "Low";
}

export function changeTypeToEffort(changeType: ChangeType): "High" | "Medium" | "Low" {
  if (changeType === "new_article") return "High";
  if (changeType === "content") return "Medium";
  return "Low";
}
