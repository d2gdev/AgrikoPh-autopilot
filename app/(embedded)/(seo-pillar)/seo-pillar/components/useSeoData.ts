import { useState, useEffect, useCallback } from "react";
import { useAuthFetch, withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { getCache, setCache } from "@/lib/client-cache";
import type { SeoData, Analysis, Health, KeywordRow, Cluster, SnapshotTrendPoint } from "./types";

export async function loadSeoCoreRequest(
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  commit: (data: SeoData) => void,
): Promise<void> {
  const response = await authFetch("/api/seo");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error : "SEO data");
  }
  const next = await response.json() as SeoData;
  commit(next);
}

export function seoCoreCacheKey(contextualize: (href: string) => string = withShopifyContextUrl): string {
  return contextualize("/api/seo");
}

type AuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type RefreshPollResult = { status: string; terminal: boolean; issues: string[] };

function safeRefreshIssues(summary: unknown): string[] {
  if (!summary || typeof summary !== "object" || !("jobs" in summary)) return [];
  const jobs = (summary as { jobs?: unknown }).jobs;
  if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) return [];
  const issueStatuses = new Set(["failed", "partial", "skipped"]);

  return Object.entries(jobs)
    .filter(([jobName, step]) =>
      /^[a-z0-9][a-z0-9-]{0,79}$/.test(jobName) &&
      Boolean(step && typeof step === "object" && "status" in step && issueStatuses.has(String((step as { status?: unknown }).status)))
    )
    .map(([jobName, step]) => `${jobName} ${String((step as { status: unknown }).status)}`)
    .slice(0, 8);
}

export function refreshResultToast(result: RefreshPollResult): string {
  const details = result.issues.length ? `: ${result.issues.join("; ")}.` : "";
  if (result.status === "success") return "SEO data refreshed.";
  if (result.status === "partial") {
    return details
      ? `SEO refresh completed with partial results${details}`
      : "SEO refresh completed with partial results. Review the data warnings.";
  }
  if (result.status === "failed") {
    return details ? `SEO refresh failed${details}` : "SEO refresh failed. Check job status for details.";
  }
  return "SEO refresh is still running. Reload the page shortly to see the completed data.";
}

export async function waitForSeoRefresh(
  authFetch: AuthFetch,
  runId: string,
  options: {
    maxAttempts?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<RefreshPollResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 30);
  const intervalMs = Math.max(0, options.intervalMs ?? 3_000);
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const terminalStatuses = new Set(["success", "partial", "failed"]);
  let lastStatus = "unknown";
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await authFetch(`/api/jobs/status?runId=${encodeURIComponent(runId)}`);
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        if (typeof body.status === "string") lastStatus = body.status;
        lastIssues = safeRefreshIssues(body.summary);
        if (terminalStatuses.has(lastStatus)) return { status: lastStatus, terminal: true, issues: lastIssues };
      }
    } catch {
      // A transient status-read failure should not abandon a run that may still complete.
    }
    if (attempt < maxAttempts - 1) await sleep(intervalMs);
  }

  return { status: lastStatus, terminal: false, issues: lastIssues };
}

// ── SEO Pilot data-loading hook ─────────────────────────────────────────────
// Verbatim body relocated from app/(embedded)/(seo-pillar)/seo-pillar/page.tsx
// (Phase 8c, Task 4), following the Phase 8b `useDashboardData` precedent.

export function useSeoData() {
  const authFetch = useAuthFetch();
  const cacheKey = seoCoreCacheKey();

  const [data, setData] = useState<SeoData | null>(() => getCache<SeoData>(cacheKey));
  const [loading, setLoading] = useState(() => !getCache(cacheKey));

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisAt, setAnalysisAt] = useState<string | null>(null);

  const [health, setHealth] = useState<Health | null>(null);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [trend, setTrend] = useState<SnapshotTrendPoint[]>([]);
  const trendFirst = trend[0];
  const trendLast = trend[trend.length - 1];

  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadCore = useCallback(async () => {
    await loadSeoCoreRequest(authFetch, (d) => { setCache(cacheKey, d); setData(d); });
  }, [authFetch, cacheKey]);

  // Shared by the initial mount load and a manual refresh, so a refresh
  // re-pulls every tab's data — not just the Overview/Opportunities `data`
  // object via loadCore().
  const loadAllSections = useCallback(async () => {
    const okJson = async (url: string, section: string) => {
      const r = await authFetch(url);
      if (!r.ok) throw new Error(section);
      return r.json();
    };
    const failed: string[] = [];
    const track = (p: Promise<unknown>, section: string, clear: () => void) =>
      p.catch((e) => { clear(); failed.push(section); throw e; });
    await Promise.allSettled([
      track(loadCore(), "SEO data", () => setData(null)),
      track(okJson("/api/seo/analysis", "AI analysis").then((d) => { setAnalysis(d.analysis ?? null); setAnalysisAt(d.generatedAt ?? null); }), "AI analysis", () => { setAnalysis(null); setAnalysisAt(null); }),
      track(okJson("/api/seo/health", "On-page health").then((d) => setHealth(d?.totals ? d : null)), "On-page health", () => setHealth(null)),
      track(okJson("/api/seo/keywords", "Keywords").then((d) => setKeywords(d.keywords ?? [])), "Keywords", () => setKeywords([])),
      track(okJson("/api/content-pilot/topic-clusters", "Pillar clusters").then((d) => setClusters(d.clusters ?? [])), "Pillar clusters", () => setClusters([])),
      track(okJson("/api/seo/history", "Trend").then((d) => setTrend(d.trend ?? [])), "Trend", () => setTrend([])),
    ]);
    setLoadError(failed.length ? `Some sections failed to load: ${failed.join(", ")}. Try Refresh data.` : null);
  }, [authFetch, loadCore]);

  useEffect(() => {
    setLoading(true);
    loadAllSections().finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshData = useCallback(async () => {
    setRefreshing(true);
    setToast(null);
    try {
      const res = await authFetch("/api/seo/refresh", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if ((res.ok || res.status === 409) && typeof d.runId === "string") {
        setToast(res.status === 409 ? "Following the SEO refresh already in progress…" : "SEO refresh queued…");
        const result = await waitForSeoRefresh(authFetch, d.runId);
        if (result.terminal && (result.status === "success" || result.status === "partial")) {
          await loadAllSections();
          setToast(refreshResultToast(result));
        } else if (result.terminal && result.status === "failed") {
          setToast(refreshResultToast(result));
        } else {
          // Preserve bounded waiting: refresh what is available, then let the
          // operator passively reload rather than enqueueing another run.
          await loadAllSections();
          setToast("SEO refresh is still running. Reload the page shortly to see the completed data.");
        }
      } else if (res.ok && d.ok !== false) {
        await loadAllSections();
        setToast("SEO refresh was queued, but its status could not be followed. Reload the page shortly.");
      } else {
        setToast(d.error ?? "Refresh failed.");
      }
    } catch { setToast("Refresh failed."); }
    finally { setRefreshing(false); }
  }, [authFetch, loadAllSections]);

  return {
    data,
    loading,
    analysis, setAnalysis,
    analysisAt, setAnalysisAt,
    health, setHealth,
    keywords, setKeywords,
    clusters, setClusters,
    trend, trendFirst, trendLast,
    refreshing,
    loadError, setLoadError,
    toast, setToast,
    loadCore,
    loadAllSections,
    refreshData,
  };
}
