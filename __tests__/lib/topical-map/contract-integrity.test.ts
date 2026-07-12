import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCompilationContract } from "@/lib/topical-map/contract";
import { validateCompilationContractIntegrity } from "@/lib/topical-map/contract-integrity";
import { readStrategyPackage } from "@/lib/topical-map/package-reader";

const root = "/home/sean/Agriko/shopify-theme/docs/seo";

async function approvedInput() {
  const rawPackage = await readStrategyPackage(root);
  const contract = parseCompilationContract(JSON.parse(await readFile(`${root}/agriko-topical-map-compilation-contract-2026-07-12.json`, "utf8")));
  return { rawPackage, contract };
}

async function expectIntegrityError(mutate: (contract: any) => void, code: string) {
  const input = await approvedInput();
  const contract = structuredClone(input.contract) as any;
  mutate(contract);
  expect(() => validateCompilationContractIntegrity({ rawPackage: input.rawPackage, contract })).toThrow(expect.objectContaining({ code }));
}

describe("topical-map compilation contract integrity", () => {
  it("accepts the exact approved July 12 package with all approved units and rules accounted for", async () => {
    const result = validateCompilationContractIntegrity(await approvedInput());
    expect(result).toEqual({ coverageUnitCount: 853, ruleCount: 1493, sourceRowCounts: { "url-inventory": 163, "redirect-inventory": 113, "internal-links": 456 } });
  }, 30000);

  it("rejects source-anchor fingerprint drift without exposing source bytes", async () => {
    const input = await approvedInput();
    const contract = structuredClone(input.contract) as any;
    contract.coverageInventory[0].locator.rowFingerprint = "0".repeat(64);
    try {
      validateCompilationContractIntegrity({ rawPackage: input.rawPackage, contract });
    } catch (error) {
      expect(error).toMatchObject({ code: "LOCATOR_FINGERPRINT_DRIFT" });
      expect(String(error)).not.toContain("Agriko");
      return;
    }
    throw new Error("expected fingerprint drift");
  });

  it.each([
    ["missing coverage", (v: any) => { v.coverageInventory.splice(0, 1); }, "UNDISCLOSED_SOURCE_COVERAGE"],
    ["duplicated CSV coverage while omitting a source row", (v: any) => { v.coverageInventory[1].locator = structuredClone(v.coverageInventory[0].locator); }, "UNDISCLOSED_SOURCE_COVERAGE"],
    ["missing coverage identifier", (v: any) => { delete v.coverageInventory[0].coverageId; }, "MISSING_COVERAGE_ID"],
    ["missing disposition", (v: any) => { delete v.coverageInventory[0].disposition; }, "UNDISPOSED_COVERAGE"],
    ["duplicate coverage identifier", (v: any) => { v.coverageInventory[1].coverageId = v.coverageInventory[0].coverageId; }, "DUPLICATE_COVERAGE_ID"],
    ["missing rule identifier", (v: any) => { delete v.rules[0].ruleId; }, "MISSING_RULE_ID"],
    ["duplicate rule identifier", (v: any) => { v.rules[1].ruleId = v.rules[0].ruleId; }, "DUPLICATE_RULE_ID"],
    ["missing ambiguity identifier", (v: any) => { v.unresolvedAmbiguities = [{ classification: "manual_gate", sourceReferences: [v.rules[0].sourceReferences[0]], unresolvedQuestion: "question", safeEffect: "blocks_governed_action", provenance: { recordedAt: "2026-07-12", reason: "reason" } }]; }, "MISSING_AMBIGUITY_ID"],
    ["duplicate ambiguity identifier", (v: any) => { v.unresolvedAmbiguities = [{ ambiguityId: "ambiguity:one", classification: "manual_gate", sourceReferences: [v.rules[0].sourceReferences[0]], unresolvedQuestion: "question", safeEffect: "blocks_governed_action", provenance: { recordedAt: "2026-07-12", reason: "reason" } }, { ambiguityId: "ambiguity:one", classification: "manual_gate", sourceReferences: [v.rules[0].sourceReferences[0]], unresolvedQuestion: "question", safeEffect: "blocks_governed_action", provenance: { recordedAt: "2026-07-12", reason: "reason" } }]; }, "DUPLICATE_AMBIGUITY_ID"],
    ["dangling coverage rule", (v: any) => { v.coverageInventory[0].ruleIds.push("literal:missing"); }, "DANGLING_RULE_REFERENCE"],
    ["unanchored rule", (v: any) => { v.rules[0].sourceReferences = []; }, "UNANCHORED_RULE"],
    ["non-bidirectional rule reference", (v: any) => { v.coverageInventory.find((entry: any) => entry.ruleIds.length > 0).ruleIds = []; }, "COVERAGE_REFERENCE_MISMATCH"],
    ["conflicting exclusive typed mappings", (v: any) => { const exclusive = v.rules.filter((rule: any) => rule.payload?.exclusiveIntentScope); exclusive[1].payload.exclusiveIntentScope = exclusive[0].payload.exclusiveIntentScope; }, "CONFLICTING_EXCLUSIVE_MAPPING"],
    ["activation-blocking ambiguity on approved eligibility", (v: any) => { v.unresolvedAmbiguities = [{ ambiguityId: "ambiguity:one", classification: "activation_blocking", sourceReferences: [v.rules[0].sourceReferences[0]], unresolvedQuestion: "question", safeEffect: "blocks_governed_action", provenance: { recordedAt: "2026-07-12", reason: "reason" } }]; }, "UNRESOLVED_ACTIVATION_BLOCKING_AMBIGUITY"],
  ])("rejects %s", async (_name, mutate, code) => expectIntegrityError(mutate, code));
});
