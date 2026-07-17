import { describe, expect, it } from "vitest";
import { parseCompilationContract } from "@/lib/topical-map/contract";

const sha = "a".repeat(64);
const sourceArtifacts = ["map", "evidence", "url-inventory", "redirect-inventory", "internal-links"].map((id) => ({ id, sha256: sha }));
const compatibility = { runtimeSchema: ">=1.0.0 <2.0.0", pluginVersion: ">=0.1.0", siteHost: "agrikoph.com", urlNormalization: "agriko-url-v1" };
const locator = { kind: "markdown_prose_span", headingPath: ["Map"], contentFingerprint: sha, lineStart: 1, lineEnd: 1 };
const reference = { coverageUnitId: "coverage:one", artifactId: "map", locator };
const requirement = { kind: "literal_source_condition", text: "literal", sourceReferenceIds: ["coverage:one"] };
const evidenceRequirement = { kind: "source_required_evidence", text: "evidence", sourceReferenceIds: ["coverage:one"], mandatory: true, evidenceClass: "general_seo_market", maxAgeDays: 180 };

function validContract(): any {
  return {
    $schema: "./schema.json", contractSchemaVersion: "1.0.0", contractRevision: "1", strategyVersion: "2026-07-12", siteHost: "agrikoph.com",
    sourceArtifacts, compatibility, locatorGrammarVersion: "agriko-locator-v1",
    coverageInventory: [{ coverageId: "coverage:one", artifactId: "map", locator, disposition: "compiled", ruleIds: ["literal:one"], ambiguityIds: [], rationale: "literal" }],
    rules: [{ ruleId: "literal:one", domain: "evidence_gates", type: "literal", sourceReferences: [reference], sourceFingerprints: [sha], payload: { name: "n", literalText: "t" }, conditions: [], evidenceRequirements: [], reviewRequirements: [], resolutionStatus: "resolved", provenance: { projection: "literal", authoredAt: "2026-07-12" } }],
    unresolvedAmbiguities: [],
    review: { status: "approved", approval: { identity: "operator", approvedAt: "2026-07-12T00:00:00.000Z" }, validationImportEligible: true, activationEligible: false, operatorReviewRequired: true, active: false, approvalBasis: "review", approvalScope: "package", runtimeActivationAuthorized: false, liveExecutionAuthorized: false, canonicalIndexationExecutionProhibited: true, task3Authorized: false },
  };
}

function phaseRule(): any {
  return { ...validContract().rules[0], ruleId: "phase:one", type: "phase_specific_schedule_gate", reviewRequirements: [requirement], phaseGate: { governedAdvisoryAction: "review", defaultSatisfied: false, autoPass: false, reviewRequired: true, executionProhibited: true, blocksOnlyGovernedAction: true, sourceConditions: ["literal"] } };
}
function scheduleRule(): any {
  return { ...validContract().rules[0], ruleId: "schedule:one", type: "literal_schedule_obligation", scheduleAuthorityBoundary: { operationMode: "proposal_only", executionProhibited: true, elapsedTimeAuthorizesAction: false, satisfactionCanTriggerMutation: false, independentSafeguardsRequired: true, absentEvidenceNonExecutable: true } };
}

describe("full compilation contract parser", () => {
  it("parses an approved minimal full contract", () => expect(parseCompilationContract(validContract()).review.status).toBe("approved"));
  it("accepts current ISO provenance dates and rejects malformed dates", () => {
    const current = validContract();
    current.rules[0].provenance.authoredAt = "2026-07-18";
    expect(parseCompilationContract(current).rules[0]!.provenance.authoredAt).toBe("2026-07-18");
    current.rules[0].provenance.authoredAt = "18-07-2026";
    expect(() => parseCompilationContract(current)).toThrow(expect.objectContaining({ code: "INVALID_CONTRACT_SCHEMA" }));
  });
  it("permits local validation/import approval without activation authority", () => {
    const value = validContract();
    value.review.activationEligible = false;
    value.review.validationImportEligible = true;
    expect(parseCompilationContract(value).review).toMatchObject({ status: "approved", validationImportEligible: true, activationEligible: false, runtimeActivationAuthorized: false, liveExecutionAuthorized: false });
  });
  it("permits approved strategy-selection activation authority", () => {
    const value = validContract();
    value.review.activationEligible = true;
    value.review.runtimeActivationAuthorized = true;
    expect(parseCompilationContract(value).review).toMatchObject({ status: "approved", validationImportEligible: true, activationEligible: true, runtimeActivationAuthorized: true, active: false, liveExecutionAuthorized: false });
  });
  it.each([
    ["partial activation authority", (r: any) => r.activationEligible = true],
    ["activation without validation/import eligibility", (r: any) => { r.activationEligible = true; r.runtimeActivationAuthorized = true; r.validationImportEligible = false; }],
    ["pre-marked active package", (r: any) => { r.activationEligible = true; r.runtimeActivationAuthorized = true; r.active = true; }],
    ["live-execution authority", (r: any) => { r.activationEligible = true; r.runtimeActivationAuthorized = true; r.liveExecutionAuthorized = true; }],
  ])("rejects approved contract with %s", (_name, mutate) => {
    const value = validContract();
    mutate(value.review);
    expect(() => parseCompilationContract(value)).toThrow(expect.objectContaining({ code: "INVALID_CONTRACT_SCHEMA" }));
  });
  it("requires explicit mandatory freshness policy for every declared evidence gate", () => {
    const value = validContract();
    value.rules[0].evidenceRequirements = [{ ...evidenceRequirement, mandatory: undefined }];
    expect(() => parseCompilationContract(value)).toThrow(expect.objectContaining({ code: "INVALID_CONTRACT_SCHEMA" }));
  });
  it("accepts high-stakes evidence only with the 90-day policy", () => {
    const value = validContract();
    value.rules[0].domain = "high_stakes_reviews";
    value.rules[0].evidenceRequirements = [{ ...evidenceRequirement, evidenceClass: "high_stakes", maxAgeDays: 90 }];
    expect(parseCompilationContract(value).rules[0]?.evidenceRequirements[0]).toMatchObject({ mandatory: true, evidenceClass: "high_stakes", maxAgeDays: 90 });
  });
  it.each([
    ["optional", (r: any) => r.mandatory = false],
    ["general freshness", (r: any) => r.maxAgeDays = 90],
    ["high-stakes freshness", (r: any) => { r.evidenceClass = "high_stakes"; r.maxAgeDays = 180; }],
  ])("rejects unsafe evidence gate %s", (_name, mutate) => {
    const value = validContract();
    value.rules[0].evidenceRequirements = [{ ...evidenceRequirement }];
    mutate(value.rules[0].evidenceRequirements[0]);
    expect(() => parseCompilationContract(value)).toThrow(expect.objectContaining({ code: "INVALID_CONTRACT_SCHEMA" }));
  });
  it.each([
    ["missing body field", (v: any) => delete v.coverageInventory],
    ["unknown reserved nested field", (v: any) => v.compatibility.extra = true],
    ["malformed coverage", (v: any) => delete v.coverageInventory[0].rationale],
    ["malformed rule", (v: any) => delete v.rules[0].sourceReferences],
    ["unsupported version", (v: any) => v.contractSchemaVersion = "2.0.0"],
    ["invalid revision", (v: any) => v.contractRevision = "01"],
    ["pending eligible", (v: any) => { v.review.status = "pending"; v.review.activationEligible = true; v.review.approval = { identity: null, approvedAt: null }; }],
    ["approved without identity", (v: any) => v.review.approval.identity = null],
    ["approved without timestamp", (v: any) => v.review.approval.approvedAt = null],
  ])("rejects %s", (_name, mutate) => { const value = validContract(); mutate(value); expect(() => parseCompilationContract(value)).toThrow(expect.objectContaining({ code: "INVALID_CONTRACT_SCHEMA" })); });
  it.each([
    ["missing reviews", (r: any) => delete r.reviewRequirements], ["empty reviews", (r: any) => r.reviewRequirements = []], ["auto pass", (r: any) => r.phaseGate.autoPass = true], ["default satisfied", (r: any) => r.phaseGate.defaultSatisfied = true], ["execution allowed", (r: any) => r.phaseGate.executionProhibited = false],
  ])("rejects unsafe phase gate %s", (_name, mutate) => { const v = validContract(); v.rules = [phaseRule()]; mutate(v.rules[0]); expect(() => parseCompilationContract(v)).toThrow(expect.objectContaining({ code: "INVALID_CONTRACT_SCHEMA" })); });
  it.each([
    ["non-advisory schedule", (r: any) => r.scheduleAuthorityBoundary.operationMode = "live"], ["executable schedule", (r: any) => r.scheduleAuthorityBoundary.executionProhibited = false], ["elapsed-time authority", (r: any) => r.scheduleAuthorityBoundary.elapsedTimeAuthorizesAction = true],
  ])("rejects unsafe schedule obligation %s", (_name, mutate) => { const v = validContract(); v.rules = [scheduleRule()]; mutate(v.rules[0]); expect(() => parseCompilationContract(v)).toThrow(expect.objectContaining({ code: "INVALID_CONTRACT_SCHEMA" })); });
  it.each(["canonicalization", "indexation"])("rejects executable %s advisory rule", (domain) => { const v = validContract(); v.rules[0] = { ...v.rules[0], domain, payload: { currentUrl: "https://agrikoph.com", proposedCanonicalUrl: "https://agrikoph.com", title: "t", contentKind: "k", publishingState: "s", cluster: "c", primaryKeywordOrTheme: "p", secondaryVariants: "", dominantIntent: "i", role: "r", decision: "d", exactTargetIfAny: "", priority: "p", evidence: "e", advisoryCanonicalIndexation: { operationMode: "proposal_only", executionProhibited: false, stateClassification: "observed_current_state", evidenceRequirement: "read_only_evidence_required", deferredExecutionDecisions: ["future"] } } }; expect(() => parseCompilationContract(v)).toThrow(expect.objectContaining({ code: "INVALID_CONTRACT_SCHEMA" })); });
  it("does not expose raw contract content in errors", () => { const v = validContract(); (v as any).secret = "raw-contract-secret"; try { parseCompilationContract(v); } catch (error) { expect(String(error)).not.toContain("raw-contract-secret"); } });
});
