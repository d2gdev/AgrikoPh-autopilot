import { beforeAll, describe, expect, it } from "vitest";
import { compileStrategyPackage, type CompiledRule, type CompiledStrategyPackage } from "@/lib/topical-map/compiler";
import { evaluateStrategyPolicy, type ActiveStrategyPolicy } from "@/lib/topical-map/evaluator";
import { readStrategyPackage } from "@/lib/topical-map/package-reader";
import { validateCompiledPackage, type ValidationReport } from "@/lib/topical-map/validator";
import {
  hasTopicalMapStrategyPackage,
  topicalMapStrategyRoot,
} from "../../helpers/topical-map-strategy-root";

const root = topicalMapStrategyRoot;

let active: ActiveStrategyPolicy;
let compiled: CompiledStrategyPackage;
let freshReport: ValidationReport;

function rule(predicate: (item: CompiledRule) => boolean): CompiledRule {
  const result = compiled.rules.find(predicate);
  if (!result) throw new Error("Expected approved compiled rule.");
  return result;
}

describe.skipIf(!hasTopicalMapStrategyPackage)("evaluateStrategyPolicy", () => {
  beforeAll(async () => {
    const rawPackage = await readStrategyPackage(root);
    compiled = compileStrategyPackage(rawPackage);
    freshReport = validateCompiledPackage({ rawPackage, compiledPackage: compiled, asOf: "2026-07-12T00:00:00.000Z" });
    active = {
      packageIdentity: {
        strategyVersion: rawPackage.manifest.strategyVersion,
        packageSha256: rawPackage.packageSha256,
        artifacts: rawPackage.manifest.artifacts.map(({ id, sha256 }) => ({ id, sha256 })),
      },
      compiledPackage: compiled,
      validationReport: freshReport,
    };
  }, 30000);

  it("reports an exclusive-owner conflict with contract and source traceability", () => {
    const owner = rule((item) => item.domain === "url_intent_ownership" && typeof (item.payload as any).exclusiveIntentScope === "string");
    const payload = owner.payload as any;

    const result = evaluateStrategyPolicy(active, {
      type: "content",
      action: "create",
      targetUrl: "/new-owner",
      exclusiveIntentScope: payload.exclusiveIntentScope,
    });

    expect(result).toMatchObject({ result: "conflict", reasonCodes: ["EXCLUSIVE_INTENT_OWNER_CONFLICT"] });
    expect(result.matchedRules).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: owner.ruleId, sourceReferences: owner.sourceReferences })]));
    expect(result.packageIdentity).toEqual(active.packageIdentity);
  });

  it("requires the declared condition before reconsidering an explicit do-not-create decision", () => {
    const prohibited = rule((item) => item.domain === "prohibited_content");
    const payload = prohibited.payload as any;

    const result = evaluateStrategyPolicy(active, { type: "content", action: "create", targetUrl: payload.currentUrl });

    expect(result).toMatchObject({ result: "needs_evidence", reasonCodes: ["UNSATISFIED_SOURCE_CONDITION"] });
    expect(result.matchedRules).toEqual([expect.objectContaining({ ruleId: "content-decision:3396fb206dd722f3a4d5" })]);
  });

  it("recognizes an exact required internal link", () => {
    const link = rule((item) => item.domain === "internal_links" && /\b(add|ensure)\b/i.test(String((item.payload as any).requiredAction ?? "")));
    const payload = link.payload as any;

    const result = evaluateStrategyPolicy(active, { type: "internal_link", fromUrl: payload.fromUrl, toUrl: payload.toUrl });

    expect(result).toMatchObject({ result: "compliant", reasonCodes: [] });
    expect(result.matchedRules).toEqual([expect.objectContaining({ ruleId: link.ruleId })]);
  });

  it("does not treat a retain-only link rule as authorization to append a missing link", () => {
    const link = rule((item) => item.domain === "internal_links" && /\bretain\b/i.test(String((item.payload as any).requiredAction ?? "")));
    const payload = link.payload as any;

    const result = evaluateStrategyPolicy(active, { type: "internal_link", fromUrl: payload.fromUrl, toUrl: payload.toUrl });

    expect(result).toMatchObject({ result: "conflict", reasonCodes: ["NON_ADDITIVE_INTERNAL_LINK_INSTRUCTION"] });
    expect(result.matchedRules).toEqual([expect.objectContaining({ ruleId: link.ruleId })]);
  });

  it("blocks a link that targets a legacy redirect source", () => {
    const redirect = rule((item) => item.domain === "redirects");
    const payload = redirect.payload as any;

    const result = evaluateStrategyPolicy(active, { type: "internal_link", fromUrl: "/blogs/news/example", toUrl: payload.source });

    expect(result).toMatchObject({ result: "blocked", reasonCodes: ["LEGACY_REDIRECT_SOURCE_TARGET"] });
    expect(result.matchedRules).toEqual([expect.objectContaining({ ruleId: redirect.ruleId })]);
  });

  it("requires explicit source-condition evidence for the conditional brown-rice recipe threshold", () => {
    const brownRice = rule((item) => item.ruleId === "content-decision:3396fb206dd722f3a4d5");
    const payload = brownRice.payload as any;
    const coverageUnitId = brownRice.conditions[0]?.sourceReferenceIds[0];
    if (!coverageUnitId) throw new Error("Expected brown-rice source condition coverage.");

    const missing = evaluateStrategyPolicy(active, {
      type: "content",
      action: "create",
      targetUrl: payload.currentUrl,
    });
    const insufficient = evaluateStrategyPolicy(active, {
      type: "content",
      action: "create",
      targetUrl: payload.currentUrl,
      sourceConditionEvidence: [{ coverageUnitId, state: "unsatisfied", observedValue: 5 }],
    });
    const satisfied = evaluateStrategyPolicy(active, {
      type: "content",
      action: "create",
      targetUrl: payload.currentUrl,
      sourceConditionEvidence: [{ coverageUnitId, state: "satisfied", observedValue: 6 }],
    });

    expect(missing).toMatchObject({ result: "needs_evidence", reasonCodes: ["UNSATISFIED_SOURCE_CONDITION"] });
    expect(insufficient).toMatchObject({ result: "needs_evidence", reasonCodes: ["UNSATISFIED_SOURCE_CONDITION"] });
    expect(insufficient.matchedRules).toEqual([expect.objectContaining({ ruleId: brownRice.ruleId })]);
    expect(satisfied).toMatchObject({ result: "compliant", reasonCodes: [] });
  });

  it("fails closed for every active manual-gate content decision", () => {
    const gated = compiled.byDomain.content_decisions.filter((item) => item.resolutionStatus === "manual_gate");
    expect(gated).toHaveLength(11);
    for (const item of gated) {
      const value = item.payload as { currentUrl: string };
      expect(evaluateStrategyPolicy(active, { type: "content", action: "update", targetUrl: value.currentUrl })).toMatchObject({
        result: "blocked",
        reasonCodes: ["MANUAL_GATE_REQUIRED"],
        matchedRules: [expect.objectContaining({ ruleId: item.ruleId })],
      });
    }
  });

  it("fails closed for both active manual-gate redirects", () => {
    const gated = compiled.byDomain.redirects.filter((item) => item.resolutionStatus === "manual_gate");
    expect(gated).toHaveLength(2);
    for (const item of gated) {
      const value = item.payload as { source: string; finalTarget: string };
      expect(evaluateStrategyPolicy(active, { type: "redirect", fromUrl: value.source, toUrl: value.finalTarget })).toMatchObject({
        result: "blocked",
        reasonCodes: ["MANUAL_GATE_REQUIRED"],
      });
    }
  });

  it("requires fresh mandatory evidence from the validator report", () => {
    const staleReport: ValidationReport = {
      ...freshReport,
      valid: false,
      blockingIssueCount: 1,
      issues: [{ code: "STALE_MANDATORY_EVIDENCE", blocking: true, ruleId: "evidence-gate:720b7c983a515f189bde", sourceArtifactId: "evidence", sourceLocator: { kind: "markdown_heading" } }],
      evidenceFreshness: freshReport.evidenceFreshness.map((entry, index) => index === 0 ? { ...entry, status: "stale", blockingReason: "STALE_MANDATORY_EVIDENCE" } : entry),
    };

    const result = evaluateStrategyPolicy({ ...active, validationReport: staleReport }, { type: "redirect", fromUrl: "/old", toUrl: "/new" });

    expect(result).toMatchObject({ result: "needs_evidence", reasonCodes: ["STALE_MANDATORY_EVIDENCE"] });
    expect(result.evidenceFreshness).toEqual(expect.arrayContaining([expect.objectContaining({ status: "stale" })]));
  });

  it("retains the exact redirect rule as proposal-only evidence", () => {
    const redirect = rule((item) => item.domain === "redirects");
    const payload = redirect.payload as any;

    const result = evaluateStrategyPolicy(active, { type: "redirect", fromUrl: payload.source, toUrl: payload.finalTarget });

    expect(result).toMatchObject({ result: "compliant", reasonCodes: [], executionAuthorized: false, requiredApprovals: ["operator_review"] });
    expect(result.matchedRules).toEqual([expect.objectContaining({ ruleId: redirect.ruleId })]);
  });

  it("requires high-stakes review for dosage or medical context", () => {
    const medical = rule((item) => item.ruleId === "literal-medical-dosage-review:f55758aa8295db2b992c");

    const result = evaluateStrategyPolicy(active, { type: "seo_metadata", targetUrl: "/blogs/news/dosage", highStakesTopics: ["dosage"] });

    expect(result).toMatchObject({ result: "needs_high_stakes_review", reasonCodes: ["HIGH_STAKES_MEDICAL_DOSAGE_REVIEW"], requiredApprovals: ["manual_high_stakes_review"] });
    expect(result.matchedRules).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: medical.ruleId })]));
  });

  it("fails closed when an active strategy is unavailable", () => {
    expect(evaluateStrategyPolicy(null, { type: "content", action: "create", targetUrl: "/new-page" })).toEqual(expect.objectContaining({ result: "unavailable_strategy", reasonCodes: ["ACTIVE_STRATEGY_UNAVAILABLE"] }));
  });

  it("is repeatable, retains six-artifact identity, and never authorizes technical execution", () => {
    const canonical = rule((item) => item.domain === "canonicalization");
    const payload = canonical.payload as any;
    const candidate = { type: "canonical" as const, currentUrl: payload.currentUrl, proposedCanonicalUrl: payload.proposedCanonicalUrl };

    const first = evaluateStrategyPolicy(active, candidate);
    const second = evaluateStrategyPolicy(active, candidate);

    expect(first).toEqual(second);
    if (!first.packageIdentity) throw new Error("Expected active strategy identity.");
    expect(first.packageIdentity.artifacts).toHaveLength(6);
    expect(first).toMatchObject({ executionAuthorized: false, requiredApprovals: expect.arrayContaining(["operator_review"]) });
  });
});
