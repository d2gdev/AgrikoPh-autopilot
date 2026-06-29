import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  rawSnapshot: {
    findMany: vi.fn(),
  },
  recommendation: {
    groupBy: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAppAuth: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

import { GET } from "@/app/api/ad-pilot/report/route";

function snapshot({
  spend,
  start,
  end,
  fetchedAt,
}: {
  spend: string;
  start: string;
  end: string;
  fetchedAt: string;
}) {
  return {
    fetchedAt: new Date(fetchedAt),
    dateRangeStart: new Date(start),
    dateRangeEnd: new Date(end),
    payload: {
      campaigns: [{ id: "campaign-1", name: "Campaign 1" }],
      adSets: [],
      ads: [],
      insights: [{ campaign_id: "campaign-1", spend, clicks: "1", impressions: "10", actions: [], action_values: [] }],
    },
  };
}

describe("ad-pilot report route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.recommendation.groupBy.mockResolvedValue([]);
  });

  it("returns comparable ad spend deltas only for equivalent periods", async () => {
    mockPrisma.rawSnapshot.findMany.mockResolvedValue([
      snapshot({
        spend: "150.00",
        start: "2026-06-18T00:00:00.000Z",
        end: "2026-06-25T00:00:00.000Z",
        fetchedAt: "2026-06-25T01:00:00.000Z",
      }),
      snapshot({
        spend: "100.00",
        start: "2026-06-11T00:00:00.000Z",
        end: "2026-06-18T00:00:00.000Z",
        fetchedAt: "2026-06-18T01:00:00.000Z",
      }),
    ]);

    const res = await GET(new Request("http://test.local/api/ad-pilot/report") as never);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.comparison).toMatchObject({
      comparable: true,
      current: 150,
      previous: 100,
      delta: 50,
      deltaPct: 50,
      label: "2026-06-18 to 2026-06-25 vs 2026-06-11 to 2026-06-18",
    });
    expect(payload.period.label).toBe("2026-06-18 to 2026-06-25");
    expect(payload.trend[0].period.label).toBe("2026-06-11 to 2026-06-18");
  });

  it("hides the ad spend delta when the prior snapshot has a different window", async () => {
    mockPrisma.rawSnapshot.findMany.mockResolvedValue([
      snapshot({
        spend: "150.00",
        start: "2026-06-18T00:00:00.000Z",
        end: "2026-06-25T00:00:00.000Z",
        fetchedAt: "2026-06-25T01:00:00.000Z",
      }),
      snapshot({
        spend: "400.00",
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-06-25T00:00:00.000Z",
        fetchedAt: "2026-06-24T01:00:00.000Z",
      }),
    ]);

    const res = await GET(new Request("http://test.local/api/ad-pilot/report") as never);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.comparison).toMatchObject({
      comparable: false,
      current: 150,
      previous: 0,
      delta: 0,
      deltaPct: null,
      previousPeriod: null,
      label: null,
    });
  });
});
