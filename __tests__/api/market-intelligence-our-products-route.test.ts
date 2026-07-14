import { beforeEach, describe, expect, it, vi } from "vitest";

const mockShopifyFetch = vi.hoisted(() => vi.fn());
const mockAuth = vi.hoisted(() => ({ requireAppAuth: vi.fn() }));

vi.mock("@/lib/shopify-admin", () => ({ shopifyFetch: mockShopifyFetch }));
vi.mock("@/lib/auth", () => ({ requireAppAuth: mockAuth.requireAppAuth }));

function productsResponse(id: string) {
  return {
    products: {
      edges: [{ node: { id, title: id, priceRangeV2: { minVariantPrice: { amount: "1", currencyCode: "PHP" } } } }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

describe("market-intelligence our-products GET route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
  });

  it("keeps explicitly refreshed products cached when an older ordinary read completes afterward", async () => {
    let resolveInitialRead!: (value: ReturnType<typeof productsResponse>) => void;
    const initialRead = new Promise<ReturnType<typeof productsResponse>>((resolve) => { resolveInitialRead = resolve; });
    mockShopifyFetch
      .mockImplementationOnce(() => initialRead)
      .mockResolvedValueOnce(productsResponse("fresh"));
    const { GET } = await import("@/app/api/market-intelligence/our-products/route");

    const ordinary = GET(new Request("http://test.local/api/market-intelligence/our-products"));
    await vi.waitFor(() => expect(mockShopifyFetch).toHaveBeenCalledTimes(1));
    const refreshed = await GET(new Request("http://test.local/api/market-intelligence/our-products?refresh=1"));
    resolveInitialRead(productsResponse("old"));
    await ordinary;

    const cached = await GET(new Request("http://test.local/api/market-intelligence/our-products"));
    expect(mockShopifyFetch).toHaveBeenCalledTimes(2);
    expect((await refreshed.json()).products[0].id).toBe("fresh");
    expect((await cached.json()).products[0].id).toBe("fresh");
  });
});
