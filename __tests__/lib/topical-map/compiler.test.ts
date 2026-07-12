import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { compileStrategyPackage } from "@/lib/topical-map/compiler";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";
import { readStrategyPackage } from "@/lib/topical-map/package-reader";

const root = "/home/sean/Agriko/shopify-theme/docs/seo";

async function approvedPackage() {
  return readStrategyPackage(root);
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function minimalPackage() {
  const map = "# Map\nliteral\n";
  const evidence = "# Evidence\nliteral\n";
  const csv = "id\n";
  const locator = { kind: "markdown_heading", headingPath: ["Map"], contentFingerprint: hash("# Map\nliteral"), lineStart: 1, lineEnd: 2 };
  const reference = { coverageUnitId: "coverage:one", artifactId: "map", locator };
  const contract = {
    $schema: "./schema.json", contractSchemaVersion: "1.0.0", contractRevision: "1", strategyVersion: "2026-07-12", siteHost: "agrikoph.com",
    sourceArtifacts: [["map", map], ["evidence", evidence], ["url-inventory", csv], ["redirect-inventory", csv], ["internal-links", csv]].map(([id, bytes]) => ({ id, sha256: hash(bytes ?? "") })),
    compatibility: { runtimeSchema: ">=1.0.0 <2.0.0", pluginVersion: ">=0.1.0", siteHost: "agrikoph.com", urlNormalization: "agriko-url-v1" }, locatorGrammarVersion: "agriko-locator-v1",
    coverageInventory: [{ coverageId: "coverage:one", artifactId: "map", locator, disposition: "compiled", ruleIds: ["literal:one"], ambiguityIds: [], rationale: "literal" }],
    rules: [{ ruleId: "literal:one", domain: "evidence_gates", type: "literal", sourceReferences: [reference], sourceFingerprints: [locator.contentFingerprint], payload: { name: "n", literalText: "t" }, conditions: [], evidenceRequirements: [], reviewRequirements: [], resolutionStatus: "resolved", provenance: { projection: "literal", authoredAt: "2026-07-12" } }],
    unresolvedAmbiguities: [], review: { status: "approved", approval: { identity: "operator", approvedAt: "2026-07-12T00:00:00.000Z" }, activationEligible: true, operatorReviewRequired: true, active: false, approvalBasis: "review", approvalScope: "package", runtimeActivationAuthorized: false, liveExecutionAuthorized: false, canonicalIndexationExecutionProhibited: true, task3Authorized: false },
  };
  const bytes = { map, evidence, "url-inventory": csv, "redirect-inventory": csv, "internal-links": csv, "compilation-contract": JSON.stringify(contract) } as const;
  return {
    packageSha256: "a".repeat(64),
    artifacts: Object.fromEntries(Object.entries(bytes).map(([id, value]) => [id, { id, bytes: Buffer.from(value) }])),
  } as any;
}

describe("topical-map approved-contract compiler", () => {
  let compiled: ReturnType<typeof compileStrategyPackage>;

  beforeAll(async () => {
    compiled = compileStrategyPackage(await approvedPackage());
  }, 30000);

  it("compiles the exact approved July 12 package only after full typed-contract integrity", async () => {
    expect(compiled).toMatchObject({
      strategyVersion: "2026-07-12",
      packageSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      integrity: {
        coverageUnitCount: 853,
        ruleCount: 1493,
        sourceRowCounts: { "url-inventory": 163, "redirect-inventory": 113, "internal-links": 456 },
      },
    });
    expect(compiled.rules).toHaveLength(1493);
    expect(compiled.coverage).toHaveLength(853);
  }, 30000);

  it("retains every typed policy domain and all structured CSV rule records", async () => {
    expect(Object.fromEntries(Object.entries(compiled.byDomain).map(([domain, rules]) => [domain, rules.length]))).toEqual({
      clusters: 33,
      page_roles: 163,
      url_intent_ownership: 163,
      content_decisions: 163,
      prohibited_content: 1,
      internal_links: 456,
      redirects: 113,
      canonicalization: 163,
      indexation: 163,
      evidence_gates: 66,
      high_stakes_reviews: 9,
    });
  }, 30000);

  it("preserves typed conditional, dossier, and high-stakes safeguards verbatim", async () => {
    const recipe = compiled.rules.find((rule) => rule.ruleId === "content-decision:3396fb206dd722f3a4d5");
    const dossier = compiled.rules.find((rule) => rule.ruleId === "evidence-gate:720b7c983a515f189bde");
    const medical = compiled.rules.find((rule) => rule.ruleId === "literal-medical-dosage-review:f55758aa8295db2b992c");

    expect(recipe?.payload).toMatchObject({ decision: "do not create now; create only after six original tested recipes and fresh SERP validation" });
    expect(recipe?.conditions).toEqual([{ kind: "literal_source_condition", text: "do not create now; create only after six original tested recipes and fresh SERP validation", sourceReferenceIds: ["coverage:url-inventory:3396fb206dd722f3a4d5"] }]);
    expect(dossier?.evidenceRequirements).toEqual([{ kind: "source_required_evidence", text: "Eight source-to-target dossier fields are required before a redirect decision is complete.", sourceReferenceIds: ["coverage:evidence:heading:0d705ce702b0474d9059"] }]);
    expect(medical?.reviewRequirements).toEqual([{ kind: "source_required_manual_review", text: "Absent completed reviewer evidence blocks medical and dosage governed action.", sourceReferenceIds: ["coverage:map:matrix:medical-dosage-review:1"] }]);
  }, 30000);

  it("retains contract and resolved-human-source provenance without source bytes", async () => {
    const rule = compiled.rules.find((item) => item.ruleId === "internal-link:2e95944cae30906ded5c");

    expect(rule).toMatchObject({
      ruleId: "internal-link:2e95944cae30906ded5c",
      strategyVersion: "2026-07-12",
      packageSha256: compiled.packageSha256,
      contractRuleId: "internal-link:2e95944cae30906ded5c",
      sourceReferences: [{ coverageUnitId: expect.stringMatching(/^coverage:/), artifactId: "internal-links", locator: expect.any(Object), resolved: { artifactId: "internal-links", lineStart: expect.any(Number), lineEnd: expect.any(Number) } }],
      provenance: expect.any(Object),
    });
    expect(JSON.stringify(rule)).not.toContain("current_body_state");
    expect(JSON.stringify(rule)).not.toContain("bytes");
  }, 30000);

  it("normalizes governed URLs deterministically while preserving typed path and query", () => {
    expect(normalizeGovernedUrl("HTTPS://AGRIKOPH.COM:443/Path?Keep=Yes#fragment")).toBe("https://agrikoph.com/Path?Keep=Yes#fragment");
    expect(normalizeGovernedUrl("http://agrikoph.com:80/Path?Keep=Yes")).toBe("http://agrikoph.com/Path?Keep=Yes");
    expect(() => normalizeGovernedUrl("https://example.com/path")).toThrow(expect.objectContaining({ code: "EXTERNAL_GOVERNED_URL" }));
    for (const externalNetworkPath of ["//example.com/path", "///example.com/path", "/\\example.com/path"]) {
      expect(() => normalizeGovernedUrl(externalNetworkPath)).toThrow(expect.objectContaining({ code: "EXTERNAL_GOVERNED_URL" }));
    }
  });

  it("fails atomically on source drift, incomplete coverage, and activation-blocking ambiguity", async () => {
    const sourceDrift = minimalPackage();
    sourceDrift.artifacts.map.bytes[0] ^= 1;
    expect(() => compileStrategyPackage(sourceDrift)).toThrow(expect.objectContaining({ code: "SOURCE_HASH_MISMATCH" }));

    const incompleteCoverage = minimalPackage();
    const contract = JSON.parse(incompleteCoverage.artifacts["compilation-contract"].bytes.toString("utf8"));
    contract.coverageInventory.pop();
    incompleteCoverage.artifacts["compilation-contract"].bytes = Buffer.from(JSON.stringify(contract));
    expect(() => compileStrategyPackage(incompleteCoverage)).toThrow(expect.objectContaining({ code: "DANGLING_RULE_REFERENCE" }));

    const blockingAmbiguity = minimalPackage();
    const blockingContract = JSON.parse(blockingAmbiguity.artifacts["compilation-contract"].bytes.toString("utf8"));
    blockingContract.unresolvedAmbiguities = [{ ambiguityId: "ambiguity:block", classification: "activation_blocking", sourceReferences: [blockingContract.rules[0].sourceReferences[0]], unresolvedQuestion: "blocked", safeEffect: "blocks_governed_action", provenance: { recordedAt: "2026-07-12", reason: "test" } }];
    blockingAmbiguity.artifacts["compilation-contract"].bytes = Buffer.from(JSON.stringify(blockingContract));
    expect(() => compileStrategyPackage(blockingAmbiguity)).toThrow(expect.objectContaining({ code: "UNRESOLVED_ACTIVATION_BLOCKING_AMBIGUITY" }));
  }, 30000);

  it("is deeply deterministic and does not mutate supplied package bytes or objects", async () => {
    const raw = minimalPackage();
    const bytesBefore = Object.fromEntries(Object.entries(raw.artifacts).map(([id, artifact]: [string, any]) => [id, Buffer.from(artifact.bytes)]));
    const packageSha256 = raw.packageSha256;

    const first = compileStrategyPackage(raw);
    const second = compileStrategyPackage(raw);

    expect(first).toEqual(second);
    expect(raw.packageSha256).toBe(packageSha256);
    for (const [id, bytes] of Object.entries(bytesBefore)) expect(raw.artifacts[id].bytes).toEqual(bytes);
  }, 30000);
});
