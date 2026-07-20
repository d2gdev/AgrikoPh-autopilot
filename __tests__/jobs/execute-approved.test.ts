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
    storeTask: { update: vi.fn(), updateMany: vi.fn() },
    storeTaskExecutionLock: { deleteMany: vi.fn() },
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

const storeDispatch = vi.hoisted(() => ({ dispatch: vi.fn(), recover: vi.fn(), receiptJson: vi.fn((value) => value) }));
vi.mock("@/lib/store-tasks/apply-topical-map", () => ({ dispatchClaimedTopicalMapStoreTask: storeDispatch.dispatch, reobserveTopicalMapReceipt: storeDispatch.recover, receiptJson: storeDispatch.receiptJson }));
const homepageDispatch = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("@/lib/recommendations/homepage-schema", () => ({
  applyApprovedHomepageSchemaRecommendation: homepageDispatch.apply,
}));
const robotsDispatch = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("@/lib/recommendations/robots-sitemap", () => ({
  applyApprovedRobotsSitemapRecommendation: robotsDispatch.apply,
}));
const themeSourceDispatch = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("@/lib/recommendations/theme-source-sync", () => ({
  applyApprovedThemeSourceSyncRecommendation: themeSourceDispatch.apply,
}));
const themeCacheFlushDispatch = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("@/lib/recommendations/theme-cache-flush", () => ({
  applyApprovedThemeCacheFlushRecommendation: themeCacheFlushDispatch.apply,
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
  storeTask: { update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  storeTaskExecutionLock: { deleteMany: ReturnType<typeof vi.fn> };
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
  mockPrisma.storeTask.update.mockResolvedValue({});
  mockPrisma.storeTask.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.storeTaskExecutionLock.deleteMany.mockResolvedValue({ count: 1 });
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
  storeDispatch.dispatch.mockResolvedValue({ taskId: "task-1", recommendationId: "rec-shopify", targetId: "gid://shopify/Product/1", targetUrl: "/products/rice", targetType: "product", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["rule-1"], action: "seo_update", changedFields: ["seoTitle"], proposedStateHash: "b".repeat(64), shopifyReturnedStateHash: "c".repeat(64), verifiedAt: new Date().toISOString() });
  storeDispatch.recover.mockResolvedValue(null);
  homepageDispatch.apply.mockResolvedValue({
    themeId: "gid://shopify/OnlineStoreTheme/123",
    assetKey: "snippets/schema-global-jsonld.liquid",
    beforeSha256: "a".repeat(64),
    afterSha256: "b".repeat(64),
  });
  robotsDispatch.apply.mockResolvedValue({
    themeId: "gid://shopify/OnlineStoreTheme/123",
    assetKey: "templates/robots.txt.liquid",
    beforeSha256: "c".repeat(64),
    afterSha256: "d".repeat(64),
  });
  themeSourceDispatch.apply.mockResolvedValue({
    themeId: "gid://shopify/OnlineStoreTheme/123",
    sourceCommit: "8ff4626583861e70a542a2b51f67989429d52ea3",
    assetCount: 3,
    alreadyApplied: false,
  });
  themeCacheFlushDispatch.apply.mockResolvedValue({
    sourceThemeId: "gid://shopify/OnlineStoreTheme/123",
    publishedThemeId: "gid://shopify/OnlineStoreTheme/456",
    duplicateName: "autopilot-cache-flush-2026-07-20-02-30-00",
    sourceCommit: "8ff4626583861e70a542a2b51f67989429d52ea3",
    alreadyApplied: false,
  });
});

describe("executeApprovedHandler", () => {
  it("preserves the scheduled ordered batch selection when no recommendation id is supplied", async () => {
    await executeApprovedHandler({ liveRequested: false, triggeredBy: "scheduler" });

    expect(mockPrisma.recommendation.findMany).toHaveBeenLastCalledWith({
      where: { status: { in: ["approved", "override_approved"] } },
      take: 10,
      orderBy: { reviewedAt: "asc" },
    });
  });

  it("jointly finalizes governed Shopify task and recommendation from a minimal receipt", async () => {
    const shopify = { ...baseRec, id: "rec-shopify", platform: "shopify", actionType: "apply_topical_map_store_task", targetEntityId: "task-1", targetEntityType: "store_task", status: "approved" };
    mockPrisma.recommendation.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([shopify]);
    await executeLive();
    expect(storeDispatch.dispatch).toHaveBeenCalledWith(mockPrisma, expect.objectContaining({ id: "rec-shopify", status: "executing" }));
    expect(mockPrisma.storeTask.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed", executionReceipt: expect.any(Object) }) }));
    expect((mockPrisma.$transaction.mock.calls.at(-1)![0] as unknown[])).toHaveLength(5);
  });

  it("executes the exact governed homepage schema recommendation", async () => {
    const shopify = {
      ...baseRec,
      id: "rec-home-schema",
      platform: "shopify",
      actionType: "remove_homepage_offer_catalog",
      targetEntityId: "gid://shopify/OnlineStoreTheme/123:snippets/schema-global-jsonld.liquid",
      targetEntityType: "theme_asset",
      status: "approved",
    };
    mockPrisma.recommendation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([shopify]);

    await executeLive();

    expect(homepageDispatch.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rec-home-schema", status: "executing" }),
    );
    expect(mockPrisma.recommendation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-home-schema" },
        data: expect.objectContaining({ status: "executed" }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "homepage_schema_applied" }),
      }),
    );
  });

  it("executes the exact governed robots sitemap recommendation", async () => {
    const shopify = {
      ...baseRec,
      id: "rec-robots-sitemap",
      platform: "shopify",
      actionType: "fix_robots_sitemap_url",
      targetEntityId: "gid://shopify/OnlineStoreTheme/123:templates/robots.txt.liquid",
      targetEntityType: "theme_asset",
      status: "approved",
    };
    mockPrisma.recommendation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([shopify]);

    await executeLive();

    expect(robotsDispatch.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rec-robots-sitemap",
        status: "executing",
      }),
    );
    expect(mockPrisma.recommendation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-robots-sitemap" },
        data: expect.objectContaining({ status: "executed" }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "robots_sitemap_applied" }),
      }),
    );
  });

  it("executes the exact governed theme source-sync recommendation", async () => {
    const shopify = {
      ...baseRec,
      id: "rec-theme-source-sync",
      platform: "shopify",
      actionType: "sync_theme_source_assets",
      targetEntityId: "gid://shopify/OnlineStoreTheme/123:source-sync:8ff4626583861e70a542a2b51f67989429d52ea3",
      targetEntityType: "theme_asset_set",
      status: "approved",
    };
    mockPrisma.recommendation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([shopify]);

    await executeLive();

    expect(themeSourceDispatch.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rec-theme-source-sync",
        status: "executing",
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "theme_source_assets_applied" }),
      }),
    );
  });

  it("executes only the exact governed theme cache-flush recommendation", async () => {
    const shopify = {
      ...baseRec,
      id: "rec-theme-cache-flush",
      platform: "shopify",
      actionType: "flush_shopify_theme_page_cache",
      targetEntityId:
        "gid://shopify/OnlineStoreTheme/123:cache-flush:"
        + "8ff4626583861e70a542a2b51f67989429d52ea3:"
        + "autopilot-cache-flush-2026-07-20-02-30-00",
      targetEntityType: "published_theme",
      status: "approved",
    };
    mockPrisma.recommendation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([shopify]);
    process.env.EXECUTE_APPROVED_LIVE_ENABLED = "true";

    await executeApprovedHandler({
      liveRequested: true,
      recommendationId: shopify.id,
      triggeredBy: "operator",
    });

    expect(mockPrisma.recommendation.findMany).toHaveBeenLastCalledWith({
      where: {
        status: { in: ["approved", "override_approved"] },
        id: shopify.id,
      },
      take: 1,
      orderBy: { reviewedAt: "asc" },
    });
    expect(themeCacheFlushDispatch.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rec-theme-cache-flush",
        status: "executing",
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "theme_page_cache_flushed",
          entityId: "rec-theme-cache-flush",
        }),
      }),
    );
  });

  it("reconciles a stale theme cache flush from exact Shopify state", async () => {
    const stale = {
      ...baseRec,
      id: "rec-theme-cache-flush-stale",
      platform: "shopify",
      actionType: "flush_shopify_theme_page_cache",
      status: "executing",
      updatedAt: new Date(0),
    };
    mockPrisma.recommendation.findMany
      .mockResolvedValueOnce([stale])
      .mockResolvedValueOnce([]);

    await executeLive();

    expect(themeCacheFlushDispatch.apply).toHaveBeenCalledWith(stale);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "theme_cache_flush_execution_timeout_reconciled",
        }),
      }),
    );
  });

  it("reconciles a stale robots sitemap execution from exact Shopify state", async () => {
    const stale = {
      ...baseRec,
      id: "rec-robots-stale",
      platform: "shopify",
      actionType: "fix_robots_sitemap_url",
      status: "executing",
      updatedAt: new Date(0),
    };
    mockPrisma.recommendation.findMany
      .mockResolvedValueOnce([stale])
      .mockResolvedValueOnce([]);

    await executeLive();

    expect(robotsDispatch.apply).toHaveBeenCalledWith(stale);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "robots_sitemap_execution_timeout_reconciled",
        }),
      }),
    );
  });

  it("records reconciliation need if robots write succeeds before finalization fails", async () => {
    const shopify = {
      ...baseRec,
      id: "rec-robots-reconcile",
      platform: "shopify",
      actionType: "fix_robots_sitemap_url",
      targetEntityType: "theme_asset",
      status: "approved",
    };
    mockPrisma.recommendation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([shopify]);
    mockPrisma.$transaction.mockRejectedValueOnce(new Error("commit failed"));

    await executeLive();

    expect(mockPrisma.recommendation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-robots-reconcile", status: "executing" },
        data: expect.objectContaining({
          executionResult: expect.objectContaining({
            reconciliationNeeded: true,
          }),
        }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "robots_sitemap_reconciliation_needed",
        }),
      }),
    );
  });

  it("marks reconciliation needed when joint finalization fails after verified Shopify success", async () => {
    const shopify = { ...baseRec, id: "rec-shopify", platform: "shopify", actionType: "apply_topical_map_store_task", targetEntityId: "task-1", targetEntityType: "store_task", status: "approved" };
    mockPrisma.recommendation.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([shopify]);
    mockPrisma.$transaction.mockRejectedValueOnce(new Error("commit failed"));
    await executeLive();
    expect(mockPrisma.storeTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "reconciliation_needed", executionReceipt: expect.any(Object) }) }));
    expect(mockPrisma.recommendation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ executionResult: expect.any(Object) }) }));
  });

  it("reobserves stale governed execution and jointly finalizes when Shopify has the exact after-state", async () => {
    const stale = { ...baseRec, id: "rec-stale", platform: "shopify", actionType: "apply_topical_map_store_task", targetEntityId: "task-1", status: "executing", updatedAt: new Date(0) };
    const receipt = { taskId: "task-1", recommendationId: "rec-stale", targetUrl: "/products/rice" };
    mockPrisma.recommendation.findMany.mockResolvedValueOnce([stale]).mockResolvedValueOnce([]);
    storeDispatch.recover.mockResolvedValue(receipt);
    await executeLive();
    expect(storeDispatch.recover).toHaveBeenCalledWith(mockPrisma, stale);
    expect(mockPrisma.storeTask.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }));
    expect(mockPrisma.storeTaskExecutionLock.deleteMany).toHaveBeenCalledWith({ where: { taskId: "task-1", ownerId: "rec-stale" } });
  });

  it("fails and releases stale governed execution when Shopify lacks the exact after-state", async () => {
    const stale = { ...baseRec, id: "rec-stale", platform: "shopify", actionType: "apply_topical_map_store_task", targetEntityId: "task-1", status: "executing", updatedAt: new Date(0) };
    mockPrisma.recommendation.findMany.mockResolvedValueOnce([stale]).mockResolvedValueOnce([]);
    storeDispatch.recover.mockResolvedValue(null);
    await executeLive();
    expect(mockPrisma.storeTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
    expect(mockPrisma.storeTaskExecutionLock.deleteMany).toHaveBeenCalledWith({ where: { taskId: "task-1", ownerId: "rec-stale" } });
  });
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
