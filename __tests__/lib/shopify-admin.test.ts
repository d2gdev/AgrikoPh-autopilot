import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/resolver", () => ({
  getSecret: vi.fn(),
}));

import { getSecret } from "@/lib/config/resolver";
import { shopifyFetch, updateCollectionSeoAndBody, updatePageSeoAndBody, updateProductSeo } from "@/lib/shopify-admin";

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

describe("governed Shopify mutations", () => {
  beforeEach(() => {
    vi.mocked(getSecret).mockImplementation(async (key: string) => key === "SHOPIFY_STORE_DOMAIN" ? "test.myshopify.com" : "admin-token");
  });

  it("sends exact product title, body, and SEO variables", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ data: { productUpdate: { product: { id: "p1", seo: {} }, userErrors: [] } } }) }) as unknown as typeof fetch;
    await updateProductSeo("p1", { title: "Pure Ginger | Agriko", description: "..." }, { descriptionHtml: "<p>...</p>" });
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.variables).toEqual({ product: { id: "p1", seo: { title: "Pure Ginger | Agriko", description: "..." }, descriptionHtml: "<p>...</p>" } });
  });

  it("sends exact collection variables", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ data: { collectionUpdate: { collection: { id: "c1", seo: {} }, userErrors: [] } } }) }) as unknown as typeof fetch;
    await updateCollectionSeoAndBody("c1", { title: "Organic Rice | Agriko" }, { descriptionHtml: "<p>...</p>" });
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.variables).toEqual({ input: { id: "c1", seo: { title: "Organic Rice | Agriko" }, descriptionHtml: "<p>...</p>" } });
  });

  it("sends exact page variables including global SEO metafields", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ data: { pageUpdate: { page: { id: "g1" }, userErrors: [] } } }) }) as unknown as typeof fetch;
    await updatePageSeoAndBody("g1", { title: "About Agriko", seoTitle: "About Agriko", seoDescription: "...", bodyHtml: "<p>...</p>" });
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.variables).toEqual({ page: { id: "g1", title: "About Agriko", body: "<p>...</p>", metafields: [
      { namespace: "global", key: "title_tag", type: "single_line_text_field", value: "About Agriko" },
      { namespace: "global", key: "description_tag", type: "single_line_text_field", value: "..." },
    ] } });
  });

  it("validates limits before transport", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    await expect(updateProductSeo("p1", { title: "x".repeat(71) })).rejects.toThrow(/70/);
    await expect(updateCollectionSeoAndBody("c1", { description: "x".repeat(161) })).rejects.toThrow(/160/);
    await expect(updatePageSeoAndBody("g1", { bodyHtml: "x".repeat(50_001) })).rejects.toThrow(/50,000/);
    await expect(updatePageSeoAndBody("g1", { title: "x".repeat(71) })).rejects.toThrow(/70/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws user errors and missing returned objects", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: { collectionUpdate: { collection: null, userErrors: [{ message: "Bad collection" }] } } }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: { pageUpdate: { page: null, userErrors: [] } } }) }) as unknown as typeof fetch;
    await expect(updateCollectionSeoAndBody("c1", {}, {})).rejects.toThrow("Bad collection");
    await expect(updatePageSeoAndBody("g1", {})).rejects.toThrow(/no page/i);
  });
});
