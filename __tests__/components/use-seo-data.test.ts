import { describe, expect, it, vi } from "vitest";
import { loadSeoCoreRequest, seoCoreCacheKey, waitForSeoRefresh } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/useSeoData";

const valid = { topQueries: [], topPages: [], gscFetchedAt: null, ga4FetchedAt: null, trends: null, opportunities: [], gscPages: [], queryPagePairs: [] };

describe("loadSeoCoreRequest", () => {
  it("scopes the SEO cache key to Shopify context", () => {
    expect(seoCoreCacheKey((href) => `${href}?shop=one.myshopify.com`)).not.toBe(seoCoreCacheKey((href) => `${href}?shop=two.myshopify.com`));
  });

  it("rejects failed responses without committing", async () => {
    const commit = vi.fn();
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "upstream unavailable" }), { status: 500 }));
    await expect(loadSeoCoreRequest(authFetch, commit)).rejects.toThrow("upstream unavailable");
    expect(commit).not.toHaveBeenCalled();
  });
  it("commits valid responses once", async () => {
    const commit = vi.fn();
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(valid), { status: 200 }));
    await loadSeoCoreRequest(authFetch, commit);
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith(valid);
  });
});

describe("waitForSeoRefresh", () => {
  it("polls a queued run until terminal success", async () => {
    const authFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "running" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "success" }), { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(waitForSeoRefresh(authFetch, "run 1", { maxAttempts: 3, intervalMs: 1, sleep })).resolves.toEqual({ status: "success", terminal: true });
    expect(authFetch).toHaveBeenNthCalledWith(1, "/api/jobs/status?runId=run%201");
    expect(authFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("returns a bounded non-terminal result when polling expires", async () => {
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "running" }), { status: 200 }));
    await expect(waitForSeoRefresh(authFetch, "run-2", { maxAttempts: 2, intervalMs: 1, sleep: async () => undefined })).resolves.toEqual({ status: "running", terminal: false });
    expect(authFetch).toHaveBeenCalledTimes(2);
  });
});
