import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/resolver", () => ({
  getSecret: vi.fn(),
}));

import { getSecret } from "@/lib/config/resolver";
import { shopifyFetch } from "@/lib/shopify-admin";

describe("shopifyFetch", () => {
  beforeEach(() => {
    const mockGetSecret = vi.mocked(getSecret);
    mockGetSecret.mockReset();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: { ok: true } }),
    }) as unknown as typeof fetch;
  });

  it("resolves Shopify domain and token through config resolver", async () => {
    const mockGetSecret = vi.mocked(getSecret);
    mockGetSecret.mockImplementation(async (key: string) => {
      if (key === "SHOPIFY_STORE_DOMAIN") return "test.myshopify.com";
      if (key === "SHOPIFY_ADMIN_ACCESS_TOKEN") return "admin-token";
      throw new Error(`Unexpected key ${key}`);
    });

    await expect(shopifyFetch<{ ok: boolean }>("query { shop { name } }")).resolves.toEqual({ ok: true });

    expect(mockGetSecret).toHaveBeenCalledWith("SHOPIFY_STORE_DOMAIN");
    expect(mockGetSecret).toHaveBeenCalledWith("SHOPIFY_ADMIN_ACCESS_TOKEN");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://test.myshopify.com/admin/api/2025-01/graphql.json",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Shopify-Access-Token": "admin-token",
        }),
      })
    );
  });
});
