import type { CompiledRule, CompiledStrategyPackage } from "./compiler";
import { normalizeProposalContext, type StrategyProposalCandidate } from "./proposal-context";
import type { StrategyArtifactId } from "./types";
import type { EvidenceFreshnessEntry, ValidationReport } from "./validator";
import { topicalMapActionEligibility, topicalMapInternalLinkRequiresAddition, type TopicalMapRulePolicy } from "./action-eligibility";

export type StrategyComplianceStatus = "compliant" | "conflict" | "blocked" | "needs_evidence" | "needs_high_stakes_review" | "unavailable_strategy";
export type StrategyComplianceReasonCode =
  | "ACTIVE_STRATEGY_UNAVAILABLE"
  | "EXCLUSIVE_INTENT_OWNER_CONFLICT"
  | "EXPLICIT_DO_NOT_CREATE"
  | "LEGACY_REDIRECT_SOURCE_TARGET"
  | "UNSATISFIED_SOURCE_CONDITION"
  | "STALE_MANDATORY_EVIDENCE"
  | "MISSING_EVIDENCE_GATE"
  | "HIGH_STAKES_MEDICAL_DOSAGE_REVIEW"
  | "MANUAL_GATE_REQUIRED"
  | "ACTIVATION_BLOCKING_RULE"
  | "NON_ADDITIVE_INTERNAL_LINK_INSTRUCTION"
  | "INTERNAL_LINK_RULE_NOT_FOUND"
  | "TECHNICAL_OPERATION_RULE_NOT_FOUND";

export interface StrategyPackageIdentity {
  strategyVersion: string;
  packageSha256: string;
  artifacts: Array<{ id: StrategyArtifactId; sha256: string }>;
}

export interface ActiveStrategyPolicy {
  packageIdentity: StrategyPackageIdentity;
  compiledPackage: CompiledStrategyPackage;
  validationReport?: ValidationReport;
}

export interface MatchedStrategyRule {
  ruleId: string;
  contractRuleId: string;
  sourceReferences: CompiledRule["sourceReferences"];
}

export interface StrategyComplianceResult {
  result: StrategyComplianceStatus;
  reasonCodes: StrategyComplianceReasonCode[];
  packageIdentity: StrategyPackageIdentity | null;
  matchedRules: MatchedStrategyRule[];
  evidenceFreshness: EvidenceFreshnessEntry[];
  requiredApprovals: string[];
  executionAuthorized: false;
}

function payload(rule: CompiledRule): Record<string, unknown> {
  return rule.payload as Record<string, unknown>;
}

function matched(rule: CompiledRule): MatchedStrategyRule {
  return { ruleId: rule.ruleId, contractRuleId: rule.contractRuleId, sourceReferences: structuredClone(rule.sourceReferences) };
}

function rules(items: CompiledRule[]): MatchedStrategyRule[] {
  return items.map(matched);
}

function policy(rule: CompiledRule): TopicalMapRulePolicy {
  return { resolutionStatus: rule.resolutionStatus, conditions: rule.conditions, evidenceRequirements: rule.evidenceRequirements, reviewRequirements: rule.reviewRequirements };
}

function ruleEligibility(active: ActiveStrategyPolicy, matchedRules: CompiledRule[], evidence: ReadonlyMap<string, "satisfied" | "unsatisfied"> = new Map()): StrategyComplianceResult | null {
  const manual = matchedRules.filter((rule) => topicalMapActionEligibility(policy(rule), evidence).reason === "manual_gate");
  if (manual.length) return result(active, "blocked", ["MANUAL_GATE_REQUIRED"], rules(manual), ["manual_gate"]);
  const activationBlocking = matchedRules.filter((rule) => topicalMapActionEligibility(policy(rule), evidence).reason === "activation_blocking");
  if (activationBlocking.length) return result(active, "blocked", ["ACTIVATION_BLOCKING_RULE"], rules(activationBlocking));
  const conditional = matchedRules.filter((rule) => topicalMapActionEligibility(policy(rule), evidence).reason === "conditions_unsatisfied");
  return conditional.length ? result(active, "needs_evidence", ["UNSATISFIED_SOURCE_CONDITION"], rules(conditional)) : null;
}

function sameGovernedUrl(left: string, right: string): boolean {
  const canonical = (value: string) => {
    const url = new URL(value, "https://agrikoph.com");
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "/";
    return `${path}${url.search}${url.hash}`;
  };
  return canonical(left) === canonical(right);
}

function identityIsComplete(active: ActiveStrategyPolicy): boolean {
  const artifactIds = active.packageIdentity.artifacts.map((artifact) => artifact.id);
  return artifactIds.length === 6
    && new Set(artifactIds).size === 6
    && active.packageIdentity.packageSha256 === active.compiledPackage.packageSha256
    && active.packageIdentity.strategyVersion === active.compiledPackage.strategyVersion;
}

function result(active: ActiveStrategyPolicy | null, status: StrategyComplianceStatus, reasonCodes: StrategyComplianceReasonCode[], matchedRules: MatchedStrategyRule[] = [], requiredApprovals: string[] = []): StrategyComplianceResult {
  return {
    result: status,
    reasonCodes,
    packageIdentity: active ? structuredClone(active.packageIdentity) : null,
    matchedRules,
    evidenceFreshness: structuredClone(active?.validationReport?.evidenceFreshness ?? []),
    requiredApprovals: [...new Set(requiredApprovals)].sort(),
    executionAuthorized: false,
  };
}

function evidenceBlock(active: ActiveStrategyPolicy): StrategyComplianceResult | null {
  const stale = active.validationReport?.evidenceFreshness.filter((entry) => entry.status !== "current") ?? [];
  if (stale.length === 0) return null;
  const codes = [...new Set(stale.map((entry) => entry.blockingReason).filter((code): code is "STALE_MANDATORY_EVIDENCE" | "MISSING_EVIDENCE_GATE" => code !== null))].sort() as StrategyComplianceReasonCode[];
  const rulesById = new Map(active.compiledPackage.rules.map((rule) => [rule.ruleId, rule]));
  return result(active, "needs_evidence", codes, stale.flatMap((entry) => {
    const item = rulesById.get(entry.ruleId);
    return item ? [matched(item)] : [];
  }));
}

export function evaluateStrategyPolicy(active: ActiveStrategyPolicy | null, candidate: StrategyProposalCandidate): StrategyComplianceResult {
  if (!active || !identityIsComplete(active)) return result(null, "unavailable_strategy", ["ACTIVE_STRATEGY_UNAVAILABLE"]);
  const normalized = normalizeProposalContext(candidate);
  const freshness = evidenceBlock(active);
  if (freshness) return freshness;
  const policy = active.compiledPackage.rules;

  if (normalized.type === "internal_link") {
    const legacyRedirects = policy.filter((rule) => rule.domain === "redirects" && typeof payload(rule).source === "string" && sameGovernedUrl(payload(rule).source as string, normalized.toUrl));
    if (legacyRedirects.length > 0) return result(active, "blocked", ["LEGACY_REDIRECT_SOURCE_TARGET"], rules(legacyRedirects));
    const exactLinks = policy.filter((rule) => rule.domain === "internal_links"
      && typeof payload(rule).fromUrl === "string" && typeof payload(rule).toUrl === "string"
      && sameGovernedUrl(payload(rule).fromUrl as string, normalized.fromUrl)
      && sameGovernedUrl(payload(rule).toUrl as string, normalized.toUrl));
    const eligibility = ruleEligibility(active, exactLinks);
    if (eligibility) return eligibility;
    if (exactLinks.length > 0 && exactLinks.some((rule) => !topicalMapInternalLinkRequiresAddition(String(payload(rule).requiredAction ?? "")))) {
      return result(active, "conflict", ["NON_ADDITIVE_INTERNAL_LINK_INSTRUCTION"], rules(exactLinks));
    }
    return exactLinks.length > 0
      ? result(active, "compliant", [], rules(exactLinks))
      : result(active, "conflict", ["INTERNAL_LINK_RULE_NOT_FOUND"]);
  }

  const highStakesTopics = "highStakesTopics" in normalized ? normalized.highStakesTopics : [];
  if (highStakesTopics.some((topic) => topic === "medical" || topic === "dosage" || topic === "safety" || topic === "health")) {
    return result(active, "needs_high_stakes_review", ["HIGH_STAKES_MEDICAL_DOSAGE_REVIEW"], rules(policy.filter((rule) => rule.domain === "high_stakes_reviews")), ["manual_high_stakes_review"]);
  }

  if (normalized.type === "content") {
    const exactDecisions = policy.filter((rule) => rule.domain === "content_decisions" && payload(rule).currentUrl === normalized.targetUrl);
    const conditionEvidence = new Map(normalized.sourceConditionEvidence.map((entry) => [entry.coverageUnitId, entry.state] as const));
    const eligibility = ruleEligibility(active, exactDecisions, conditionEvidence);
    if (eligibility) return eligibility;
    const owners = policy.filter((rule) => rule.domain === "url_intent_ownership"
      && payload(rule).exclusiveIntentScope === normalized.exclusiveIntentScope
      && payload(rule).currentUrl !== normalized.targetUrl);
    if (normalized.exclusiveIntentScope && owners.length > 0) return result(active, "conflict", ["EXCLUSIVE_INTENT_OWNER_CONFLICT"], rules(owners));
    if (exactDecisions.some((rule) => rule.conditions.length > 0)) return result(active, "compliant", [], rules(exactDecisions.filter((rule) => rule.conditions.length > 0)));
    const prohibited = policy.filter((rule) => rule.domain === "prohibited_content" && payload(rule).currentUrl === normalized.targetUrl);
    if (normalized.action === "create" && prohibited.length > 0) return result(active, "blocked", ["EXPLICIT_DO_NOT_CREATE"], rules(prohibited));
    return result(active, "compliant", []);
  }

  const technical = normalized.type === "canonical" || normalized.type === "indexation";
  if (technical) {
    const domain = normalized.type === "canonical" ? "canonicalization" : "indexation";
    const matching = policy.filter((rule) => rule.domain === domain
      && typeof payload(rule).currentUrl === "string" && typeof payload(rule).proposedCanonicalUrl === "string"
      && sameGovernedUrl(payload(rule).currentUrl as string, normalized.currentUrl)
      && sameGovernedUrl(payload(rule).proposedCanonicalUrl as string, normalized.proposedCanonicalUrl));
    const eligibility = ruleEligibility(active, matching);
    if (eligibility) return eligibility;
    return matching.length > 0
      ? result(active, "compliant", [], rules(matching), ["operator_review"])
      : result(active, "conflict", ["TECHNICAL_OPERATION_RULE_NOT_FOUND"], [], ["operator_review"]);
  }

  if (normalized.type === "redirect") {
    const matching = policy.filter((rule) => rule.domain === "redirects"
      && typeof payload(rule).source === "string" && typeof payload(rule).finalTarget === "string"
      && sameGovernedUrl(payload(rule).source as string, normalized.fromUrl)
      && sameGovernedUrl(payload(rule).finalTarget as string, normalized.toUrl));
    const eligibility = ruleEligibility(active, matching);
    if (eligibility) return eligibility;
    return matching.length > 0
      ? result(active, "compliant", [], rules(matching), ["operator_review"])
      : result(active, "conflict", ["TECHNICAL_OPERATION_RULE_NOT_FOUND"], [], ["operator_review"]);
  }

  return result(active, "compliant", []);
}
