import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { createContentProposalOnce, type ContentProposalCreateData } from "@/lib/content-pilot/create-proposal";
import {
  evaluateStrategyPolicy,
  type ActiveStrategyPolicy,
  type StrategyComplianceResult,
} from "@/lib/topical-map/evaluator";
import type { CompiledRule, CompiledStrategyPackage } from "@/lib/topical-map/compiler";
import type { StrategyProposalCandidate } from "@/lib/topical-map/proposal-context";
import type { EvidenceFreshnessEntry, ValidationReport } from "@/lib/topical-map/validator";

const SITE_HOST = "agrikoph.com";
const EVALUATOR_SCHEMA_VERSION = "1.0.0";
const ARTIFACT_IDS = ["map", "evidence", "url-inventory", "redirect-inventory", "internal-links", "compilation-contract"] as const;

type Proposal = { id: string; proposalType?: string; title?: string };

export interface GovernedProposalPersistence {
  $transaction<T>(callback: (tx: GovernedProposalTransaction) => Promise<T>): Promise<T>;
  topicalMapActivation: GovernedProposalTransaction["topicalMapActivation"];
  contentProposal: GovernedProposalTransaction["contentProposal"];
  topicalMapProposalCompliance: GovernedProposalTransaction["topicalMapProposalCompliance"];
}

export interface ActiveStrategyPolicyReader {
  topicalMapActivation: {
    findUnique(args: unknown): Promise<unknown>;
  };
}

interface GovernedProposalTransaction extends ActiveStrategyPolicyReader {
  contentProposal: {
    findFirst?(args: { where: { proposalType: string; articleHandle: string }; orderBy: { createdAt: "asc" } }): Promise<Proposal | null>;
    createMany(args: { data: ContentProposalCreateData[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
    findUnique(args: { where: { dedupeKey: string } }): Promise<Proposal | null>;
  };
  topicalMapProposalCompliance: {
    create(args: { data: Prisma.TopicalMapProposalComplianceUncheckedCreateInput }): Promise<unknown>;
  };
}

export type GovernedProposalResult = {
  created: boolean;
  proposal: Proposal | null;
  compliance: StrategyComplianceResult;
};
export type ExpectedStrategyIdentity = { versionId: string; packageSha256: string };
export class StrategyChangedError extends Error {
  readonly code = "STRATEGY_CHANGED";
  constructor() { super("Active strategy changed before proposal persistence."); this.name = "StrategyChangedError"; }
}

type StoredStrategy = {
  id: string;
  strategyVersion: string;
  packageSha256: string;
  lifecycle: string;
  validationStatus: string;
  validationReport: unknown;
  artifacts: Array<{ artifactId: string; sha256: string }>;
  compiledRules: Array<{ compiledPayload: unknown }>;
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isEvidenceFreshness(value: unknown): value is EvidenceFreshnessEntry[] {
  return Array.isArray(value) && value.every((entry) => isRecord(entry)
    && typeof entry.gateId === "string"
    && typeof entry.ruleId === "string"
    && entry.mandatory === true
    && (typeof entry.evidenceDate === "string" || entry.evidenceDate === null)
    && (entry.maxAgeDays === 90 || entry.maxAgeDays === 180)
    && (typeof entry.ageDays === "number" || entry.ageDays === null)
    && (entry.status === "current" || entry.status === "missing" || entry.status === "stale")
    && (entry.blockingReason === "MISSING_EVIDENCE_GATE" || entry.blockingReason === "STALE_MANDATORY_EVIDENCE" || entry.blockingReason === null));
}

function validationReport(value: unknown): ValidationReport | null {
  if (!isRecord(value) || typeof value.valid !== "boolean" || !Array.isArray(value.issues)
    || typeof value.blockingIssueCount !== "number" || !isEvidenceFreshness(value.evidenceFreshness)) return null;
  return structuredClone(value) as unknown as ValidationReport;
}

function compiledRule(value: unknown): CompiledRule | null {
  if (!isRecord(value) || typeof value.ruleId !== "string" || typeof value.contractRuleId !== "string"
    || typeof value.domain !== "string" || !Array.isArray(value.conditions)
    || !Array.isArray(value.evidenceRequirements) || !Array.isArray(value.reviewRequirements)
    || !Array.isArray(value.sourceReferences) || !isRecord(value.payload)) return null;
  return structuredClone(value) as unknown as CompiledRule;
}

function activePolicy(value: unknown): { strategyVersionId: string; policy: ActiveStrategyPolicy } | null {
  if (!isRecord(value) || !isRecord(value.strategyVersion)) return null;
  const stored = value.strategyVersion as unknown as StoredStrategy;
  if (stored.lifecycle !== "active" || stored.validationStatus !== "valid"
    || !/^[a-f0-9]{64}$/.test(stored.packageSha256) || !stored.id || !stored.strategyVersion) return null;
  const ids = new Set(stored.artifacts.map((artifact) => artifact.artifactId));
  if (ids.size !== ARTIFACT_IDS.length || ARTIFACT_IDS.some((id) => !ids.has(id))) return null;
  const report = validationReport(stored.validationReport);
  const rules = stored.compiledRules.map((entry) => compiledRule(entry.compiledPayload));
  if (!report || rules.some((rule) => rule === null)) return null;
  const compiledRules = rules as CompiledRule[];
  if (compiledRules.some((rule) => rule.packageSha256 !== stored.packageSha256 || rule.strategyVersion !== stored.strategyVersion)) return null;
  const byDomain = Object.fromEntries([
    "clusters", "page_roles", "url_intent_ownership", "content_decisions", "prohibited_content", "internal_links", "redirects", "canonicalization", "indexation", "evidence_gates", "high_stakes_reviews",
  ].map((domain) => [domain, compiledRules.filter((rule) => rule.domain === domain)])) as CompiledStrategyPackage["byDomain"];
  return {
    strategyVersionId: stored.id,
    policy: {
      packageIdentity: {
        strategyVersion: stored.strategyVersion,
        packageSha256: stored.packageSha256,
        artifacts: stored.artifacts.map((artifact) => ({ id: artifact.artifactId as ActiveStrategyPolicy["packageIdentity"]["artifacts"][number]["id"], sha256: artifact.sha256 })),
      },
      compiledPackage: {
        strategyVersion: stored.strategyVersion,
        packageSha256: stored.packageSha256,
        integrity: {} as CompiledStrategyPackage["integrity"],
        coverage: [],
        rules: compiledRules,
        byDomain,
      },
      validationReport: report,
    },
  };
}

export async function loadActiveStrategyPolicy(tx: ActiveStrategyPolicyReader) {
  const activation = await tx.topicalMapActivation.findUnique({
    where: { siteHost: SITE_HOST },
    select: {
      strategyVersion: {
        select: {
          id: true, strategyVersion: true, packageSha256: true, lifecycle: true, validationStatus: true, validationReport: true,
          artifacts: { select: { artifactId: true, sha256: true } },
          compiledRules: { select: { compiledPayload: true } },
        },
      },
    },
  });
  return activePolicy(activation);
}

function projection(compliance: StrategyComplianceResult) {
  return {
    strategyVersion: compliance.packageIdentity?.strategyVersion ?? null,
    packageSha256: compliance.packageIdentity?.packageSha256 ?? null,
    result: compliance.result,
    reasonCodes: [...compliance.reasonCodes],
    matchedRules: structuredClone(compliance.matchedRules),
    evidenceFreshness: structuredClone(compliance.evidenceFreshness),
    requiredApprovals: [...compliance.requiredApprovals],
    evaluatorSchemaVersion: EVALUATOR_SCHEMA_VERSION,
    executionAuthorized: false as const,
  };
}

function candidateEntityId(candidate: StrategyProposalCandidate, proposalType: string): string {
  return createHash("sha256").update(JSON.stringify({ candidate, proposalType })).digest("hex");
}

async function persistNonProposalCompliance(tx: GovernedProposalTransaction, strategyVersionId: string, compliance: StrategyComplianceResult, candidate: StrategyProposalCandidate, proposalType: string) {
  const identity = compliance.packageIdentity;
  if (!identity) return;
  await tx.topicalMapProposalCompliance.create({
    data: {
      strategyVersionId,
      packageSha256: identity.packageSha256,
      entityType: "content_proposal_candidate",
      entityId: candidateEntityId(candidate, proposalType),
      proposalType,
      result: compliance.result,
      matchedRuleIds: json(compliance.matchedRules.map((rule) => rule.ruleId)),
      evidence: json(projection(compliance)),
      evidenceFreshness: json(compliance.evidenceFreshness),
      requiredGates: json(compliance.evidenceFreshness.map((entry) => entry.gateId)),
      requiredApprovals: json(compliance.requiredApprovals),
      evaluatorSchemaVersion: EVALUATOR_SCHEMA_VERSION,
    },
  });
}

export async function createGovernedContentProposal(
  db: GovernedProposalPersistence,
  input: { data: ContentProposalCreateData; candidate: StrategyProposalCandidate; expectedStrategy?: ExpectedStrategyIdentity },
): Promise<GovernedProposalResult> {
  return db.$transaction((tx) => createGovernedContentProposalInTransaction(tx, input));
}

export async function createGovernedContentProposalInTransaction(
  tx: GovernedProposalTransaction,
  input: { data: ContentProposalCreateData; candidate: StrategyProposalCandidate; expectedStrategy?: ExpectedStrategyIdentity },
): Promise<GovernedProposalResult> {
    const active = await loadActiveStrategyPolicy(tx);
    if (input.expectedStrategy && (!active || active.strategyVersionId !== input.expectedStrategy.versionId || active.policy.packageIdentity.packageSha256 !== input.expectedStrategy.packageSha256)) throw new StrategyChangedError();
    const compliance = evaluateStrategyPolicy(active?.policy ?? null, input.candidate);
    if (compliance.result !== "compliant" && compliance.result !== "needs_high_stakes_review") {
      if (active) await persistNonProposalCompliance(tx, active.strategyVersionId, compliance, input.candidate, input.data.proposalType);
      return { created: false, proposal: null, compliance };
    }

    const sourceData = isRecord(input.data.sourceData) ? structuredClone(input.data.sourceData) : {};
    const proposalData: ContentProposalCreateData = {
      ...input.data,
      sourceData: { ...sourceData, strategyCompliance: json(projection(compliance)) },
      ...(compliance.result === "needs_high_stakes_review" ? { status: "pending" } : {}),
    };
    const created = await createContentProposalOnce(tx, proposalData);
    if (!created.created) return { created: false, proposal: created.proposal, compliance };
    const identity = compliance.packageIdentity;
    if (!active || !identity) throw new Error("Governed proposal lost its active strategy identity.");
    await tx.topicalMapProposalCompliance.create({
      data: {
        strategyVersionId: active.strategyVersionId,
        packageSha256: identity.packageSha256,
        entityType: "content_proposal",
        entityId: created.proposal.id,
        proposalType: proposalData.proposalType,
        result: compliance.result,
        matchedRuleIds: json(compliance.matchedRules.map((rule) => rule.ruleId)),
        evidence: json(projection(compliance)),
        evidenceFreshness: json(compliance.evidenceFreshness),
        requiredGates: json(compliance.evidenceFreshness.map((entry) => entry.gateId)),
        requiredApprovals: json(compliance.requiredApprovals),
        evaluatorSchemaVersion: EVALUATOR_SCHEMA_VERSION,
        contentProposalId: created.proposal.id,
      },
    });
    return { created: true, proposal: created.proposal, compliance };
}
