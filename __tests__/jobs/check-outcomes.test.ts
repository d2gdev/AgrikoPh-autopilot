import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: { create: vi.fn().mockResolvedValue({ id: "run-1" }), update: vi.fn() },
    recommendation: { findMany: vi.fn(), update: vi.fn() },
    rawSnapshot: { findFirst: vi.fn() },
    dailySales: { aggregate: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  },
}));
vi.mock("@/lib/ai/embeddings", () => ({ embedTexts: vi.fn() }));
vi.mock("@/lib/connectors/gsc", () => ({ fetchGscPageMetrics: vi.fn() }));

import { prisma } from "@/lib/db";
import { embedTexts } from "@/lib/ai/embeddings";
import { fetchGscPageMetrics } from "@/lib/connectors/gsc";
import { checkOutcomesHandler } from "@/jobs/check-outcomes";

const mockFindMany = prisma.recommendation.findMany as Mock;
const mockUpdate = prisma.recommendation.update as Mock;
const mockSnapshotFindFirst = prisma.rawSnapshot.findFirst as Mock;
const mockDailySalesAggregate = prisma.dailySales.aggregate as Mock;
const mockEmbed = embedTexts as Mock;
const mockExecRaw = prisma.$executeRawUnsafe as Mock;
const mockFetchGscPageMetrics = fetchGscPageMetrics as Mock;

const NOW = new Date("2026-07-02T00:00:00Z");
const EXECUTED_8D_AGO = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);

function baseRec(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    platform: "meta",
    skillId: "s1",
    skillName: "budget-optimizer",
    actionType: "pause_ad",
    targetEntityType: "campaign",
    targetEntityId: "123",
    targetEntityName: "Brand Campaign",
    status: "executed",
    executedAt: EXECUTED_8D_AGO,
    outcomeCheckedAt: null,
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "snap-1",
    source: "meta",
    fetchedAt: EXECUTED_8D_AGO,
    payload: { campaigns: [{ id: "123", spend: 100, roas: 2 }] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({});
  mockEmbed.mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => Array(1024).fill(0.1))));
  mockExecRaw.mockResolvedValue(undefined);
  mockDailySalesAggregate.mockResolvedValue({ _sum: { revenue: null } });
});

describe("checkOutcomesHandler selection", () => {
  it("only selects status=executed, executedAt<=now-7d, outcomeCheckedAt=null (verifies the where clause)", async () => {
    mockFindMany.mockResolvedValue([]);
    await checkOutcomesHandler();
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "executed",
          outcomeCheckedAt: null,
          executedAt: { lte: expect.any(Date) },
        }),
        take: 50,
      }),
    );
    const cutoffPassed = mockFindMany.mock.calls[0]![0].where.executedAt.lte as Date;
    // cutoff should be exactly 7 days before "now"
    expect(NOW.getTime() - cutoffPassed.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("caps selection at 50 via take", async () => {
    mockFindMany.mockResolvedValue([]);
    await checkOutcomesHandler();
    expect(mockFindMany.mock.calls[0]![0].take).toBe(50);
  });
});

describe("checkOutcomesHandler verdicts", () => {
  it("writes an improved verdict and indexes it into the KB", async () => {
    mockFindMany.mockResolvedValue([baseRec()]);
    mockSnapshotFindFirst
      .mockResolvedValueOnce(snapshot({ payload: { campaigns: [{ id: "123", spend: 100, roas: 2 }] } })) // before
      .mockResolvedValueOnce(
        snapshot({
          id: "snap-2",
          fetchedAt: new Date(EXECUTED_8D_AGO.getTime() + 8 * 24 * 60 * 60 * 1000),
          payload: { campaigns: [{ id: "123", spend: 100, roas: 2.5 }] },
        }),
      ); // after

    const result = await checkOutcomesHandler();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({
          outcome: expect.objectContaining({ verdict: "improved" }),
          outcomeCheckedAt: expect.any(Date),
        }),
      }),
    );
    expect(mockExecRaw).toHaveBeenCalled();
    expect(result.summary.checked).toBe(1);
    expect(result.summary.indexed).toBe(1);
    expect(result.status).toBe("success");
  });

  it("marks insufficient_data (and skips KB indexing) when the after-snapshot is missing", async () => {
    mockFindMany.mockResolvedValue([baseRec()]);
    mockSnapshotFindFirst.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(null);

    const result = await checkOutcomesHandler();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: expect.objectContaining({ verdict: "insufficient_data" }) }),
      }),
    );
    expect(mockExecRaw).not.toHaveBeenCalled();
    expect(result.summary.checked).toBe(1);
    expect(result.summary.indexed).toBe(0);
  });

  it("marks insufficient_data when both snapshots exist but the entity vanished from the payload", async () => {
    mockFindMany.mockResolvedValue([baseRec()]);
    mockSnapshotFindFirst
      .mockResolvedValueOnce(snapshot({ payload: { campaigns: [{ id: "999", spend: 1 }] } }))
      .mockResolvedValueOnce(snapshot({ payload: { campaigns: [{ id: "999", spend: 1 }] } }));

    const result = await checkOutcomesHandler();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: expect.objectContaining({ verdict: "insufficient_data" }) }),
      }),
    );
    expect(result.summary.checked).toBe(1);
  });

  it("continues to the next rec and reports partial status when one rec throws", async () => {
    mockFindMany.mockResolvedValue([baseRec({ id: "rec-bad", executedAt: null }), baseRec({ id: "rec-good" })]);
    mockSnapshotFindFirst
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ fetchedAt: new Date(EXECUTED_8D_AGO.getTime() + 8 * 24 * 60 * 60 * 1000) }));

    const result = await checkOutcomesHandler();

    expect(result.summary.failed).toBe(1);
    expect(result.summary.checked).toBe(1);
    expect(result.status).toBe("partial");
    expect(result.errors[0]).toContain("rec-bad");
  });

  it("does not throw when the KB write fails — logs and continues, still marks the rec checked", async () => {
    mockFindMany.mockResolvedValue([baseRec()]);
    mockSnapshotFindFirst
      .mockResolvedValueOnce(snapshot({ payload: { campaigns: [{ id: "123", spend: 100, roas: 2 }] } }))
      .mockResolvedValueOnce(
        snapshot({ fetchedAt: new Date(EXECUTED_8D_AGO.getTime() + 8 * 24 * 60 * 60 * 1000), payload: { campaigns: [{ id: "123", spend: 100, roas: 2.5 }] } }),
      );
    mockEmbed.mockRejectedValue(new Error("embeddings service unavailable"));

    const result = await checkOutcomesHandler();

    expect(result.summary.checked).toBe(1);
    expect(result.summary.indexed).toBe(0);
    expect(result.status).toBe("success");
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("attaches advisory storeRevenue before/after sums without affecting the verdict", async () => {
    mockFindMany.mockResolvedValue([baseRec()]);
    mockSnapshotFindFirst
      .mockResolvedValueOnce(snapshot({ payload: { campaigns: [{ id: "123", spend: 100, roas: 2 }] } })) // before
      .mockResolvedValueOnce(
        snapshot({
          id: "snap-2",
          fetchedAt: new Date(EXECUTED_8D_AGO.getTime() + 8 * 24 * 60 * 60 * 1000),
          payload: { campaigns: [{ id: "123", spend: 100, roas: 2.5 }] },
        }),
      ); // after
    mockDailySalesAggregate
      .mockResolvedValueOnce({ _sum: { revenue: 15000 } }) // before window
      .mockResolvedValueOnce({ _sum: { revenue: null } }); // after window, no rows

    const result = await checkOutcomesHandler();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: expect.objectContaining({
            verdict: "improved",
            storeRevenue: { before: 15000, after: null, windowDays: expect.any(Number) },
          }),
        }),
      }),
    );
    expect(result.status).toBe("success");
  });

  it("reports success with zero checked when there is nothing to do", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await checkOutcomesHandler();
    expect(result.status).toBe("success");
    expect(result.summary).toEqual({ considered: 0, checked: 0, indexed: 0, failed: 0 });
  });
});

describe("checkOutcomesHandler topical-map URL routing", () => {
  const executedAt = new Date("2026-07-14T10:00:00Z");
  const topicalRec = () => baseRec({
    platform: "shopify",
    actionType: "apply_topical_map_store_task",
    executedAt,
    executionResult: { targetUrl: "/products/red-rice" },
  });

  it("uses exact seven-day windows and the absolute governed URL", async () => {
    vi.setSystemTime(new Date("2026-07-25T00:00:00Z"));
    mockFindMany.mockResolvedValue([topicalRec()]);
    mockFetchGscPageMetrics
      .mockResolvedValueOnce({ clicks: 10, impressions: 100, ctr: 0.1, avgPosition: 12 })
      .mockResolvedValueOnce({ clicks: 12, impressions: 110, ctr: 12 / 110, avgPosition: 10 });

    const result = await checkOutcomesHandler();

    expect(mockFetchGscPageMetrics.mock.calls).toEqual([
      [{ startDate: "2026-07-07", endDate: "2026-07-13", pageUrl: "https://agrikoph.com/products/red-rice" }],
      [{ startDate: "2026-07-15", endDate: "2026-07-21", pageUrl: "https://agrikoph.com/products/red-rice" }],
    ]);
    expect(mockSnapshotFindFirst).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        outcome: expect.objectContaining({
          kind: "topical_map_url_gsc",
          verdict: "improved",
          targetUrl: "https://agrikoph.com/products/red-rice",
          windowDays: 7,
          beforeWindow: { startDate: "2026-07-07", endDate: "2026-07-13" },
          afterWindow: { startDate: "2026-07-15", endDate: "2026-07-21" },
          storeRevenue: { before: null, after: null, windowDays: 7 },
        }),
      }),
    }));
    expect(result.summary.checked).toBe(1);
  });

  it("preserves generic Meta snapshot outcomes", async () => {
    mockFindMany.mockResolvedValue([baseRec()]);
    mockSnapshotFindFirst
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({
        fetchedAt: new Date(EXECUTED_8D_AGO.getTime() + 8 * 24 * 60 * 60 * 1000),
        payload: { campaigns: [{ id: "123", spend: 100, roas: 2.5 }] },
      }));

    await checkOutcomesHandler();

    expect(mockSnapshotFindFirst).toHaveBeenCalledTimes(2);
    expect(mockFetchGscPageMetrics).not.toHaveBeenCalled();
  });

  it("defers without updating while the final-data lag has not elapsed", async () => {
    vi.setSystemTime(new Date("2026-07-23T23:59:59Z"));
    mockFindMany.mockResolvedValue([topicalRec()]);

    const result = await checkOutcomesHandler();

    expect(mockFetchGscPageMetrics).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.summary).toEqual({ considered: 1, checked: 0, indexed: 0, failed: 0 });
    expect(result.status).toBe("success");
  });
});
