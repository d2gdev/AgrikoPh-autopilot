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
    const track = (p: Promise<unknown>, section: string) =>
      p.catch((e) => { failed.push(section); throw e; });
    await Promise.allSettled([
      track(loadCore(), "SEO data"),
      track(okJson("/api/seo/analysis", "AI analysis").then((d) => { setAnalysis(d.analysis ?? null); setAnalysisAt(d.generatedAt ?? null); }), "AI analysis"),
      track(okJson("/api/seo/health", "On-page health").then((d) => setHealth(d?.totals ? d : null)), "On-page health"),
      track(okJson("/api/seo/keywords", "Keywords").then((d) => setKeywords(d.keywords ?? [])), "Keywords"),
      track(okJson("/api/content-pilot/topic-clusters", "Pillar clusters").then((d) => setClusters(d.clusters ?? [])), "Pillar clusters"),
      track(okJson("/api/seo/history", "Trend").then((d) => setTrend(d.trend ?? [])), "Trend"),
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
      if (res.status === 409) {
        setToast("A data fetch is already running — try again shortly.");
      } else if (res.ok && d.ok !== false) {
        // /api/seo/refresh only enqueues a background job (drained by a
        // per-minute cron) — it does not fetch GSC/GA4 data synchronously.
        // Re-load in case a previously queued run already finished, but don't
        // claim the refresh is done; it usually isn't yet.
        await loadAllSections();
        setToast("Refresh queued — new SEO data will appear within a few minutes. Click Refresh data again shortly to check.");
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
