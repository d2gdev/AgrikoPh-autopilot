import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockShopifyFetch, mockUpdateProduct, mockUpdateCollection, mockUpdatePage } = vi.hoisted(() => ({
  mockShopifyFetch: vi.fn(), mockUpdateProduct: vi.fn(), mockUpdateCollection: vi.fn(), mockUpdatePage: vi.fn(),
}));

vi.mock("@/lib/shopify-admin", () => ({
  shopifyFetch: mockShopifyFetch,
  updateProductSeo: mockUpdateProduct,
  updateCollectionSeoAndBody: mockUpdateCollection,
  updatePageSeoAndBody: mockUpdatePage,
}));

import {
  applyGovernedStoreResourceChange,
  createGovernedRedirect,
  fetchGovernedRedirects,
  fetchGovernedStoreResource,
  fetchGovernedStoreResources,
  resolveGovernedStoreUrl,
} from "@/lib/shopify-governed-resources";

const page = (edges: unknown[], hasNextPage = false, endCursor: string | null = null) => ({
  pageInfo: { hasNextPage, endCursor }, edges,
});

describe("resolveGovernedStoreUrl", () => {
  it.each([
    ["/products/pure-ginger", { type: "product", handle: "pure-ginger" }],
    ["/collections/turmeric", { type: "collection", handle: "turmeric" }],
    ["/pages/about", { type: "page", handle: "about" }],
  ])("resolves %s", (url, expected) => expect(resolveGovernedStoreUrl(url)).toEqual(expected));

  it.each(["/", "/blogs/news", "/products/x/more", "/products/"])("rejects %s", (url) => {
    expect(resolveGovernedStoreUrl(url)).toBeNull();
  });
});

describe("fetchGovernedStoreResources", () => {
  beforeEach(() => mockShopifyFetch.mockReset());

  it("paginates each resource type, omits missing handles, and normalizes resources and internal links", async () => {
    mockShopifyFetch
      .mockResolvedValueOnce({ products: page([{ node: { id: "p1", handle: "pure-ginger", title: "Ginger", descriptionHtml: '<a href="https://agrikoph.com/pages/about#team">About</a><a href="https://other.test/no">No</a>', updatedAt: "2026-07-01T00:00:00Z", seo: { title: "Ginger SEO", description: "Root" } } }], true, "p-next") })
      .mockResolvedValueOnce({ products: page([{ node: { id: "p2", handle: "", title: "Hidden", descriptionHtml: "", updatedAt: "2026-07-01T00:00:00Z", seo: {} } }]) })
      .mockResolvedValueOnce({ collections: page([{ node: { id: "c1", handle: "turmeric", title: "Turmeric", descriptionHtml: '<a href="/products/pure-ginger?ref=body">Ginger</a>', updatedAt: "2026-07-02T00:00:00Z", seo: { title: null, description: null } } }]) })
      .mockResolvedValueOnce({ pages: page([{ node: { id: "g1", handle: "about", title: "About", body: '<a href="/collections/turmeric">Turmeric</a>', updatedAt: "2026-07-03T00:00:00Z", seoTitle: { value: "About SEO" }, seoDescription: { value: "Story" } } }]) });

    const resources = await fetchGovernedStoreResources([
      "https://agrikoph.com/products/pure-ginger",
      "/collections/turmeric",
      "/pages/about",
      "/blogs/news",
    ]);

    expect(mockShopifyFetch.mock.calls.map((call) => call[1])).toEqual([
      { after: null }, { after: "p-next" }, { after: null }, { after: null },
    ]);
    expect([...resources.keys()]).toEqual(["/products/pure-ginger", "/collections/turmeric", "/pages/about"]);
    expect(resources.get("/products/pure-ginger")).toMatchObject({
      type: "product", handle: "pure-ginger", url: "/products/pure-ginger", seoTitle: "Ginger SEO",
      internalTargets: ["/pages/about#team"],
    });
    expect(resources.get("/collections/turmeric")?.internalTargets).toEqual(["/products/pure-ginger?ref=body"]);
    expect(resources.get("/pages/about")).toMatchObject({ seoTitle: "About SEO", seoDescription: "Story", bodyHtml: expect.stringContaining("Turmeric") });
    expect(resources.has("/products/")).toBe(false);
  });

  it("produces a stable SHA-256 state hash and changes separately for title, body, and SEO", async () => {
    const node = { id: "p1", handle: "pure-ginger", title: "Ginger", descriptionHtml: "<p>Body</p>", updatedAt: "2026-07-01T00:00:00Z", seo: { title: "SEO", description: "Desc" } };
    mockShopifyFetch.mockResolvedValue({ products: page([{ node }]) });
    const first = await fetchGovernedStoreResource("/products/pure-ginger");
    mockShopifyFetch.mockResolvedValue({ products: page([{ node: { ...node, title: "Changed" } }]) });
    const titleChanged = await fetchGovernedStoreResource("/products/pure-ginger");
    mockShopifyFetch.mockResolvedValue({ products: page([{ node: { ...node, descriptionHtml: "<p>Changed</p>" } }]) });
    const bodyChanged = await fetchGovernedStoreResource("/products/pure-ginger");
    mockShopifyFetch.mockResolvedValue({ products: page([{ node: { ...node, seo: { ...node.seo, title: "Changed SEO" } } }]) });
    const seoChanged = await fetchGovernedStoreResource("/products/pure-ginger");
    expect(first?.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(titleChanged?.stateHash).not.toBe(first?.stateHash);
    expect(bodyChanged?.stateHash).not.toBe(first?.stateHash);
    expect(seoChanged?.stateHash).not.toBe(first?.stateHash);
    mockShopifyFetch.mockResolvedValue({ products: page([{ node }]) });
    expect((await fetchGovernedStoreResource("https://agrikoph.com/products/pure-ginger"))?.stateHash).toBe(first?.stateHash);
  });

  it("records capture time separately from Shopify resource updatedAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T08:00:00.000Z"));
    mockShopifyFetch.mockResolvedValue({ products: page([{ node: { id: "p1", handle: "pure-ginger", title: "Ginger", descriptionHtml: "", updatedAt: "2025-01-01T00:00:00.000Z", seo: {} } }]) });

    const observed = await fetchGovernedStoreResource("/products/pure-ginger");

    expect(observed?.capturedAt.toISOString()).toBe("2026-07-14T08:00:00.000Z");
    expect(observed?.updatedAt.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    vi.useRealTimers();
  });
});

describe("applyGovernedStoreResourceChange", () => {
  const base = { id: "gid://shopify/Product/1", type: "product" as const, url: "/products/pure-ginger", handle: "pure-ginger", title: "Ginger", seoTitle: null, seoDescription: null, bodyHtml: "", capturedAt: new Date("2026-07-14T00:00:00Z"), updatedAt: new Date("2026-07-01T00:00:00Z"), stateHash: "a", internalTargets: [] };

  beforeEach(() => { mockUpdateProduct.mockReset(); mockUpdateCollection.mockReset(); mockUpdatePage.mockReset(); mockShopifyFetch.mockReset(); });

  it.each(["handle", "status", "published", "price", "unknown"])("rejects non-allowlisted key %s", async (key) => {
    await expect(applyGovernedStoreResourceChange(base, { [key]: "x" } as never)).rejects.toThrow(/not allowed/i);
    expect(mockUpdateProduct).not.toHaveBeenCalled();
  });

  it.each(["product", "collection"] as const)("rejects title changes for %s resources before transport", async (type) => {
    const target = { ...base, type, id: `${type}-1`, url: `/${type === "product" ? "products" : "collections"}/target`, handle: "target" };
    await expect(applyGovernedStoreResourceChange(target, { title: "Changed" })).rejects.toThrow(/title.*not allowed/i);
    expect(mockUpdateProduct).not.toHaveBeenCalled();
    expect(mockUpdateCollection).not.toHaveBeenCalled();
  });

  it("rejects an unsupported runtime resource type before transport", async () => {
    const unsupported = { ...base, type: "article" } as never;
    await expect(applyGovernedStoreResourceChange(unsupported, { bodyHtml: "<p>Changed</p>" })).rejects.toThrow(/unsupported.*type/i);
    expect(mockUpdateProduct).not.toHaveBeenCalled();
    expect(mockUpdateCollection).not.toHaveBeenCalled();
    expect(mockUpdatePage).not.toHaveBeenCalled();
  });

  it("maps product changes and refetches the resource", async () => {
    mockUpdateProduct.mockResolvedValue({ id: base.id });
    mockShopifyFetch.mockResolvedValue({ products: page([{ node: { id: base.id, handle: base.handle, title: base.title, descriptionHtml: "<p>New</p>", updatedAt: "2026-07-04T00:00:00Z", seo: { title: "Pure Ginger | Agriko", description: "Desc" } } }]) });
    const updated = await applyGovernedStoreResourceChange(base, { seoTitle: "Pure Ginger | Agriko", seoDescription: "Desc", bodyHtml: "<p>New</p>" });
    expect(mockUpdateProduct).toHaveBeenCalledWith(base.id, { title: "Pure Ginger | Agriko", description: "Desc" }, { descriptionHtml: "<p>New</p>" });
    expect(updated.bodyHtml).toBe("<p>New</p>");
  });

  it("maps collection and page changes", async () => {
    const collection = { ...base, id: "c1", type: "collection" as const, url: "/collections/rice", handle: "rice" };
    const pageResource = { ...base, id: "g1", type: "page" as const, url: "/pages/about", handle: "about" };
    mockUpdateCollection.mockResolvedValue({ id: "c1" });
    mockUpdatePage.mockResolvedValue({ id: "g1" });
    mockShopifyFetch
      .mockResolvedValueOnce({ collections: page([{ node: { id: "c1", handle: "rice", title: "Rice", descriptionHtml: "<p>Rice</p>", updatedAt: "2026-07-04T00:00:00Z", seo: {} } }]) })
      .mockResolvedValueOnce({ pages: page([{ node: { id: "g1", handle: "about", title: "About Agriko", body: "<p>About</p>", updatedAt: "2026-07-04T00:00:00Z", seoTitle: { value: "About Agriko" }, seoDescription: { value: "Desc" } } }]) });
    await applyGovernedStoreResourceChange(collection, { seoTitle: "Organic Rice | Agriko", bodyHtml: "<p>Rice</p>" });
    await applyGovernedStoreResourceChange(pageResource, { title: "About Agriko", seoTitle: "About Agriko", seoDescription: "Desc", bodyHtml: "<p>About</p>" });
    expect(mockUpdateCollection).toHaveBeenCalledWith("c1", { title: "Organic Rice | Agriko" }, { descriptionHtml: "<p>Rice</p>" });
    expect(mockUpdatePage).toHaveBeenCalledWith("g1", { title: "About Agriko", seoTitle: "About Agriko", seoDescription: "Desc", bodyHtml: "<p>About</p>" });
  });

  it("rejects missing post-mutation resources", async () => {
    mockUpdateProduct.mockResolvedValue({ id: base.id });
    mockShopifyFetch.mockResolvedValue({ products: page([]) });
    await expect(applyGovernedStoreResourceChange(base, { bodyHtml: "<p>Changed</p>" })).rejects.toThrow(/not return updated/i);
  });
});

describe("governed redirects", () => {
  beforeEach(() => mockShopifyFetch.mockReset());

  it("paginates redirects and returns exact requested source observations", async () => {
    mockShopifyFetch
      .mockResolvedValueOnce({ urlRedirects: page([{ node: { id: "r1", path: "/old", target: "/products/rice" } }], true, "next") })
      .mockResolvedValueOnce({ urlRedirects: page([{ node: { id: "r2", path: "/other", target: "/pages/about" } }]) });

    const redirects = await fetchGovernedRedirects(["/old", "/missing"]);

    expect(mockShopifyFetch.mock.calls.map((call) => call[1])).toEqual([{ after: null }, { after: "next" }]);
    expect(redirects.get("/old")).toMatchObject({ id: "r1", source: "/old", target: "/products/rice" });
    expect(redirects.has("/missing")).toBe(false);
  });

  it("creates only the exact redirect and rejects Shopify user errors", async () => {
    mockShopifyFetch.mockResolvedValueOnce({ urlRedirectCreate: { urlRedirect: { id: "r1", path: "/old", target: "/products/rice" }, userErrors: [] } });
    await expect(createGovernedRedirect("/old", "/products/rice")).resolves.toMatchObject({ id: "r1", source: "/old", target: "/products/rice" });
    expect(mockShopifyFetch).toHaveBeenCalledWith(expect.stringContaining("urlRedirectCreate"), { urlRedirect: { path: "/old", target: "/products/rice" } });

    mockShopifyFetch.mockResolvedValueOnce({ urlRedirectCreate: { urlRedirect: null, userErrors: [{ field: ["path"], message: "Path has already been taken" }] } });
    await expect(createGovernedRedirect("/old", "/products/rice")).rejects.toThrow("Path has already been taken");
  });
});
