import { createHash } from "node:crypto";
import { resolveSourceLocator } from "./locator-resolver";
import type { CompilationContract } from "./contract";
import type { RawStrategyPackage, SemanticSourceArtifactId } from "./types";

export type CompilationContractIntegrityErrorCode =
  | "SOURCE_HASH_MISMATCH"
  | "MISSING_COVERAGE_ID"
  | "DUPLICATE_COVERAGE_ID"
  | "MISSING_RULE_ID"
  | "DUPLICATE_RULE_ID"
  | "MISSING_AMBIGUITY_ID"
  | "DUPLICATE_AMBIGUITY_ID"
  | "UNDISPOSED_COVERAGE"
  | "UNDISCLOSED_SOURCE_COVERAGE"
  | "UNANCHORED_RULE"
  | "DANGLING_RULE_REFERENCE"
  | "COVERAGE_REFERENCE_MISMATCH"
  | "CONFLICTING_EXCLUSIVE_MAPPING"
  | "UNRESOLVED_ACTIVATION_BLOCKING_AMBIGUITY";

export class CompilationContractIntegrityError extends Error {
  constructor(public readonly code: CompilationContractIntegrityErrorCode) {
    super("Compilation contract integrity validation failed.");
    this.name = "CompilationContractIntegrityError";
  }
}

export interface CompilationContractIntegrityResult {
  coverageUnitCount: number;
  ruleCount: number;
  sourceRowCounts: Record<"url-inventory" | "redirect-inventory" | "internal-links", number>;
}

const semanticIds: SemanticSourceArtifactId[] = ["map", "evidence", "url-inventory", "redirect-inventory", "internal-links"];
const csvIds = ["url-inventory", "redirect-inventory", "internal-links"] as const;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
type ContractCoverage = CompilationContract["coverageInventory"][number];
const locatorFingerprint = (locator: ContractCoverage["locator"]) => locator.kind === "csv_row" ? locator.rowFingerprint : locator.contentFingerprint;
const isCsvId = (id: SemanticSourceArtifactId): id is typeof csvIds[number] => csvIds.includes(id as typeof csvIds[number]);

function ensureUnique(values: string[], code: CompilationContractIntegrityErrorCode) {
  if (new Set(values).size !== values.length) throw new CompilationContractIntegrityError(code);
}

function ensureIdentifiers(values: unknown[], code: CompilationContractIntegrityErrorCode) {
  if (values.some((value) => typeof value !== "string" || value.length === 0)) throw new CompilationContractIntegrityError(code);
}

function csvRecordCount(bytes: Buffer): number {
  const text = bytes.toString("utf8").replace(/\r\n?/g, "\n");
  let records = 0;
  let quoted = false;
  let hasContent = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { index += 1; hasContent = true; continue; }
      quoted = !quoted;
      hasContent = true;
      continue;
    }
    if (character === "\n" && !quoted) {
      if (hasContent) records += 1;
      hasContent = false;
      continue;
    }
    hasContent ||= character.trim() !== "";
  }
  if (hasContent) records += 1;
  return Math.max(0, records - 1);
}

function ensureCoverageDisposition(coverage: ContractCoverage) {
  if (!coverage.disposition || !["compiled", "contextual_non_runtime", "unresolved_activation_blocking", "superseded"].includes(coverage.disposition)) throw new CompilationContractIntegrityError("UNDISPOSED_COVERAGE");
}

export function validateCompilationContractIntegrity(input: { rawPackage: RawStrategyPackage; contract: CompilationContract }): CompilationContractIntegrityResult {
  const { rawPackage, contract } = input;
  for (const id of semanticIds) {
    const source = contract.sourceArtifacts.find((artifact) => artifact.id === id);
    if (!source || sha256(rawPackage.artifacts[id].bytes) !== source.sha256) throw new CompilationContractIntegrityError("SOURCE_HASH_MISMATCH");
  }

  const coverageIds = contract.coverageInventory.map((coverage) => coverage.coverageId);
  const ruleIds = contract.rules.map((rule) => rule.ruleId);
  const ambiguityIds = contract.unresolvedAmbiguities.map((ambiguity) => ambiguity.ambiguityId);
  ensureIdentifiers(coverageIds, "MISSING_COVERAGE_ID");
  ensureIdentifiers(ruleIds, "MISSING_RULE_ID");
  ensureIdentifiers(ambiguityIds, "MISSING_AMBIGUITY_ID");
  ensureUnique(coverageIds, "DUPLICATE_COVERAGE_ID");
  ensureUnique(ruleIds, "DUPLICATE_RULE_ID");
  ensureUnique(ambiguityIds, "DUPLICATE_AMBIGUITY_ID");
  contract.coverageInventory.forEach(ensureCoverageDisposition);

  const coverageById = new Map(contract.coverageInventory.map((coverage) => [coverage.coverageId, coverage]));
  const ruleById = new Map(contract.rules.map((rule) => [rule.ruleId, rule]));
  const coverageReferencePairs = new Set<string>();
  const coveredCsvLines = new Map(csvIds.map((id) => [id, new Set<number>()]));
  for (const coverage of contract.coverageInventory) {
    const resolved = resolveSourceLocator({ artifactId: coverage.artifactId, bytes: rawPackage.artifacts[coverage.artifactId].bytes, locator: coverage.locator });
    if (coverage.locator.kind === "csv_row" && isCsvId(coverage.artifactId)) coveredCsvLines.get(coverage.artifactId)?.add(resolved.lineStart);
    for (const ruleId of coverage.ruleIds) {
      if (!ruleById.has(ruleId)) throw new CompilationContractIntegrityError("DANGLING_RULE_REFERENCE");
      coverageReferencePairs.add(`${coverage.coverageId}\u0000${ruleId}`);
    }
  }

  const sourceRowCounts = Object.fromEntries(csvIds.map((id) => [id, csvRecordCount(rawPackage.artifacts[id].bytes)])) as CompilationContractIntegrityResult["sourceRowCounts"];
  for (const id of csvIds) {
    if (contract.coverageInventory.filter((coverage) => coverage.artifactId === id).length !== sourceRowCounts[id] || coveredCsvLines.get(id)?.size !== sourceRowCounts[id]) throw new CompilationContractIntegrityError("UNDISCLOSED_SOURCE_COVERAGE");
  }

  const ruleReferencePairs = new Set<string>();
  for (const rule of contract.rules) {
    if (!rule.sourceReferences.length) throw new CompilationContractIntegrityError("UNANCHORED_RULE");
    for (const reference of rule.sourceReferences) {
      const coverage = coverageById.get(reference.coverageUnitId);
      if (!coverage || coverage.artifactId !== reference.artifactId) throw new CompilationContractIntegrityError("DANGLING_RULE_REFERENCE");
      resolveSourceLocator({ artifactId: reference.artifactId, bytes: rawPackage.artifacts[reference.artifactId].bytes, locator: reference.locator });
      if (!rule.sourceFingerprints.includes(locatorFingerprint(reference.locator))) throw new CompilationContractIntegrityError("UNANCHORED_RULE");
      ruleReferencePairs.add(`${reference.coverageUnitId}\u0000${rule.ruleId}`);
    }
  }
  if (coverageReferencePairs.size !== ruleReferencePairs.size || [...coverageReferencePairs].some((pair) => !ruleReferencePairs.has(pair))) throw new CompilationContractIntegrityError("COVERAGE_REFERENCE_MISMATCH");

  const exclusiveOwners = new Map<string, string>();
  for (const rule of contract.rules) {
    if (rule.domain !== "url_intent_ownership") continue;
    const payload = rule.payload as { exclusiveIntentScope?: unknown; currentUrl?: unknown };
    if (typeof payload.exclusiveIntentScope !== "string" || typeof payload.currentUrl !== "string") continue;
    const previous = exclusiveOwners.get(payload.exclusiveIntentScope);
    if (previous && previous !== payload.currentUrl) throw new CompilationContractIntegrityError("CONFLICTING_EXCLUSIVE_MAPPING");
    exclusiveOwners.set(payload.exclusiveIntentScope, payload.currentUrl);
  }

  if (contract.unresolvedAmbiguities.some((ambiguity) => ambiguity.classification === "activation_blocking")) throw new CompilationContractIntegrityError("UNRESOLVED_ACTIVATION_BLOCKING_AMBIGUITY");
  return { coverageUnitCount: contract.coverageInventory.length, ruleCount: contract.rules.length, sourceRowCounts };
}
