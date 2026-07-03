import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/resolver", () => ({
  getSecret: vi.fn(),
}));

import { getSecret } from "@/lib/config/resolver";
import { shopifyFetch, updateProductSeo } from "@/lib/shopify-admin";

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

describe("updateProductSeo", () => {
  beforeEach(() => {
    vi.mocked(getSecret).mockImplementation(async (key: string) => {
      if (key === "SHOPIFY_STORE_DOMAIN") return "test.myshopify.com";
      if (key === "SHOPIFY_ADMIN_ACCESS_TOKEN") return "admin-token";
      throw new Error(`Unexpected key ${key}`);
    });
  });

  it("sends productUpdate with the seo input and returns the updated seo", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: {
          productUpdate: {
            product: { id: "gid://shopify/Product/1", seo: { title: "T", description: "D" } },
            userErrors: [],
          },
        },
      }),
    }) as unknown as typeof fetch;

    const result = await updateProductSeo("gid://shopify/Product/1", { title: "T", description: "D" });
    expect(result.seo.title).toBe("T");
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.variables.product).toEqual({ id: "gid://shopify/Product/1", seo: { title: "T", description: "D" } });
  });

  it("throws on userErrors", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: { productUpdate: { product: null, userErrors: [{ field: ["seo"], message: "Title too long" }] } },
      }),
    }) as unknown as typeof fetch;

    await expect(updateProductSeo("gid://shopify/Product/1", { title: "x" })).rejects.toThrow("Title too long");
  });
});
