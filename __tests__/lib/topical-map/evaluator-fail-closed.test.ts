import { describe, expect, it } from "vitest";
import type { CompiledRule, CompiledStrategyPackage } from "@/lib/topical-map/compiler";
import {
  evaluateStrategyPolicy,
  type ActiveStrategyPolicy,
} from "@/lib/topical-map/evaluator";

function rule(
  ruleId: string,
  decision: string,
  options: Partial<CompiledRule> = {},
): CompiledRule {
  return {
    ruleId,
    contractRuleId: ruleId,
    domain: "content_decisions",
    resolutionStatus: "resolved",
    conditions: [],
    evidenceRequirements: [],
    reviewRequirements: [],
    payload: {
      currentUrl: "/blogs/news/mapped",
      decision,
    },
    sourceReferences: [],
    ...options,
  } as CompiledRule;
}

function active(rules: CompiledRule[]): ActiveStrategyPolicy {
  const compiledPackage = {
    strategyVersion: "strategy-1",
    packageSha256: "a".repeat(64),
    rules,
    byDomain: {},
  } as unknown as CompiledStrategyPackage;
  return {
    packageIdentity: {
      strategyVersion: "strategy-1",
      packageSha256: "a".repeat(64),
      artifacts: [
        "map",
        "evidence",
        "url-inventory",
        "redirect-inventory",
        "internal-links",
        "compilation-contract",
      ].map((id) => ({ id, sha256: "b".repeat(64) })) as ActiveStrategyPolicy["packageIdentity"]["artifacts"],
    },
    compiledPackage,
  };
}

describe("topical-map evaluator fail-closed content matching", () => {
  it.each([
    { type: "content", action: "create", targetUrl: "/blogs/news/unmapped" },
    { type: "content", action: "update", targetUrl: "/blogs/news/unmapped" },
    { type: "seo_metadata", targetUrl: "/blogs/news/unmapped" },
  ] as const)("rejects unmapped $type work", (candidate) => {
    expect(evaluateStrategyPolicy(active([]), candidate)).toMatchObject({
      result: "conflict",
      reasonCodes: ["CONTENT_RULE_NOT_FOUND"],
    });
  });

  it("rejects create, refresh, and metadata actions that do not match the exact decision", () => {
    const policy = active([rule("keep", "keep existing page")]);

    for (const candidate of [
      { type: "content", action: "create", targetUrl: "/blogs/news/mapped" },
      { type: "content", action: "update", targetUrl: "/blogs/news/mapped" },
      { type: "seo_metadata", targetUrl: "/blogs/news/mapped" },
    ] as const) {
      expect(evaluateStrategyPolicy(policy, candidate)).toMatchObject({
        result: "conflict",
        reasonCodes: ["CONTENT_ACTION_NOT_PERMITTED"],
        matchedRules: [expect.objectContaining({ ruleId: "keep" })],
      });
    }
  });

  it("does not authorize a conditional rule even when caller evidence says satisfied", () => {
    const policy = active([rule("conditional", "create after threshold", {
      conditions: [{
        kind: "literal_source_condition",
        text: "after threshold",
        sourceReferenceIds: ["coverage-1"],
      }],
    })]);

    expect(evaluateStrategyPolicy(policy, {
      type: "content",
      action: "create",
      targetUrl: "/blogs/news/mapped",
      sourceConditionEvidence: [{ coverageUnitId: "coverage-1", state: "satisfied" }],
    })).toMatchObject({
      result: "conflict",
      reasonCodes: ["CONDITIONAL_RULE_NOT_ACTIONABLE"],
    });
  });

  it("requires an exact mapped metadata decision before high-stakes review", () => {
    expect(evaluateStrategyPolicy(active([]), {
      type: "seo_metadata",
      targetUrl: "/blogs/news/unmapped",
      highStakesTopics: ["health"],
    })).toMatchObject({
      result: "conflict",
      reasonCodes: ["CONTENT_RULE_NOT_FOUND"],
    });

    expect(evaluateStrategyPolicy(active([
      rule("metadata", "refresh SEO metadata for CTR"),
    ]), {
      type: "seo_metadata",
      targetUrl: "/blogs/news/mapped",
      highStakesTopics: ["health"],
    })).toMatchObject({
      result: "needs_high_stakes_review",
      reasonCodes: ["HIGH_STAKES_MEDICAL_DOSAGE_REVIEW"],
      matchedRules: [expect.objectContaining({ ruleId: "metadata" })],
    });
  });
});
