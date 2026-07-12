import { describe, expect, it } from "vitest";
import { evaluateGovernedOperation } from "@/lib/topical-map/governed-operations";
import type { ActiveStrategyPolicy } from "@/lib/topical-map/evaluator";

const packageSha256 = "a".repeat(64);

function active(rules: unknown[] = [], overrides: Record<string, unknown> = {}): ActiveStrategyPolicy {
  return {
    packageIdentity: {
      strategyVersion: "2026-07-12",
      packageSha256,
      artifacts: ["map", "evidence", "url-inventory", "redirect-inventory", "internal-links", "compilation-contract"].map((id) => ({ id: id as any, sha256: id })),
    },
    compiledPackage: {
      strategyVersion: "2026-07-12",
      packageSha256,
      integrity: {} as any,
      coverage: [],
      rules: rules as any,
      byDomain: {} as any,
    },
    validationReport: { valid: true, issues: [], blockingIssueCount: 0, evidenceFreshness: [] },
    ...overrides,
  };
}

function rule(input: Record<string, unknown>) {
  return {
    ruleId: "rule-1", contractRuleId: "contract-rule-1", strategyVersion: "2026-07-12", packageSha256,
    conditions: [], evidenceRequirements: [], reviewRequirements: [], sourceReferences: [], ...input,
  };
}

describe("governed operation adapter", () => {
  it("allows only the exact normalized required link pair and preserves its rule evidence", () => {
    const policy = active([rule({ domain: "internal_links", payload: { fromUrl: "/blogs/news/source", toUrl: "/blogs/news/destination" } })]);

    const exact = evaluateGovernedOperation(policy, { type: "internal_link", fromUrl: "https://agrikoph.com/blogs/news/source/", toUrl: "/blogs/news/destination" });
    const differentSource = evaluateGovernedOperation(policy, { type: "internal_link", fromUrl: "/blogs/news/other", toUrl: "/blogs/news/destination" });

    expect(exact).toMatchObject({ compliance: { result: "compliant", executionAuthorized: false, matchedRules: [expect.objectContaining({ ruleId: "rule-1" })] }, proposalOnly: true });
    expect(differentSource.compliance).toMatchObject({ result: "conflict", reasonCodes: ["INTERNAL_LINK_RULE_NOT_FOUND"] });
  });

  it("blocks legacy redirect sources while retaining redirect rule evidence", () => {
    const policy = active([rule({ domain: "redirects", payload: { source: "/blogs/news/legacy", finalTarget: "/blogs/news/current" } })]);

    const result = evaluateGovernedOperation(policy, { type: "internal_link", fromUrl: "/blogs/news/source", toUrl: "/blogs/news/legacy" });

    expect(result.compliance).toMatchObject({ result: "blocked", reasonCodes: ["LEGACY_REDIRECT_SOURCE_TARGET"], matchedRules: [expect.objectContaining({ ruleId: "rule-1" })] });
  });

  it("keeps technical operations as evidence-only review work and honors persisted stale gates", () => {
    const policy = active([rule({ domain: "canonicalization", payload: { currentUrl: "/blogs/news/source", proposedCanonicalUrl: "/blogs/news/canonical" } })], {
      validationReport: { valid: false, issues: [], blockingIssueCount: 1, evidenceFreshness: [{ gateId: "gate-1", ruleId: "rule-1", mandatory: true, evidenceDate: "2025-01-01", maxAgeDays: 180, ageDays: 500, status: "stale", blockingReason: "STALE_MANDATORY_EVIDENCE" }] },
    });

    const result = evaluateGovernedOperation(policy, { type: "canonical", currentUrl: "/blogs/news/source", proposedCanonicalUrl: "/blogs/news/canonical" });

    expect(result).toMatchObject({ proposalOnly: true, executionAuthorized: false, compliance: { result: "needs_evidence", requiredApprovals: [], executionAuthorized: false } });
  });

  it("fails closed for a technical pair that is not declared by the active policy", () => {
    const policy = active([rule({ domain: "redirects", payload: { source: "/old", finalTarget: "/current" } })]);

    const result = evaluateGovernedOperation(policy, { type: "redirect", fromUrl: "/old", toUrl: "/other" });

    expect(result.compliance).toMatchObject({ result: "conflict", reasonCodes: ["TECHNICAL_OPERATION_RULE_NOT_FOUND"], requiredApprovals: ["operator_review"], executionAuthorized: false });
  });

  it("requires designated manual review for explicit health or safety classification without approving or executing", () => {
    const policy = active([rule({ domain: "high_stakes_reviews", payload: {} })]);

    const result = evaluateGovernedOperation(policy, { type: "seo_metadata", targetUrl: "/blogs/news/safety", highStakesTopics: ["safety", "health"] });

    expect(result).toMatchObject({ proposalOnly: true, executionAuthorized: false, highStakesReview: { required: true, approval: "manual_high_stakes_review" }, compliance: { result: "needs_high_stakes_review", requiredApprovals: ["manual_high_stakes_review"], executionAuthorized: false } });
  });

  it("fails closed with no execution path when active policy is unavailable", () => {
    const result = evaluateGovernedOperation(null, { type: "redirect", fromUrl: "/old", toUrl: "/new" });

    expect(result).toMatchObject({ proposalOnly: true, executionAuthorized: false, compliance: { result: "unavailable_strategy", packageIdentity: null } });
  });
});
