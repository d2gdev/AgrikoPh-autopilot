import { describe, expect, it, vi } from "vitest";
import {
  createGovernedContentProposal,
  StrategyChangedError,
  type GovernedProposalPersistence,
} from "@/lib/topical-map/compliance-store";

const packageSha256 = "a".repeat(64);

function rule(input: Record<string, unknown>) {
  return {
    strategyVersion: "2026-07-12",
    packageSha256,
    ...input,
  };
}

function contentDecision(
  ruleId: string,
  currentUrl: string,
  decision: string,
) {
  return rule({
    ruleId,
    contractRuleId: ruleId,
    domain: "content_decisions",
    conditions: [],
    evidenceRequirements: [],
    reviewRequirements: [],
    resolutionStatus: "resolved",
    payload: { currentUrl, decision },
    sourceReferences: [],
  });
}

function activeStrategy(overrides: Record<string, unknown> = {}) {
  const { rules = [], ...rest } = overrides;
  return {
    id: "strategy-1",
    strategyVersion: "2026-07-12",
    packageSha256,
    lifecycle: "active",
    validationStatus: "valid",
    artifacts: ["map", "evidence", "url-inventory", "redirect-inventory", "internal-links", "compilation-contract"].map((artifactId) => ({ artifactId, sha256: artifactId })),
    validationReport: { valid: true, issues: [], blockingIssueCount: 0, evidenceFreshness: [] },
    compiledRules: (rules as unknown[]).map((compiledPayload) => ({ compiledPayload })),
    ...rest,
  };
}

function persistence(strategy: ReturnType<typeof activeStrategy> | null): GovernedProposalPersistence & { proposalRows: unknown[]; complianceRows: unknown[] } {
  const proposalRows: unknown[] = [];
  const complianceRows: unknown[] = [];
  const tx = {
    topicalMapActivation: { findUnique: vi.fn().mockResolvedValue(strategy ? { strategyVersion: strategy } : null) },
    contentProposal: {
      findFirst: vi.fn().mockResolvedValue(null),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => { proposalRows.push(...data); return { count: 1 }; }),
      findUnique: vi.fn().mockResolvedValue({ id: "proposal-1" }),
    },
    topicalMapProposalCompliance: {
      create: vi.fn(async ({ data }: { data: unknown }) => { complianceRows.push(data); return { id: "compliance-1" }; }),
    },
  };
  return {
    proposalRows,
    complianceRows,
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    ...tx,
  } as unknown as GovernedProposalPersistence & { proposalRows: unknown[]; complianceRows: unknown[] };
}

const data = {
  proposalType: "new-content",
  changeType: "create",
  priority: "P2",
  impact: "high",
  effort: "high",
  title: "New article: black rice guide",
  description: "Structured request",
  articleHandle: null,
  proposedState: { targetKeyword: "black rice guide" },
  sourceData: { trigger: "manual" },
};

describe("governed ContentProposal persistence", () => {
  it("rejects an activation change inside the proposal transaction", async () => {
    const db = persistence(activeStrategy({ id: "strategy-2", packageSha256: "b".repeat(64) }));
    await expect(createGovernedContentProposal(db, {
      data,
      candidate: { type: "content", action: "create", targetUrl: "/blogs/news/black-rice-guide" },
      expectedStrategy: { versionId: "strategy-1", packageSha256 },
    })).rejects.toBeInstanceOf(StrategyChangedError);
    expect(db.proposalRows).toEqual([]);
    expect(db.complianceRows).toEqual([]);
  });
  it("atomically stores a compliant proposal's complete package traceability in normalized and JSON storage", async () => {
    const db = persistence(activeStrategy({
      rules: [contentDecision("content-create", "/blogs/news/black-rice-guide", "create new article")],
    }));

    const result = await createGovernedContentProposal(db, {
      data,
      candidate: { type: "content", action: "create", targetUrl: "/blogs/news/black-rice-guide" },
    });

    expect(result).toMatchObject({ created: true, compliance: { result: "compliant", packageIdentity: { packageSha256 } } });
    expect(db.complianceRows).toEqual([expect.objectContaining({
      strategyVersionId: "strategy-1",
      packageSha256,
      contentProposalId: "proposal-1",
      matchedRuleIds: ["content-create"],
      evidenceFreshness: [],
      evaluatorSchemaVersion: "1.0.0",
    })]);
    expect(db.proposalRows).toEqual([expect.objectContaining({
      sourceData: expect.objectContaining({
        trigger: "manual",
        strategyCompliance: expect.objectContaining({ strategyVersion: "2026-07-12", packageSha256, result: "compliant", executionAuthorized: false }),
      }),
    })]);
  });

  it("rejects an owner conflict without creating a ContentProposal and returns inspectable evidence", async () => {
    const db = persistence(activeStrategy({ rules: [
      contentDecision("content-create", "/blogs/news/new-black-rice", "create new article"),
      rule({
        ruleId: "owner-1", contractRuleId: "owner-1", domain: "url_intent_ownership", conditions: [], evidenceRequirements: [], reviewRequirements: [],
        payload: { exclusiveIntentScope: "black-rice-benefits", currentUrl: "/blogs/news/black-rice-benefits" }, sourceReferences: [],
      }),
    ] }));

    const result = await createGovernedContentProposal(db, {
      data,
      candidate: { type: "content", action: "create", targetUrl: "/blogs/news/new-black-rice", exclusiveIntentScope: "black-rice-benefits" },
    });

    expect(result).toMatchObject({ created: false, compliance: { result: "conflict", reasonCodes: ["EXCLUSIVE_INTENT_OWNER_CONFLICT"] } });
    expect(db.proposalRows).toEqual([]);
    expect(db.complianceRows).toEqual([expect.objectContaining({
      entityType: "content_proposal_candidate",
      result: "conflict",
      matchedRuleIds: ["owner-1"],
    })]);
  });

  it("fails closed when no complete active strategy is available", async () => {
    const db = persistence(null);

    const result = await createGovernedContentProposal(db, { data, candidate: { type: "content", action: "create", targetUrl: "/blogs/news/black-rice-guide" } });

    expect(result).toMatchObject({ created: false, compliance: { result: "unavailable_strategy", packageIdentity: null } });
    expect(db.proposalRows).toEqual([]);
  });

  it("does not create when persisted mandatory evidence is stale or missing", async () => {
    const db = persistence(activeStrategy({ validationReport: {
      valid: false, issues: [], blockingIssueCount: 1,
      evidenceFreshness: [{ gateId: "gate-1", ruleId: "rule-1", mandatory: true, evidenceDate: "2025-01-01", maxAgeDays: 180, ageDays: 500, status: "stale", blockingReason: "STALE_MANDATORY_EVIDENCE" }],
    } }));

    const result = await createGovernedContentProposal(db, { data, candidate: { type: "content", action: "create", targetUrl: "/blogs/news/black-rice-guide" } });

    expect(result).toMatchObject({ created: false, compliance: { result: "needs_evidence", reasonCodes: ["STALE_MANDATORY_EVIDENCE"] } });
    expect(db.proposalRows).toEqual([]);
  });

  it("keeps high-stakes work pending while recording required manual review metadata", async () => {
    const db = persistence(activeStrategy({ rules: [
      contentDecision("metadata", "/blogs/news/dosage", "refresh SEO metadata"),
      rule({ ruleId: "medical", contractRuleId: "medical", domain: "high_stakes_reviews", conditions: [], evidenceRequirements: [], reviewRequirements: [], payload: {}, sourceReferences: [] }),
    ] }));

    const result = await createGovernedContentProposal(db, {
      data,
      candidate: { type: "seo_metadata", targetUrl: "/blogs/news/dosage", highStakesTopics: ["dosage"] },
    });

    expect(result).toMatchObject({ created: true, compliance: { result: "needs_high_stakes_review", requiredApprovals: ["manual_high_stakes_review"] } });
    expect(db.proposalRows).toEqual([expect.objectContaining({ status: "pending", sourceData: expect.objectContaining({ strategyCompliance: expect.objectContaining({ requiredApprovals: ["manual_high_stakes_review"], executionAuthorized: false }) }) })]);
  });

  it("rolls back the proposal when compliance persistence fails", async () => {
    const db = persistence(activeStrategy({
      rules: [contentDecision("content-create", "/blogs/news/black-rice-guide", "create new article")],
    }));
    const transaction = db.$transaction as ReturnType<typeof vi.fn>;
    transaction.mockImplementationOnce(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        topicalMapActivation: db.topicalMapActivation,
        contentProposal: {
          ...db.contentProposal,
          createMany: vi.fn(async () => ({ count: 1 })),
          findUnique: vi.fn().mockResolvedValue({ id: "proposal-1" }),
        },
        topicalMapProposalCompliance: { create: vi.fn().mockRejectedValue(new Error("compliance failure")) },
      };
      return callback(tx);
    });

    await expect(createGovernedContentProposal(db, { data, candidate: { type: "content", action: "create", targetUrl: "/blogs/news/black-rice-guide" } })).rejects.toThrow("compliance failure");
    expect(db.proposalRows).toEqual([]);
  });
});
