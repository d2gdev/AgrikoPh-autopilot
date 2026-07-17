export type TopicalMapResolutionStatus = "resolved" | "manual_gate" | "activation_blocking";

export type TopicalMapRuleRequirement = {
  kind: "literal_source_condition" | "source_required_evidence" | "source_required_manual_review";
  text: string;
  sourceReferenceIds: string[];
  mandatory?: true;
  evidenceClass?: "general_seo_market" | "high_stakes";
  maxAgeDays?: 180 | 90;
};

export type TopicalMapRulePolicy = {
  resolutionStatus: TopicalMapResolutionStatus;
  conditions: TopicalMapRuleRequirement[];
  evidenceRequirements: TopicalMapRuleRequirement[];
  reviewRequirements: TopicalMapRuleRequirement[];
};

export type TopicalMapPhaseGateSummary = {
  governedAdvisoryAction: string;
  reviewRequired: true;
  executionProhibited: true;
  blocksOnlyGovernedAction: true;
};

export type TopicalMapScheduleAuthorityBoundary = {
  operationMode: "proposal_only";
  executionProhibited: true;
  elapsedTimeAuthorizesAction: false;
  satisfactionCanTriggerMutation: false;
  independentSafeguardsRequired: true;
  absentEvidenceNonExecutable: true;
};

export type TopicalMapActionEligibility =
  | { actionable: true; reason: "resolved" }
  | { actionable: false; reason: "manual_gate" | "activation_blocking" | "conditions_unsatisfied" };

export function topicalMapActionEligibility(
  policy: TopicalMapRulePolicy,
  conditionEvidence: ReadonlyMap<string, "satisfied" | "unsatisfied"> = new Map(),
): TopicalMapActionEligibility {
  if (policy.resolutionStatus === "manual_gate") return { actionable: false, reason: "manual_gate" };
  if (policy.resolutionStatus === "activation_blocking") return { actionable: false, reason: "activation_blocking" };
  const conditionsSatisfied = policy.conditions.every((condition) =>
    condition.sourceReferenceIds.every((referenceId) => conditionEvidence.get(referenceId) === "satisfied"),
  );
  return conditionsSatisfied ? { actionable: true, reason: "resolved" } : { actionable: false, reason: "conditions_unsatisfied" };
}

export function topicalMapInternalLinkEligibility(
  policy: TopicalMapRulePolicy,
  currentBodyState?: string,
  requiredAction?: string,
): TopicalMapActionEligibility {
  const eligibility = topicalMapActionEligibility(policy);
  if (!eligibility.actionable) return eligibility;
  const instruction = `${currentBodyState ?? ""} ${requiredAction ?? ""}`;
  if (/\bconditional\b|\bonly if\b|\bunless\b|\bif\b.*\b(created|exists?|passes?|satisfied|executed)\b/i.test(instruction)) {
    return { actionable: false, reason: "conditions_unsatisfied" };
  }
  return eligibility;
}

export function topicalMapInternalLinkRequiresAddition(requiredAction?: string): boolean {
  return /\b(add|ensure)\b/i.test(requiredAction ?? "");
}

export function topicalMapRedirectRequiresUpdate(requiredAction?: string): boolean {
  return /\breplace with one-hop target\b/i.test(requiredAction ?? "");
}

export function topicalMapRedirectRequiresDelete(requiredAction?: string): boolean {
  const instruction = requiredAction ?? "";
  return /\bretain live page as (?:the )?owner\b/i.test(instruction)
    && /\bremove redirect record\b/i.test(instruction)
    && !/\b(unless|provisional|conditional|only if)\b/i.test(instruction);
}

export function topicalMapRedirectRequiresLegacyLinkCleanup(requiredAction?: string): boolean {
  return /\bretain unless source is still internally linked\b/i.test(requiredAction ?? "");
}

export function topicalMapInternalLinkRequiresReplacement(requiredAction?: string): boolean {
  return /\breplace\b.*\b(?:legacy )?target\b/i.test(requiredAction ?? "");
}
