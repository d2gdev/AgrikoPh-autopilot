import { describe, expect, it, vi } from "vitest";
import { loadSeoCoreRequest, refreshResultToast, seoCoreCacheKey, waitForSeoRefresh } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/useSeoData";

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

    await expect(waitForSeoRefresh(authFetch, "run 1", { maxAttempts: 3, intervalMs: 1, sleep })).resolves.toEqual({ status: "success", terminal: true, issues: [] });
    expect(authFetch).toHaveBeenNthCalledWith(1, "/api/jobs/status?runId=run%201");
    expect(authFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("returns a bounded non-terminal result when polling expires", async () => {
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "running" }), { status: 200 }));
    await expect(waitForSeoRefresh(authFetch, "run-2", { maxAttempts: 2, intervalMs: 1, sleep: async () => undefined })).resolves.toEqual({ status: "running", terminal: false, issues: [] });
    expect(authFetch).toHaveBeenCalledTimes(2);
  });

  it("retains only safe structured diagnostics from a partial refresh", async () => {
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "partial",
      summary: {
        jobs: {
          "fetch-seo-data": { status: "failed", errors: 1 },
          "fetch-gsc-data": { status: "partial", errors: 1 },
          "fetch-blog-content": { status: "success", errors: 0 },
        },
      },
      errorLog: "OPENROUTER_API_KEY=never-render-this",
    }), { status: 200 }));

    const result = await waitForSeoRefresh(authFetch, "run-3", { maxAttempts: 1 });

    expect(result).toEqual({
      status: "partial",
      terminal: true,
      issues: ["fetch-seo-data failed", "fetch-gsc-data partial"],
    });
    expect(JSON.stringify(result)).not.toContain("never-render-this");
    expect(refreshResultToast(result)).toBe("SEO refresh completed with partial results: fetch-seo-data failed; fetch-gsc-data partial.");
  });

  it("reports a failed refresh without exposing its raw error log", async () => {
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "failed",
      summary: { jobs: { "fetch-seo-data": { status: "failed" } } },
      errorLog: "database password should stay hidden",
    }), { status: 200 }));

    const result = await waitForSeoRefresh(authFetch, "run-4", { maxAttempts: 1 });

    expect(refreshResultToast(result)).toBe("SEO refresh failed: fetch-seo-data failed.");
    expect(JSON.stringify(result)).not.toContain("database password");
  });
});
