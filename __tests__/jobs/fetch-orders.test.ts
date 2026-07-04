import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  jobRun: {
    create: vi.fn().mockResolvedValue({ id: "run_1" }),
    update: vi.fn().mockResolvedValue({}),
  },
  dailySales: {
    count: vi.fn(),
    upsert: vi.fn().mockResolvedValue({}),
  },
  rawSnapshot: {
    upsert: vi.fn().mockResolvedValue({}),
  },
}));

const fetchOrdersWindowMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/connectors/shopify-orders", () => ({ fetchOrdersWindow: fetchOrdersWindowMock }));

import { fetchOrdersHandler } from "@/jobs/fetch-orders";

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

describe("fetchOrdersHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.jobRun.create.mockResolvedValue({ id: "run_1" });
  });

  it("processes exactly yesterday (UTC) when DailySales is non-empty, excluding cancelled orders from revenue/aov", async () => {
    prismaMock.dailySales.count.mockResolvedValue(5);
    fetchOrdersWindowMock.mockResolvedValue({
      orders: [
        { id: "gid://1", createdAt: "x", cancelled: false, financialStatus: "paid", total: 100, productIds: ["p1"] },
        { id: "gid://2", createdAt: "x", cancelled: true, financialStatus: "voided", total: 50, productIds: ["p2"] },
      ],
      currency: "PHP",
    });

    const result = await fetchOrdersHandler();

    expect(result.status).toBe("success");
    expect(fetchOrdersWindowMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.dailySales.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.rawSnapshot.upsert).toHaveBeenCalledTimes(1);

    const today = utcMidnight(new Date());
    const expectedYesterday = new Date(today.getTime() - 24 * 3_600_000);
    const expectedDayEnd = new Date(expectedYesterday.getTime() + 24 * 3_600_000);

    const dailySalesCall = prismaMock.dailySales.upsert.mock.calls[0]?.[0];
    expect(dailySalesCall.where.date).toEqual(expectedYesterday);
    expect(dailySalesCall.update.orders).toBe(1);
    expect(dailySalesCall.update.revenue).toBe(100);
    expect(dailySalesCall.update.aov).toBe(100);

    const rawSnapshotCall = prismaMock.rawSnapshot.upsert.mock.calls[0]?.[0];
    expect(rawSnapshotCall.where).toEqual({
      source_dateRangeStart_dateRangeEnd: {
        source: "shopify_orders",
        dateRangeStart: expectedYesterday,
        dateRangeEnd: expectedDayEnd,
      },
    });

    expect(result.summary.backfilled).toBe(false);
    expect(result.summary.daysWritten).toBe(1);
    expect(result.summary.ordersSeen).toBe(2);
    expect(result.summary.revenueTotal).toBe(100);
  });

  it("reports aov 0 when there are zero live orders in the window", async () => {
    prismaMock.dailySales.count.mockResolvedValue(5);
    fetchOrdersWindowMock.mockResolvedValue({ orders: [], currency: null });

    const result = await fetchOrdersHandler();

    expect(result.status).toBe("success");
    const dailySalesCall = prismaMock.dailySales.upsert.mock.calls[0]?.[0];
    expect(dailySalesCall.update.orders).toBe(0);
    expect(dailySalesCall.update.revenue).toBe(0);
    expect(dailySalesCall.update.aov).toBe(0);
  });

  it("backfills the trailing 28 days when DailySales is empty", async () => {
    prismaMock.dailySales.count.mockResolvedValue(0);
    fetchOrdersWindowMock.mockResolvedValue({ orders: [], currency: "PHP" });

    const result = await fetchOrdersHandler();

    expect(result.status).toBe("success");
    expect(result.summary.backfilled).toBe(true);
    expect(prismaMock.dailySales.upsert).toHaveBeenCalledTimes(28);
    expect(fetchOrdersWindowMock).toHaveBeenCalledTimes(28);
  });

  it("marks the JobRun failed and returns status failed without throwing when the connector throws", async () => {
    prismaMock.dailySales.count.mockResolvedValue(5);
    fetchOrdersWindowMock.mockRejectedValue(new Error("shopify API down"));

    const result = await fetchOrdersHandler();

    expect(result.status).toBe("failed");
    expect(prismaMock.jobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    );
    expect(result.errors[0]).toContain("shopify API down");
  });
});
