import { describe, it, expect, vi, beforeEach } from "vitest";

// Dynamic imports used by executeApprovedHandler require doMock before import
// We use static vi.mock here for the stable imports; dynamic imports are
// handled by mocking the module path that vi.mock intercepts.

vi.mock("@/lib/db", () => ({
  prisma: {
    recommendation: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    rawSnapshot: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
    jobRun: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/guardrails", () => ({
  checkGuardrails: vi.fn().mockResolvedValue({ status: "allow" }),
}));

vi.mock("@/lib/executor", () => ({
  executeRecommendation: vi.fn().mockResolvedValue({ success: true }),
  isSupportedAction: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/connectors/meta", () => ({
  executeMetaAction: vi.fn(),
  fetchMetaEntityState: vi.fn().mockResolvedValue({}),
}));

import { prisma } from "@/lib/db";
import { checkGuardrails } from "@/lib/guardrails";
import { executeRecommendation } from "@/lib/executor";
import { executeApprovedHandler, resolveExecutionMode } from "@/jobs/execute-approved";
import { MetaApiError } from "@/lib/connectors/meta-errors";

const mockPrisma = prisma as unknown as {
  recommendation: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  auditLog: { create: ReturnType<typeof vi.fn> };
  rawSnapshot: { findUnique: ReturnType<typeof vi.fn> };
  jobRun: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

const mockCheckGuardrails = checkGuardrails as ReturnType<typeof vi.fn>;
const mockExecuteRecommendation = executeRecommendation as ReturnType<typeof vi.fn>;

function executeLive() {
  process.env.EXECUTE_APPROVED_LIVE_ENABLED = "true";
  return executeApprovedHandler({ liveRequested: true });
}

const baseRec = {
  id: "rec-1",
  platform: "meta",
  status: "approved",
  guardStatus: "allow",
  actionType: "adjust_budget",
  targetEntityType: "campaign",
  targetEntityId: "camp-123",
  targetEntityName: "Test Campaign",
  currentValue: "1000",
  proposedValue: "1200",
  changePercent: 20,
  confidenceScore: 0.85,
  rationale: "High ROAS",
  snapshotId: "snap-1",
  reviewedAt: new Date(),
  updatedAt: new Date(Date.now() - 60_000), // 1 min ago — not stale
};

const metaSnapshot = {
  id: "snap-1",
  source: "meta",
  payload: {
    campaigns: [{ id: "camp-123", daily_budget: "100000", conversions: 50 }],
    adSets: [],
    insights: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.EXECUTE_APPROVED_LIVE_ENABLED;

  // Default: no stale records, no approved records
  mockPrisma.recommendation.findMany.mockResolvedValue([]);
  mockPrisma.recommendation.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.recommendation.update.mockResolvedValue({});
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.rawSnapshot.findUnique.mockResolvedValue(metaSnapshot);
  mockPrisma.jobRun.create.mockResolvedValue({ id: "job-run-1" });
  mockPrisma.jobRun.update.mockResolvedValue({});
  mockPrisma.$transaction.mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) {
      return Promise.all(ops);
    }
    if (typeof ops === "function") {
      return ops(mockPrisma);
    }
    return ops;
  });
  mockCheckGuardrails.mockResolvedValue({ status: "allow" });
  mockExecuteRecommendation.mockResolvedValue({ success: true });
});

describe("executeApprovedHandler", () => {
  it("requires both explicit live intent and the server gate", () => {
    expect(resolveExecutionMode()).toEqual({ liveEnabled: false, dryRun: true });
    expect(resolveExecutionMode(true)).toEqual({ liveEnabled: false, dryRun: true });

    process.env.EXECUTE_APPROVED_LIVE_ENABLED = "true";
    expect(resolveExecutionMode()).toEqual({ liveEnabled: true, dryRun: true });
    expect(resolveExecutionMode(true)).toEqual({ liveEnabled: true, dryRun: false });
  });

  it("defaults to dry-run even when called directly", async () => {
    await executeApprovedHandler();

    expect(mockPrisma.jobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dryRun: true }),
    });
    expect(mockExecuteRecommendation).not.toHaveBeenCalled();
  });

  it("keeps an explicit live request in dry-run when the server gate is disabled", async () => {
    await executeApprovedHandler({ liveRequested: true });

    expect(mockPrisma.jobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dryRun: true }),
    });
  });

  describe("happy path", () => {
    it("calls executeRecommendation and marks status as executed with audit log", async () => {
      mockPrisma.recommendation.findMany
        .mockResolvedValueOnce([]) // stale query returns empty
        .mockResolvedValueOnce([baseRec]); // approved query returns one rec

      await executeLive();

      expect(mockExecuteRecommendation).toHaveBeenCalledWith(baseRec);
      // $transaction should have been called with the executed status update
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      const txCalls = mockPrisma.$transaction.mock.calls;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const lastTxArgs = txCalls.at(-1)![0] as unknown[];
      // The last transaction should include both a recommendation.update and auditLog.create
      expect(lastTxArgs).toHaveLength(2);
    });
  });

  describe("optimistic lock (race condition)", () => {
    it("skips execution when updateMany returns count === 0", async () => {
      mockPrisma.recommendation.findMany
        .mockResolvedValueOnce([]) // stale
        .mockResolvedValueOnce([baseRec]); // approved
      mockPrisma.recommendation.updateMany.mockResolvedValue({ count: 0 }); // locked by another process

      await executeLive();

      expect(mockExecuteRecommendation).not.toHaveBeenCalled();
      // No $transaction for execution — should not have set status to executed
      const txCalls = mockPrisma.$transaction.mock.calls;
      // Only stale recovery transaction (if any) — no execution transaction
      expect(txCalls.length).toBe(0);
    });
  });

  describe("guardrail re-block", () => {
    it("sets status to failed and does NOT call connector when guardrail returns hard_block", async () => {
      mockPrisma.recommendation.findMany
        .mockResolvedValueOnce([]) // stale
        .mockResolvedValueOnce([baseRec]); // approved
      mockCheckGuardrails.mockResolvedValue({ status: "hard_block", reason: "Conversion count too low" });

      await executeLive();

      expect(mockExecuteRecommendation).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      const txCalls = mockPrisma.$transaction.mock.calls;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const lastArgs = txCalls.at(-1)![0] as unknown[];
      // Should have two ops: recommendation.update (failed) and auditLog.create
      expect(lastArgs).toHaveLength(2);
    });

    it("does NOT re-check guardrails for override_approved recommendations", async () => {
      const overrideRec = { ...baseRec, status: "override_approved" };
      mockPrisma.recommendation.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([overrideRec]);

      await executeLive();

      expect(mockCheckGuardrails).not.toHaveBeenCalled();
      expect(mockExecuteRecommendation).toHaveBeenCalledWith(overrideRec);
    });
  });

  describe("connector failure", () => {
    it("sets status to failed and records error in audit log when connector throws", async () => {
      mockPrisma.recommendation.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([baseRec]);
      mockExecuteRecommendation.mockRejectedValue(new Error("API timeout"));

      await executeLive();

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      const txCalls = mockPrisma.$transaction.mock.calls;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const lastArgs = txCalls.at(-1)![0] as unknown[];
      // Should have two ops: recommendation.update (failed) + auditLog.create (execution_failed)
      expect(lastArgs).toHaveLength(2);
    });

    it("skips remaining Meta recs after a global non-transient Meta error", async () => {
      const recA = { ...baseRec, id: "rec-meta-a", platform: "meta", actionType: "pause_ad" };
      const recB = { ...baseRec, id: "rec-meta-b", platform: "meta", actionType: "pause_ad" };
      mockPrisma.recommendation.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([recA, recB]);
      mockExecuteRecommendation.mockRejectedValueOnce(new MetaApiError({
        httpStatus: 400,
        message: "Meta API error 400: Permissions error",
        code: 200,
        subcode: 2490592,
        isTransient: false,
      }));

      await executeLive();

      expect(mockExecuteRecommendation).toHaveBeenCalledTimes(1);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          action: "execution_skipped_connector_disabled",
          entityId: "rec-meta-b",
        }),
      }));
      expect(mockPrisma.jobRun.update).toHaveBeenLastCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          errorLog: expect.stringContaining("Meta disabled for this run"),
        }),
      }));
    });
  });

  describe("stale execution recovery", () => {
    it("resets locked-but-old records to failed before running approved recs", async () => {
      const staleRec = { id: "rec-stale", status: "executing" };
      mockPrisma.recommendation.findMany
        .mockResolvedValueOnce([staleRec]) // stale query returns one
        .mockResolvedValueOnce([]); // no approved to run

      await executeLive();

      // $transaction called for stale recovery (updateMany + auditLog.create per stale rec)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // Executor should not be called — no approved recs
      expect(mockExecuteRecommendation).not.toHaveBeenCalled();
    });
  });

});
