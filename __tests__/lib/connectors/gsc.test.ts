import { beforeEach, describe, expect, it, vi } from "vitest";

const getAccessToken = vi.fn().mockResolvedValue({ token: "token-1" });
const getClient = vi.fn().mockResolvedValue({ getAccessToken });

vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn(function MockGoogleAuth() {
    return { getClient };
  }),
}));
vi.mock("@/lib/service-account", () => ({ loadServiceAccountJson: vi.fn().mockReturnValue({}) }));
vi.mock("@/lib/config/resolver", () => ({
  getOptionalSecret: vi.fn().mockResolvedValue("{}"),
  getSecret: vi.fn().mockResolvedValue("sc-domain:agrikoph.com"),
}));

import {
  fetchGscData,
  fetchGscPageMetrics,
  fetchGscPropertyTotals,
} from "@/lib/connectors/gsc";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("fetchGscPageMetrics", () => {
  it("requests one finalized aggregate row for the exact page and inclusive dates", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ rows: [{ clicks: 3, impressions: 40, ctr: 0.075, position: 8.25 }] }),
    });

    await expect(fetchGscPageMetrics({
      startDate: "2026-07-07",
      endDate: "2026-07-13",
      pageUrl: "https://agrikoph.com/products/red-rice",
    })).resolves.toEqual({ clicks: 3, impressions: 40, ctr: 0.075, avgPosition: 8.25 });

    const [, request] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(request.body)).toEqual({
      startDate: "2026-07-07",
      endDate: "2026-07-13",
      dataState: "final",
      aggregationType: "byPage",
      dimensionFilterGroups: [{
        groupType: "and",
        filters: [{ dimension: "page", operator: "equals", expression: "https://agrikoph.com/products/red-rice" }],
      }],
      rowLimit: 1,
    });
    expect(JSON.parse(request.body)).not.toHaveProperty("dimensions");
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null when Search Analytics has no aggregate row", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ rows: [] }) });
    await expect(fetchGscPageMetrics({
      startDate: "2026-07-07",
      endDate: "2026-07-13",
      pageUrl: "https://agrikoph.com/products/red-rice",
    })).resolves.toBeNull();
  });

  it("throws only the bounded status error for a non-2xx response", async () => {
    const text = vi.fn();
    fetchMock.mockResolvedValue({ ok: false, status: 403, text });
    await expect(fetchGscPageMetrics({
      startDate: "2026-07-07",
      endDate: "2026-07-13",
      pageUrl: "https://agrikoph.com/products/red-rice",
    })).rejects.toThrow(new Error("GSC API error 403"));
    expect(text).not.toHaveBeenCalled();
  });
});

describe("fetchGscPropertyTotals", () => {
  it("requests one finalized dimensionless aggregate for the exact inclusive dates", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        rows: [{ clicks: 201, impressions: 32488, ctr: 0.0061875, position: 13.42 }],
      }),
    });

    await expect(fetchGscPropertyTotals({
      start: new Date("2026-06-20T00:00:00.000Z"),
      end: new Date("2026-07-17T00:00:00.000Z"),
    })).resolves.toEqual({
      clicks: 201,
      impressions: 32488,
      avgCtr: 0.0061875,
      avgPosition: 13.42,
    });

    const [, request] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(request.body)).toEqual({
      startDate: "2026-06-20",
      endDate: "2026-07-17",
      dataState: "final",
      rowLimit: 1,
    });
    expect(JSON.parse(request.body)).not.toHaveProperty("dimensions");
    expect(JSON.parse(request.body)).not.toHaveProperty("dimensionFilterGroups");
  });

  it("returns null when Search Analytics has no property aggregate row", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ rows: [] }),
    });

    await expect(fetchGscPropertyTotals({
      start: new Date("2026-06-20T00:00:00.000Z"),
      end: new Date("2026-07-17T00:00:00.000Z"),
    })).resolves.toBeNull();
  });

  it("adds the independent property aggregate to the raw query payload", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          rows: [{ clicks: 201, impressions: 32488, ctr: 0.0061875, position: 13.42 }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          rows: [{
            keys: ["dimensioned query"],
            clicks: 51,
            impressions: 13402,
            ctr: 0.0038,
            position: 11.2,
          }],
        }),
      });

    const result = await fetchGscData({
      start: new Date("2026-06-20T00:00:00.000Z"),
      end: new Date("2026-07-17T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      propertyTotals: {
        clicks: 201,
        impressions: 32488,
        avgCtr: 0.0061875,
        avgPosition: 13.42,
      },
      topQueries: [{
        query: "dimensioned query",
        clicks: 51,
        impressions: 13402,
      }],
    });
  });
});
