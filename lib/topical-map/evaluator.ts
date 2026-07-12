import type { CompiledRule, CompiledStrategyPackage } from "./compiler";
import { normalizeProposalContext, type StrategyProposalCandidate } from "./proposal-context";
import type { StrategyArtifactId } from "./types";
import type { EvidenceFreshnessEntry, ValidationReport } from "./validator";

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
  | "INTERNAL_LINK_RULE_NOT_FOUND";

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
    const legacyRedirects = policy.filter((rule) => rule.domain === "redirects" && payload(rule).source === normalized.toUrl);
    if (legacyRedirects.length > 0) return result(active, "blocked", ["LEGACY_REDIRECT_SOURCE_TARGET"], rules(legacyRedirects));
    const exactLinks = policy.filter((rule) => rule.domain === "internal_links" && payload(rule).fromUrl === normalized.fromUrl && payload(rule).toUrl === normalized.toUrl);
    return exactLinks.length > 0
      ? result(active, "compliant", [], rules(exactLinks))
      : result(active, "conflict", ["INTERNAL_LINK_RULE_NOT_FOUND"]);
  }

  const highStakesTopics = "highStakesTopics" in normalized ? normalized.highStakesTopics : [];
  if (highStakesTopics.includes("medical") || highStakesTopics.includes("dosage")) {
    return result(active, "needs_high_stakes_review", ["HIGH_STAKES_MEDICAL_DOSAGE_REVIEW"], rules(policy.filter((rule) => rule.domain === "high_stakes_reviews")), ["manual_high_stakes_review"]);
  }

  if (normalized.type === "content") {
    const owners = policy.filter((rule) => rule.domain === "url_intent_ownership"
      && payload(rule).exclusiveIntentScope === normalized.exclusiveIntentScope
      && payload(rule).currentUrl !== normalized.targetUrl);
    if (normalized.exclusiveIntentScope && owners.length > 0) return result(active, "conflict", ["EXCLUSIVE_INTENT_OWNER_CONFLICT"], rules(owners));
    const conditional = policy.filter((rule) => rule.domain === "content_decisions" && payload(rule).currentUrl === normalized.targetUrl && rule.conditions.length > 0);
    if (normalized.sourceConditionEvidence.length > 0) {
      const unmet = conditional.filter((rule) => rule.conditions.some((condition) => condition.sourceReferenceIds.some((coverageUnitId) => normalized.sourceConditionEvidence.find((entry) => entry.coverageUnitId === coverageUnitId)?.state !== "satisfied")));
      if (unmet.length > 0) return result(active, "needs_evidence", ["UNSATISFIED_SOURCE_CONDITION"], rules(unmet));
      if (conditional.length > 0) return result(active, "compliant", [], rules(conditional));
    }
    const prohibited = policy.filter((rule) => rule.domain === "prohibited_content" && payload(rule).currentUrl === normalized.targetUrl);
    if (normalized.action === "create" && prohibited.length > 0) return result(active, "blocked", ["EXPLICIT_DO_NOT_CREATE"], rules(prohibited));
    return result(active, "compliant", []);
  }

  const technical = normalized.type === "canonical" || normalized.type === "indexation";
  if (technical) {
    const domain = normalized.type === "canonical" ? "canonicalization" : "indexation";
    const matching = policy.filter((rule) => rule.domain === domain && payload(rule).currentUrl === normalized.currentUrl && payload(rule).proposedCanonicalUrl === normalized.proposedCanonicalUrl);
    return result(active, "compliant", [], rules(matching), ["operator_review"]);
  }

  if (normalized.type === "redirect") {
    const matching = policy.filter((rule) => rule.domain === "redirects" && payload(rule).source === normalized.fromUrl && payload(rule).finalTarget === normalized.toUrl);
    return result(active, "compliant", [], rules(matching), ["operator_review"]);
  }

  return result(active, "compliant", []);
}
