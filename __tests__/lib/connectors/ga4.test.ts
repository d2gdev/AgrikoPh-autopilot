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
  getSecret: vi.fn().mockResolvedValue("512447424"),
}));

import { fetchGa4Data } from "@/lib/connectors/ga4";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("fetchGa4Data", () => {
  it("reports the four funnel events and revenue separately without the key-event aggregate", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        reports: [
          {
            rows: [{
              dimensionValues: [{ value: "/products/red-rice" }],
              metricValues: [
                { value: "10" },
                { value: "0.2" },
                { value: "8" },
                { value: "123.45" },
              ],
            }],
          },
          {
            rows: [
              { dimensionValues: [{ value: "/products/red-rice" }, { value: "view_item" }], metricValues: [{ value: "6" }] },
              { dimensionValues: [{ value: "/products/red-rice" }, { value: "add_to_cart" }], metricValues: [{ value: "3" }] },
              { dimensionValues: [{ value: "/products/red-rice" }, { value: "begin_checkout" }], metricValues: [{ value: "2" }] },
              { dimensionValues: [{ value: "/products/red-rice" }, { value: "purchase" }], metricValues: [{ value: "1" }] },
            ],
          },
        ],
      }),
    });

    await expect(fetchGa4Data({
      start: new Date("2026-06-05T00:00:00Z"),
      end: new Date("2026-07-10T00:00:00Z"),
    })).resolves.toEqual({
      topPages: [{
        page: "/products/red-rice",
        sessions: 10,
        totalUsers: 8,
        conversions: 1,
        viewItem: 6,
        addToCart: 3,
        beginCheckout: 2,
        purchases: 1,
        revenue: 123.45,
        bounceRate: "20.0%",
        conversionRate: "10.00%",
      }],
      fetchedAt: expect.any(String),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://analyticsdata.googleapis.com/v1beta/properties/512447424:batchRunReports",
      expect.objectContaining({ method: "POST" }),
    );
    const request = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(request.requests).toHaveLength(2);
    expect(request.requests[0].metrics).toEqual([
      { name: "sessions" },
      { name: "bounceRate" },
      { name: "totalUsers" },
      { name: "purchaseRevenue" },
    ]);
    expect(request.requests[1]).toEqual(expect.objectContaining({
      dimensions: [{ name: "pagePath" }, { name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: {
            values: ["view_item", "add_to_cart", "begin_checkout", "purchase"],
          },
        },
      },
    }));
    expect(JSON.stringify(request)).not.toContain("\"conversions\"");
  });
});
