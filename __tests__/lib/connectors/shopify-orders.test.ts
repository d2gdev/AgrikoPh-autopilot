import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/shopify-admin", () => ({ shopifyFetch: vi.fn() }));

import { shopifyFetch } from "@/lib/shopify-admin";
import { fetchOrdersWindow } from "@/lib/connectors/shopify-orders";

const order = (id: string, amount: string, cancelled = false) => ({
  node: {
    id: `gid://shopify/Order/${id}`,
    createdAt: "2026-07-02T03:00:00Z",
    cancelledAt: cancelled ? "2026-07-02T04:00:00Z" : null,
    displayFinancialStatus: "PAID",
    currentTotalPriceSet: { shopMoney: { amount, currencyCode: "PHP" } },
    lineItems: { edges: [{ node: { product: { id: "gid://shopify/Product/9" } } }, { node: { product: null } }] },
  },
});

describe("fetchOrdersWindow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("paginates, parses money, tolerates null products, flags cancellations", async () => {
    vi.mocked(shopifyFetch)
      .mockResolvedValueOnce({
        orders: { pageInfo: { hasNextPage: true, endCursor: "c1" }, edges: [order("1", "540.00")] },
      })
      .mockResolvedValueOnce({
        orders: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [order("2", "225.50", true)] },
      });

    const result = await fetchOrdersWindow({ start: new Date("2026-07-02T00:00:00Z"), end: new Date("2026-07-03T00:00:00Z") });
    expect(result.orders).toHaveLength(2);
    expect(result.orders[0]).toMatchObject({ total: 540, cancelled: false, productIds: ["gid://shopify/Product/9"] });
    expect(result.orders[1]!.cancelled).toBe(true);
    expect(result.currency).toBe("PHP");
    const firstQueryVars = vi.mocked(shopifyFetch).mock.calls[0]![1] as Record<string, unknown>;
    expect(String(firstQueryVars.query)).toContain("created_at:>=");
  });
});
