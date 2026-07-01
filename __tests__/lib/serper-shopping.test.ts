import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/resolver", () => ({
  getOptionalSecret: vi.fn(async (k: string) => (k === "SERPER_API_KEY" ? "test-key" : null)),
}));

import { fetchSerperShoppingProducts } from "@/lib/connectors/serper-shopping";

function mockFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchSerperShoppingProducts — quota/rate-limit degradation", () => {
  it("returns disabled (not throw) on 403 out-of-credits so the caller can fall back", async () => {
    mockFetch(403, { message: "Not enough credits" });
    const r = await fetchSerperShoppingProducts({ keyword: "organic rice" });
    expect(r.disabled).toBe(true);
    expect(r.products).toEqual([]);
  });

  it("returns disabled (not throw) on 429 rate-limit", async () => {
    mockFetch(429, { message: "Too many requests" });
    const r = await fetchSerperShoppingProducts({ keyword: "organic rice" });
    expect(r.disabled).toBe(true);
  });

  it("still throws on a genuine server error (500)", async () => {
    mockFetch(500, { message: "boom" });
    await expect(fetchSerperShoppingProducts({ keyword: "x" })).rejects.toThrow();
  });

  it("parses products normally on 200", async () => {
    mockFetch(200, { shopping: [{ title: "Rice 5kg", price: "₱250", source: "Store", position: 1 }] });
    const r = await fetchSerperShoppingProducts({ keyword: "rice" });
    expect(r.disabled).toBeFalsy();
    expect(r.products).toHaveLength(1);
    expect(r.products[0]!.title).toBe("Rice 5kg");
  });
});
