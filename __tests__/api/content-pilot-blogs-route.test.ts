import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAppAuth = vi.hoisted(() => vi.fn());
const mockShopifyFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ requireAppAuth: mockRequireAppAuth }));
vi.mock("@/lib/shopify-admin", () => ({ shopifyFetch: mockShopifyFetch }));

describe("Content Pilot blogs route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAppAuth.mockResolvedValue(null);
  });

  it("returns a safe operator error when Shopify blog loading fails", async () => {
    mockShopifyFetch.mockRejectedValueOnce(new Error("request failed with secret-provider-detail"));
    const { GET } = await import("@/app/api/content-pilot/blogs/route");

    const response = await GET(new Request("http://test.local/api/content-pilot/blogs"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Unable to load Shopify blogs" });
    expect(JSON.stringify(body)).not.toContain("secret-provider-detail");
  });
});
