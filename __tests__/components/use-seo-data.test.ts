import { describe, expect, it, vi } from "vitest";
import { loadCommandCenterAndAnalysis, loadSeoCoreRequest, refreshResultToast, resolveMapAnalysisState, seoCoreCacheKey, waitForSeoRefresh } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/useSeoData";

const identityV3 = { versionId: "v3", strategyVersion: "3", contractRevision: "2", packageSha256: "a".repeat(64), activatedAt: null };
const analysis = { gaps: [], observations: [], suppressed: [] };
const envelopeV2 = { state: "ready" as const, analysis, generatedAt: "2026-07-12T00:00:00.000Z", strategy: { ...identityV3, versionId: "v2" } };
const envelopeV3 = { state: "ready" as const, analysis, generatedAt: "2026-07-13T00:00:00.000Z", strategy: identityV3 };

describe("active topical-map loading", () => {
  it("rejects analysis for a different active strategy as stale", () => {
    expect(resolveMapAnalysisState({ active: identityV3, envelope: envelopeV2 })).toEqual({ state: "stale", analysis: null });
    expect(resolveMapAnalysisState({ active: identityV3, envelope: envelopeV3 })).toEqual({ state: "ready", analysis });
  });

  it("distinguishes no active strategy from empty findings", () => {
    expect(resolveMapAnalysisState({ active: null, envelope: envelopeV3 })).toEqual({ state: "no_active_strategy", analysis: null });
    expect(resolveMapAnalysisState({ active: identityV3, envelope: envelopeV3 })).toEqual({ state: "ready", analysis });
  });

  it("loads command-center identity before requesting cached analysis", async () => {
    const calls: string[] = [];
    const authFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.includes("command-center")) return new Response(JSON.stringify({ state: "ready", generatedAt: "now", commandCenter: { identity: identityV3 } }), { status: 200 });
      return new Response(JSON.stringify(envelopeV3), { status: 200 });
    });
    const result = await loadCommandCenterAndAnalysis(authFetch);
    expect(calls).toEqual(["/api/topical-map/command-center", "/api/seo/analysis"]);
    expect(result.mapAnalysisState.state).toBe("ready");
  });

  it("does not request or expose old analysis when governance fails", async () => {
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "unavailable" }), { status: 500 }));
    const result = await loadCommandCenterAndAnalysis(authFetch);
    expect(authFetch).toHaveBeenCalledOnce();
    expect(result.mapState).toEqual({ state: "error", message: "Strategy command center is unavailable." });
    expect(result.mapAnalysisState).toEqual({ state: "error", analysis: null, message: "Strategy command center is unavailable." });
  });

  it("maps the server stale response without exposing stale content", async () => {
    const staleResponse = { state: "stale", analysis: null, generatedAt: null, strategy: identityV3, cachedStrategy: { versionId: "v2", packageSha256: "b".repeat(64) } };
    const authFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "ready", generatedAt: "now", commandCenter: { identity: identityV3 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(staleResponse), { status: 200 }));
    const result = await loadCommandCenterAndAnalysis(authFetch);
    expect(result.mapAnalysisState).toEqual({ state: "stale", analysis: null });
    expect(JSON.stringify(result)).not.toContain("stale finding");
  });

  it.each([
    { state: "future", commandCenter: null },
    { state: "ready", generatedAt: "now", commandCenter: null },
  ])("treats malformed or unknown governance payload as an error", async (payload) => {
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const result = await loadCommandCenterAndAnalysis(authFetch);
    expect(result.mapState.state).toBe("error");
    expect(result.mapAnalysisState.state).toBe("error");
    expect(authFetch).toHaveBeenCalledOnce();
  });
});

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
