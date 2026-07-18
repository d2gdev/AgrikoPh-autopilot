import { describe, expect, it } from "vitest";
import { compileStrategyPackage, type CompiledStrategyPackage } from "@/lib/topical-map/compiler";
import { readStrategyPackage } from "@/lib/topical-map/package-reader";
import { validateCompiledPackage } from "@/lib/topical-map/validator";
import {
  hasTopicalMapStrategyPackage,
  topicalMapStrategyRoot,
} from "../../helpers/topical-map-strategy-root";

const root = topicalMapStrategyRoot;
const approvedHash = "100b4ba60036fc3a93f98fc81964962c564969db03d21613d2aeeac60e57cf5a";

let approved: Promise<{ rawPackage: Awaited<ReturnType<typeof readStrategyPackage>>; compiledPackage: CompiledStrategyPackage; asOf: string }> | undefined;

function approvedInput() {
  approved ??= (async () => {
  const rawPackage = await readStrategyPackage(root);
  const compiledPackage = compileStrategyPackage(rawPackage);
  return { rawPackage, compiledPackage, asOf: "2026-07-12T00:00:00.000Z" };
  })();
  return approved;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cloneRawPackage(input: Awaited<ReturnType<typeof approvedInput>>["rawPackage"]) {
  return {
    ...input,
    manifest: clone(input.manifest),
    artifacts: Object.fromEntries(Object.entries(input.artifacts).map(([id, artifact]) => [id, { ...artifact, bytes: Buffer.from(artifact.bytes) }])) as typeof input.artifacts,
  };
}

function corrupt(compiledPackage: CompiledStrategyPackage, mutate: (value: any) => void) {
  const result = clone(compiledPackage) as any;
  mutate(result);
  return result as CompiledStrategyPackage;
}

describe.skipIf(!hasTopicalMapStrategyPackage)("topical-map whole-package validator", () => {
  it("accepts the approved July 12 package with its exact identity and three current evidence gates", async () => {
    const report = validateCompiledPackage(await approvedInput());

    expect(report).toMatchObject({ valid: true, blockingIssueCount: 0, issues: [] });
    expect(report.evidenceFreshness).toEqual([
      expect.objectContaining({ ruleId: "evidence-gate:720b7c983a515f189bde", gateId: "evidence-gate:720b7c983a515f189bde:evidence:0", mandatory: true, evidenceDate: "2026-07-11", maxAgeDays: 180, ageDays: 1, status: "current", blockingReason: null }),
      expect.objectContaining({ ruleId: "canonical-advisory:0deeb8fa1dbbee4c0dbe", gateId: "canonical-advisory:0deeb8fa1dbbee4c0dbe:evidence:0", mandatory: true, evidenceDate: "2026-07-11", maxAgeDays: 180, ageDays: 1, status: "current", blockingReason: null }),
      expect.objectContaining({ ruleId: "indexation-advisory:248c9b46207fa30f1bb2", gateId: "indexation-advisory:248c9b46207fa30f1bb2:evidence:0", mandatory: true, evidenceDate: "2026-07-11", maxAgeDays: 180, ageDays: 1, status: "current", blockingReason: null }),
    ]);
    expect(JSON.stringify(report)).not.toContain("Eight source-to-target dossier");
    expect(JSON.stringify(report)).not.toContain("bytes");
  }, 30000);

  it("keeps general and high-stakes evidence current at the boundary and blocks it one UTC day later", async () => {
    const input = await approvedInput();
    const generalBoundary = validateCompiledPackage({ ...input, asOf: "2027-01-07T12:00:00.000Z" });
    const generalStale = validateCompiledPackage({ ...input, asOf: "2027-01-08T12:00:00.000Z" });
    const highStakes = corrupt(input.compiledPackage, (value) => {
      value.rules[0].evidenceRequirements = [{ kind: "source_required_evidence", text: "protected prose", sourceReferenceIds: [value.rules[0].sourceReferences[0].coverageUnitId], mandatory: true, evidenceClass: "high_stakes", maxAgeDays: 90 }];
    });
    const highBoundary = validateCompiledPackage({ ...input, compiledPackage: highStakes, asOf: "2026-10-09T12:00:00.000Z" });
    const highStale = validateCompiledPackage({ ...input, compiledPackage: highStakes, asOf: "2026-10-10T12:00:00.000Z" });

    expect(generalBoundary.evidenceFreshness.every((gate) => gate.status === "current")).toBe(true);
    expect(generalStale.evidenceFreshness[0]).toMatchObject({ ageDays: 181, status: "stale", blockingReason: "STALE_MANDATORY_EVIDENCE" });
    expect(generalStale.valid).toBe(false);
    expect(generalStale.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "STALE_MANDATORY_EVIDENCE" })]));
    expect(highBoundary.evidenceFreshness.find((gate) => gate.ruleId === highStakes.rules[0]?.ruleId)).toMatchObject({ maxAgeDays: 90, ageDays: 90, status: "current" });
    expect(highStale.evidenceFreshness.find((gate) => gate.ruleId === highStakes.rules[0]?.ruleId)).toMatchObject({ maxAgeDays: 90, ageDays: 91, status: "stale", blockingReason: "STALE_MANDATORY_EVIDENCE" });
  }, 30000);

  it("retains a missing mandatory evidence gate for historical inspection while blocking eligibility", async () => {
    const input = await approvedInput();
    const rawPackage = cloneRawPackage(input.rawPackage);
    (rawPackage.manifest as any).evidenceDate = "not-a-date";

    const report = validateCompiledPackage({ ...input, rawPackage });

    expect(report.valid).toBe(false);
    expect(report.evidenceFreshness).toHaveLength(3);
    expect(report.evidenceFreshness[0]).toMatchObject({ status: "missing", blockingReason: "MISSING_EVIDENCE_GATE" });
    expect(report.issues.find((issue) => issue.code === "MISSING_EVIDENCE_GATE")).toMatchObject({ code: "MISSING_EVIDENCE_GATE", blocking: true, ruleId: "evidence-gate:720b7c983a515f189bde", sourceArtifactId: "evidence" });
  }, 30000);

  it.each([
    ["MISSING_ARTIFACT", async (input: any) => { delete input.rawPackage.artifacts.evidence; }],
    ["HASH_MISMATCH", async (input: any) => { input.rawPackage.artifacts.map.bytes[0] ^= 1; }],
    ["INCOMPATIBLE_SCHEMA", async (input: any) => { input.rawPackage.manifest.schemaVersion = "2.0.0"; }],
    ["CONFLICTING_INTENT_OWNER", async (input: any) => { const owners = input.compiledPackage.rules.filter((rule: any) => rule.domain === "url_intent_ownership" && rule.payload.exclusiveIntentScope); owners[1].payload.exclusiveIntentScope = owners[0].payload.exclusiveIntentScope; }],
    ["ORPHANED_REFERENCE", async (input: any) => { input.compiledPackage.rules[0].sourceReferences[0].coverageUnitId = "coverage:missing"; }],
    ["REDIRECT_CONFLICT", async (input: any) => { const redirect = input.compiledPackage.rules.find((rule: any) => rule.domain === "redirects"); input.compiledPackage.rules.push({ ...clone(redirect), ruleId: "redirect:conflict", payload: { ...redirect.payload, finalTarget: "/different-target" } }); }],
    ["CANONICAL_CONFLICT", async (input: any) => { const canonical = input.compiledPackage.rules.find((rule: any) => rule.domain === "canonicalization"); input.compiledPackage.rules.push({ ...clone(canonical), ruleId: "canonical:conflict", payload: { ...canonical.payload, proposedCanonicalUrl: "/different-canonical" } }); }],
  ])("reports %s with safe rule/source provenance instead of repairing input", async (code, mutate) => {
    const input = await approvedInput() as any;
    input.rawPackage = cloneRawPackage(input.rawPackage);
    input.compiledPackage = clone(input.compiledPackage);
    await mutate(input);

    const report = validateCompiledPackage(input);
    const issue = report.issues.find((item) => item.code === code);
    expect(issue).toMatchObject({ code, blocking: true, ruleId: expect.any(String), sourceArtifactId: expect.any(String), sourceLocator: expect.any(Object) });
    expect(JSON.stringify(issue)).not.toContain("protected prose");
    expect(JSON.stringify(issue)).not.toContain("bytes");
  }, 30000);

  it("rejects incompatible compiled identity and duplicate conflicting records without choosing a winner", async () => {
    const input = await approvedInput();
    const compiledPackage = corrupt(input.compiledPackage, (value) => {
      value.packageSha256 = "b".repeat(64);
      value.rules.push(clone(value.rules[0]));
    });

    const report = validateCompiledPackage({ ...input, compiledPackage });

    expect(report.valid).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INCOMPATIBLE_SCHEMA" }),
      expect.objectContaining({ code: "ORPHANED_REFERENCE", ruleId: input.compiledPackage.rules[0]?.ruleId }),
    ]));
  }, 30000);

  it("is repeatable and does not mutate supplied raw or compiled inputs", async () => {
    const input = await approvedInput();
    const before = { ...input, rawPackage: cloneRawPackage(input.rawPackage), compiledPackage: clone(input.compiledPackage) };

    const first = validateCompiledPackage(input);
    const second = validateCompiledPackage(input);

    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(input.rawPackage.packageSha256).toBe(approvedHash);
  }, 60000);
});
