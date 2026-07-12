import { createHash } from "node:crypto";
import { parseCompilationContract } from "./contract";
import type { CompiledRule, CompiledStrategyPackage } from "./compiler";
import type { RawStrategyPackage, StrategyArtifactId } from "./types";
import { REQUIRED_ARTIFACT_IDS } from "./types";
import { normalizeGovernedUrl } from "./url-normalizer";

export type ValidationIssueCode =
  | "MISSING_ARTIFACT"
  | "HASH_MISMATCH"
  | "INCOMPATIBLE_SCHEMA"
  | "CONFLICTING_INTENT_OWNER"
  | "ORPHANED_REFERENCE"
  | "REDIRECT_CONFLICT"
  | "CANONICAL_CONFLICT"
  | "MISSING_EVIDENCE_GATE"
  | "STALE_MANDATORY_EVIDENCE";

export interface ValidationIssue {
  code: ValidationIssueCode;
  blocking: true;
  ruleId: string | null;
  sourceArtifactId: StrategyArtifactId | null;
  sourceLocator: Record<string, unknown> | null;
}

export interface EvidenceFreshnessEntry {
  gateId: string;
  ruleId: string;
  mandatory: true;
  evidenceDate: string | null;
  maxAgeDays: 90 | 180;
  ageDays: number | null;
  status: "current" | "missing" | "stale";
  blockingReason: "MISSING_EVIDENCE_GATE" | "STALE_MANDATORY_EVIDENCE" | null;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
  blockingIssueCount: number;
  evidenceFreshness: EvidenceFreshnessEntry[];
}

export interface ValidateCompiledPackageInput {
  rawPackage: RawStrategyPackage;
  compiledPackage: CompiledStrategyPackage;
  asOf: string;
}

const supportedCompatibility = {
  runtimeSchema: ">=1.0.0 <2.0.0",
  pluginVersion: ">=0.1.0",
  siteHost: "agrikoph.com",
  urlNormalization: "agriko-url-v1",
} as const;
const dayMilliseconds = 24 * 60 * 60 * 1000;

function safeSource(rule: CompiledRule | undefined): Pick<ValidationIssue, "ruleId" | "sourceArtifactId" | "sourceLocator"> {
  const reference = rule?.sourceReferences[0];
  return {
    ruleId: rule?.ruleId ?? null,
    sourceArtifactId: reference?.artifactId ?? null,
    sourceLocator: reference ? structuredClone(reference.locator) : null,
  };
}

function issue(code: ValidationIssueCode, rule?: CompiledRule): ValidationIssue {
  return { code, blocking: true, ...safeSource(rule) };
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isExactCompatibility(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return Object.entries(supportedCompatibility).every(([key, expected]) => candidate[key] === expected)
    && Object.keys(candidate).length === Object.keys(supportedCompatibility).length;
}

function normalized(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return normalizeGovernedUrl(value);
  } catch {
    return null;
  }
}

function utcCalendarDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== value ? null : Math.floor(instant.getTime() / dayMilliseconds);
}

function utcAsOfDay(value: string): number | null {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : Math.floor(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()) / dayMilliseconds);
}

function evidenceEntries(compiledPackage: CompiledStrategyPackage, evidenceDate: unknown, asOf: string): Array<{ entry: EvidenceFreshnessEntry; rule: CompiledRule }> {
  const evidenceDay = typeof evidenceDate === "string" ? utcCalendarDay(evidenceDate) : null;
  const asOfDay = utcAsOfDay(asOf);
  const validDate = evidenceDay !== null && asOfDay !== null && evidenceDay <= asOfDay;
  const entries: Array<{ entry: EvidenceFreshnessEntry; rule: CompiledRule }> = [];

  for (const rule of compiledPackage.rules) {
    let requirementIndex = 0;
    for (const requirement of [...rule.conditions, ...rule.evidenceRequirements, ...rule.reviewRequirements]) {
      if (requirement.kind !== "source_required_evidence") continue;
      const ageDays = validDate ? asOfDay! - evidenceDay! : null;
      const status = ageDays === null ? "missing" : ageDays > requirement.maxAgeDays ? "stale" : "current";
      entries.push({
        rule,
        entry: {
          gateId: `${rule.ruleId}:evidence:${requirementIndex}`,
          ruleId: rule.ruleId,
          mandatory: true,
          evidenceDate: typeof evidenceDate === "string" ? evidenceDate : null,
          maxAgeDays: requirement.maxAgeDays,
          ageDays,
          status,
          blockingReason: status === "current" ? null : status === "missing" ? "MISSING_EVIDENCE_GATE" : "STALE_MANDATORY_EVIDENCE",
        },
      });
      requirementIndex += 1;
    }
  }
  return entries;
}

function rawContract(rawPackage: RawStrategyPackage): ReturnType<typeof parseCompilationContract> | null {
  const artifact = rawPackage.artifacts["compilation-contract"];
  if (!artifact) return null;
  try {
    return parseCompilationContract(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(artifact.bytes)));
  } catch {
    return null;
  }
}

export function validateCompiledPackage(input: ValidateCompiledPackageInput): ValidationReport {
  const { rawPackage, compiledPackage, asOf } = input;
  const issues: ValidationIssue[] = [];
  const seenIssues = new Set<string>();
  const add = (code: ValidationIssueCode, rule?: CompiledRule) => {
    const entry = issue(code, rule);
    const key = `${entry.code}\u0000${entry.ruleId ?? ""}\u0000${entry.sourceArtifactId ?? ""}\u0000${JSON.stringify(entry.sourceLocator)}`;
    if (!seenIssues.has(key)) { seenIssues.add(key); issues.push(entry); }
  };

  const fallbackRule = compiledPackage.rules[0];
  const artifacts = rawPackage.artifacts as Partial<Record<StrategyArtifactId, RawStrategyPackage["artifacts"][StrategyArtifactId]>>;
  const manifestArtifacts = new Map((Array.isArray(rawPackage.manifest?.artifacts) ? rawPackage.manifest.artifacts : []).map((artifact) => [artifact.id, artifact]));
  for (const id of REQUIRED_ARTIFACT_IDS) {
    const artifact = artifacts[id];
    const manifestArtifact = manifestArtifacts.get(id);
    if (!artifact || !manifestArtifact) { add("MISSING_ARTIFACT", fallbackRule); continue; }
    if (!Buffer.isBuffer(artifact.bytes) || typeof manifestArtifact.sha256 !== "string" || hash(artifact.bytes) !== manifestArtifact.sha256) add("HASH_MISMATCH", fallbackRule);
  }
  if (Object.keys(artifacts).length !== REQUIRED_ARTIFACT_IDS.length || manifestArtifacts.size !== REQUIRED_ARTIFACT_IDS.length) add("MISSING_ARTIFACT", fallbackRule);

  const contract = rawContract(rawPackage);
  if (rawPackage.manifest?.schemaVersion !== "1.0.0" || !isExactCompatibility(rawPackage.manifest?.compatibility) || !contract
    || contract.contractSchemaVersion !== "1.0.0" || !isExactCompatibility(contract.compatibility)
    || contract.strategyVersion !== rawPackage.manifest?.strategyVersion || contract.siteHost !== rawPackage.manifest?.compatibility?.siteHost
    || rawPackage.packageSha256 !== rawPackage.manifest?.packageSha256 || compiledPackage.strategyVersion !== rawPackage.manifest?.strategyVersion
    || compiledPackage.packageSha256 !== rawPackage.manifest?.packageSha256) add("INCOMPATIBLE_SCHEMA", fallbackRule);

  const coverageIds = new Set(compiledPackage.coverage.map((coverage) => coverage.coverageId));
  const expectedRuleIds = new Set(contract?.rules.map((rule) => rule.ruleId) ?? []);
  const expectedCoverageIds = new Set(contract?.coverageInventory.map((coverage) => coverage.coverageId) ?? []);
  const contractRules = new Map(contract?.rules.map((rule) => [rule.ruleId, rule]) ?? []);
  const contractCoverage = new Map(contract?.coverageInventory.map((coverage) => [coverage.coverageId, coverage]) ?? []);
  const ruleIds = new Set<string>();
  for (const rule of compiledPackage.rules) {
    if (ruleIds.has(rule.ruleId) || !expectedRuleIds.has(rule.ruleId)) add("ORPHANED_REFERENCE", rule);
    ruleIds.add(rule.ruleId);
    const expectedReferences = contractRules.get(rule.ruleId)?.sourceReferences ?? [];
    const expectedPairs = new Set(expectedReferences.map((reference) => `${reference.coverageUnitId}\u0000${reference.artifactId}`));
    const actualPairs = new Set(rule.sourceReferences.map((reference) => `${reference.coverageUnitId}\u0000${reference.artifactId}`));
    if (expectedPairs.size !== actualPairs.size || [...expectedPairs].some((pair) => !actualPairs.has(pair))) add("ORPHANED_REFERENCE", rule);
    for (const reference of rule.sourceReferences) if (!coverageIds.has(reference.coverageUnitId)) add("ORPHANED_REFERENCE", rule);
  }
  for (const coverage of compiledPackage.coverage) {
    if (!expectedCoverageIds.has(coverage.coverageId)) add("ORPHANED_REFERENCE", fallbackRule);
    const expectedRuleIdsForCoverage = new Set(contractCoverage.get(coverage.coverageId)?.ruleIds ?? []);
    const actualRuleIdsForCoverage = new Set(coverage.ruleIds);
    if (expectedRuleIdsForCoverage.size !== actualRuleIdsForCoverage.size || [...expectedRuleIdsForCoverage].some((ruleId) => !actualRuleIdsForCoverage.has(ruleId))) add("ORPHANED_REFERENCE", fallbackRule);
    for (const ruleId of coverage.ruleIds) if (!ruleIds.has(ruleId)) add("ORPHANED_REFERENCE", fallbackRule);
  }
  if (ruleIds.size !== expectedRuleIds.size || expectedRuleIds.size !== compiledPackage.rules.length || coverageIds.size !== expectedCoverageIds.size || expectedCoverageIds.size !== compiledPackage.coverage.length) add("ORPHANED_REFERENCE", fallbackRule);

  const owners = new Map<string, string>();
  const redirects = new Map<string, string>();
  const canonicals = new Map<string, string>();
  for (const rule of compiledPackage.rules) {
    const payload = rule.payload as Record<string, unknown>;
    if (rule.domain === "url_intent_ownership" && typeof payload.exclusiveIntentScope === "string") {
      const owner = normalized(payload.currentUrl);
      const prior = owners.get(payload.exclusiveIntentScope);
      if (!owner || (prior && prior !== owner)) add("CONFLICTING_INTENT_OWNER", rule);
      else owners.set(payload.exclusiveIntentScope, owner);
    }
    if (rule.domain === "redirects") {
      const source = normalized(payload.source);
      const target = normalized(payload.finalTarget);
      const prior = source ? redirects.get(source) : undefined;
      if (!source || !target || (prior && prior !== target)) add("REDIRECT_CONFLICT", rule);
      else redirects.set(source, target);
    }
    if (rule.domain === "canonicalization") {
      const source = normalized(payload.currentUrl);
      const target = normalized(payload.proposedCanonicalUrl);
      const prior = source ? canonicals.get(source) : undefined;
      if (!source || !target || (prior && prior !== target)) add("CANONICAL_CONFLICT", rule);
      else canonicals.set(source, target);
    }
  }

  const freshness = evidenceEntries(compiledPackage, rawPackage.manifest?.evidenceDate, asOf);
  for (const { entry, rule } of freshness) if (entry.blockingReason) add(entry.blockingReason, rule);
  const evidenceFreshness = freshness.map(({ entry }) => entry);
  return { valid: issues.length === 0, issues, blockingIssueCount: issues.length, evidenceFreshness };
}
