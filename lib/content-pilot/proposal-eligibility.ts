type ProposalForEligibility = {
  proposalType: string;
  title: string;
  sourceData?: unknown;
  proposedState: unknown;
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

export type ContentProposalEligibility =
  | { actionable: true }
  | { actionable: false; reason: "FIRST_PARTY_EVIDENCE_REQUIRED" | "MARKET_INTELLIGENCE_REVIEW_REQUIRED" | "INVALID_TARGET_KEYWORD" | "TOPICAL_MAP_TARGET_REQUIRED" | "TOPICAL_MAP_STRATEGY_STALE" };

export function contentProposalEligibility(
  proposal: ProposalForEligibility,
  options: { activePackageSha256?: string | null } = {},
): ContentProposalEligibility {
  if (proposal.proposalType !== "new-content") return { actionable: true };
  const sourceData = record(proposal.sourceData);
  const targetKeyword = record(proposal.proposedState).targetKeyword;
  const target = typeof targetKeyword === "string" ? targetKeyword.trim() : "";
  if (/\B-(?:filetype|site):/i.test(target)) return { actionable: false, reason: "INVALID_TARGET_KEYWORD" };
  if (typeof sourceData.insightId === "string" || typeof sourceData.marketInsightId === "string") return { actionable: false, reason: "MARKET_INTELLIGENCE_REVIEW_REQUIRED" };
  if (typeof sourceData.impressions === "number" && sourceData.impressions < 50) return { actionable: false, reason: "FIRST_PARTY_EVIDENCE_REQUIRED" };
  const strategyCompliance = record(sourceData.strategyCompliance);
  const complianceResult = strategyCompliance.result;
  const packageSha256 = strategyCompliance.packageSha256;
  if ((complianceResult !== "compliant" && complianceResult !== "needs_high_stakes_review")
    || typeof packageSha256 !== "string" || !/^[a-f0-9]{64}$/.test(packageSha256)) {
    return { actionable: false, reason: "TOPICAL_MAP_TARGET_REQUIRED" };
  }
  if (Object.prototype.hasOwnProperty.call(options, "activePackageSha256") && packageSha256 !== options.activePackageSha256) {
    return { actionable: false, reason: "TOPICAL_MAP_STRATEGY_STALE" };
  }
  return { actionable: true };
}
