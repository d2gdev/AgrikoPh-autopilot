"use client";

import {
  Page, Layout, Card, Text, Badge, InlineStack, BlockStack, DataTable, Banner,
  Button, TextField, Tabs, Spinner, Tooltip, List, Select,
} from "@shopify/polaris";
import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { useAuthFetch, withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { getCache, setCache } from "@/lib/client-cache";
import { KEYWORD_CLUSTERS, PRIMARY_TARGETS, SECONDARY_BANK, ROADMAP, ALL_PRIMARY_KEYWORDS, type PrimaryTarget } from "@/lib/seo/keyword-strategy";
import { timeAgo } from "@/lib/format";
import type {
  Query, PageRow, Totals, Mover, Trends, Opportunity, OpportunityCluster,
  SnapshotTrendPoint, PageHealthRow, GscPage, QueryPagePair, SeoData,
  ContentGap, Analysis, HealthTotals, HealthOffender, Health, KeywordRow, Cluster,
} from "./components/types";
import { gapKey, opportunityKey, fmtPct } from "./components/types";
import { OverviewPanel } from "./components/panels/OverviewPanel";
import { OpportunitiesPanel } from "./components/panels/OpportunitiesPanel";
import { ContentGapsPanel } from "./components/panels/ContentGapsPanel";
import { OnPageHealthPanel } from "./components/panels/OnPageHealthPanel";

// render a page path/url as a subdued span (or link when it looks like a path/url)
const pagePath = (p: string | null | undefined) => {
  if (!p) return "—";
  try {
    const u = new URL(p);
    return u.pathname + u.search;
  } catch {
    return p;
  }
};

const PAGE_HEALTH_FLAG: Record<string, { tone: "warning" | "critical"; label: string }> = {
  "high-impressions-high-bounce": { tone: "warning", label: "High bounce" },
  "high-impressions-low-conversion": { tone: "critical", label: "Low conversion" },
};

const OPP_LABEL: Record<string, string> = {
  low_ctr: "Low CTR",
  striking_distance: "Striking distance",
  high_impression_no_click: "No clicks",
};

// difficulty 0–100 → band + Badge tone
const diffBand = (d: number): { tone: "success" | "warning" | "critical"; label: string } =>
  d < 34 ? { tone: "success", label: "Low" } : d < 67 ? { tone: "warning", label: "Med" } : { tone: "critical", label: "High" };

export default function SeoPillarReportPage() {
  const router = useRouter();
  const authFetch = useAuthFetch();

  const [data, setData] = useState<SeoData | null>(() => getCache<SeoData>("/api/seo"));
  const [loading, setLoading] = useState(() => !getCache("/api/seo"));
  const [tab, setTab] = useState(0);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisAt, setAnalysisAt] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [health, setHealth] = useState<Health | null>(null);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [trend, setTrend] = useState<SnapshotTrendPoint[]>([]);
  const trendFirst = trend[0];
  const trendLast = trend[trend.length - 1];

  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<Set<string>>(new Set());
  const [promoted, setPromoted] = useState<Set<string>>(new Set());
  const [promotingOpp, setPromotingOpp] = useState<Set<string>>(new Set());
  const [promotedOpp, setPromotedOpp] = useState<Set<string>>(new Set());
  const [promotingOnPage, setPromotingOnPage] = useState<Set<string>>(new Set());
  const [promotedOnPage, setPromotedOnPage] = useState<Set<string>>(new Set());
  const [promotingRec, setPromotingRec] = useState<Set<number>>(new Set());
  const [promotedRec, setPromotedRec] = useState<Set<number>>(new Set());
  const [promotingQw, setPromotingQw] = useState<Set<number>>(new Set());
  const [promotedQw, setPromotedQw] = useState<Set<number>>(new Set());
  // Strategy tab — keyword tracking + plan-it state (keyed by keyword string).
  const [trackingKw, setTrackingKw] = useState<Set<string>>(new Set());
  const [trackedKw, setTrackedKw] = useState<Set<string>>(new Set());
  const [trackingAll, setTrackingAll] = useState(false);
  const [planningKw, setPlanningKw] = useState<Set<string>>(new Set());
  const [plannedKw, setPlannedKw] = useState<Set<string>>(new Set());
  const [newKeyword, setNewKeyword] = useState("");
  // AI SEO brief (ported from the retired /seo page)
  const [brief, setBrief] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  // Opportunities / Keywords tab controls
  const [oppSearch, setOppSearch] = useState("");
  const [oppType, setOppType] = useState("all");
  const [oppSort, setOppSort] = useState<{ index: number; dir: "ascending" | "descending" } | null>(null);
  const [kwSearch, setKwSearch] = useState("");
  const [kwSort, setKwSort] = useState<{ index: number; dir: "ascending" | "descending" } | null>(null);

  const loadCore = useCallback(async () => {
    const r = await authFetch("/api/seo");
    const d = await r.json() as SeoData;
    setCache("/api/seo", d);
    setData(d);
  }, [authFetch]);

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

  const runSeoAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await authFetch("/api/seo/analyze", { method: "POST" });
      const d = await res.json();
      if (res.ok) {
        setAnalysis(d.analysis);
        setAnalysisAt(new Date().toISOString());
        setTab(2);
        const gapCount = d.analysis?.contentGaps?.length ?? 0;
        setToast(gapCount > 0 ? `Analysis complete — ${gapCount} content gap${gapCount === 1 ? "" : "s"} found.` : "Analysis complete — no content gaps found with current data.");
      } else setAnalysisError(d.error ?? "AI analysis failed.");
    } catch { setAnalysisError("AI analysis failed. Please try again."); }
    finally { setAnalyzing(false); }
  }, [authFetch]);

  const promoteGaps = useCallback(async (gaps: ContentGap[]) => {
    const keys = new Set(gaps.map(gapKey));
    setPromoting((s) => new Set([...s, ...keys]));
    try {
      const res = await authFetch("/api/seo/gaps/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gaps }),
      });
      const d = await res.json();
      if (res.ok) {
        setPromoted((s) => new Set([...s, ...keys]));
        setToast(`Created ${d.created} draft proposal${d.created === 1 ? "" : "s"} in Content Pilot${d.skipped ? ` (${d.skipped} skipped as duplicates)` : ""}.`);
      } else setToast(d.error ?? "Could not create proposals.");
    } catch { setToast("Could not create proposals."); }
    finally { setPromoting((s) => { const n = new Set(s); keys.forEach((k) => n.delete(k)); return n; }); }
  }, [authFetch]);

  const promoteOpportunity = useCallback(async (o: Opportunity) => {
    const key = opportunityKey(o);
    setPromotingOpp((s) => new Set([...s, key]));
    try {
      const suggestedTitle = `${o.query.charAt(0).toUpperCase() + o.query.slice(1)}: A Complete Guide`;
      const res = await authFetch("/api/seo/gaps/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gaps: [{ query: o.query, impressions: o.impressions, position: o.position, suggestedTitle, page: o.page, type: o.type }] }),
      });
      const d = await res.json();
      if (res.ok) {
        setPromotedOpp((s) => new Set([...s, key]));
        setToast(`Created draft proposal in Content Pilot${d.skipped ? " (already exists)" : ""}.`);
      } else setToast(d.error ?? "Could not create proposal.");
    } catch { setToast("Could not create proposal."); }
    finally { setPromotingOpp((s) => { const n = new Set(s); n.delete(key); return n; }); }
  }, [authFetch]);

  const promoteOnPage = useCallback(async (
    handle: string,
    title: string,
    issue: "missing-meta" | "thin-content" | "missing-h1",
    wordCount?: number,
  ) => {
    const key = `${handle}:${issue}`;
    setPromotingOnPage((s) => new Set([...s, key]));
    try {
      const res = await authFetch("/api/seo/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, title, issue, wordCount }),
      });
      const d = await res.json();
      if (res.ok) {
        setPromotedOnPage((s) => new Set([...s, key]));
        setToast(d.existed ? "Proposal already exists in Content Pilot." : "Proposal created in Content Pilot.");
      } else {
        setToast(d.error ?? "Could not create proposal.");
      }
    } catch {
      setToast("Could not create proposal.");
    } finally {
      setPromotingOnPage((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  }, [authFetch]);

  const planStrategy = useCallback(async (
    index: number,
    text: string,
    setBusy: Dispatch<SetStateAction<Set<number>>>,
    setDone: Dispatch<SetStateAction<Set<number>>>,
  ) => {
    setBusy((s) => new Set([...s, index]));
    try {
      const res = await authFetch("/api/seo/recommendations/decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendation: text }),
      });
      const d = await res.json();
      if (res.ok) {
        if (d.created > 0) {
          setDone((s) => new Set([...s, index]));
          const extras = [
            d.skipped ? `${d.skipped} already existed` : "",
            d.dropped ? `${d.dropped} skipped` : "",
          ].filter(Boolean).join(", ");
          setToast(`Created ${d.created} proposal${d.created === 1 ? "" : "s"} in Content Pilot${extras ? ` (${extras})` : ""}.`);
        } else if (d.skipped > 0) {
          // Already handled previously — reflect that in the UI instead of looking like a no-op.
          setDone((s) => new Set([...s, index]));
          setToast(`Already planned — ${d.skipped} proposal${d.skipped === 1 ? "" : "s"} already in Content Pilot.`);
        } else {
          setToast("No concrete tasks could be derived from this item.");
        }
      } else setToast(d.error ?? "Could not plan this item.");
    } catch { setToast("Could not plan this item."); }
    finally { setBusy((s) => { const n = new Set(s); n.delete(index); return n; }); }
  }, [authFetch]);

  // ── Strategy tab actions ──
  const trackKeyword = useCallback(async (keyword: string): Promise<boolean> => {
    setTrackingKw((s) => new Set([...s, keyword]));
    try {
      const res = await authFetch("/api/seo/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword }),
      });
      if (res.ok) { setTrackedKw((s) => new Set([...s, keyword])); return true; }
      const d = await res.json().catch(() => ({}));
      setToast(d.error ?? "Could not track keyword.");
      return false;
    } catch { setToast("Could not track keyword."); return false; }
    finally { setTrackingKw((s) => { const n = new Set(s); n.delete(keyword); return n; }); }
  }, [authFetch]);

  const trackAllPrimary = useCallback(async () => {
    setTrackingAll(true);
    let ok = 0;
    try {
      // Sequential to respect the 20/min keyword rate limit.
      for (const kw of ALL_PRIMARY_KEYWORDS) {
        if (trackedKw.has(kw)) { ok++; continue; }
        if (await trackKeyword(kw)) ok++;
      }
      setToast(`Tracking ${ok}/${ALL_PRIMARY_KEYWORDS.length} primary keywords against GSC.`);
    } finally { setTrackingAll(false); }
  }, [trackKeyword, trackedKw]);

  // Turn a strategy target into a Content Pilot proposal. Deterministic: creates
  // a new-content proposal (topic = keyword, brief carries page-type/intent) so
  // it always produces something reviewable in Content Pilot.
  const planTarget = useCallback(async (key: string, topic: string, brief: string) => {
    setPlanningKw((s) => new Set([...s, key]));
    try {
      const res = await authFetch("/api/content-pilot/proposals/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, brief }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.proposal) {
        setPlannedKw((s) => new Set([...s, key]));
        setToast(d.existed ? "Already in Content Pilot." : "Created a proposal in Content Pilot.");
      } else setToast(d.error ?? "Could not plan this target.");
    } catch { setToast("Could not plan this target."); }
    finally { setPlanningKw((s) => { const n = new Set(s); n.delete(key); return n; }); }
  }, [authFetch]);

  const addKeyword = useCallback(async () => {
    const kw = newKeyword.trim();
    if (!kw) return;
    setNewKeyword("");
    try {
      const res = await authFetch("/api/seo/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyword: kw }) });
      if (res.ok) {
        const r = await authFetch("/api/seo/keywords");
        setKeywords((await r.json()).keywords ?? []);
        setToast(`Now tracking “${kw}”.`);
      } else setToast("Could not add keyword.");
    } catch { setToast("Could not add keyword."); }
  }, [authFetch, newKeyword]);

  // ── derived metrics ──
  const t = data?.trends;
  const cur = t?.current;
  const prev = t?.previous ?? null;

  const queryRows = (data?.topQueries ?? []).slice(0, 20).map((q) => [
    q.query, String(q.clicks), String(q.impressions), q.ctr ?? "—", q.position ?? "—",
  ]);
  const pageRows = (data?.topPages ?? []).slice(0, 15).map((p) => [p.page, String(p.sessions ?? "—")]);

  const moverRows = (t?.movers ?? []).map((m, i) => [
    m.query,
    m.clicksDelta === 0
      ? <Text key={`${m.query}-${i}`} as="span" tone="subdued">no change</Text>
      : <Badge key={`${m.query}-${i}`} tone={m.clicksDelta > 0 ? "success" : "critical"}>{`${m.clicksDelta > 0 ? "+" : ""}${m.clicksDelta} clicks`}</Badge>,
    m.positionDelta ? `${m.positionDelta < 0 ? "▲" : "▼"} ${Math.abs(m.positionDelta).toFixed(1)}` : "—",
    String(m.clicks),
  ]);

  const oppTypeOptions = [
    { label: "All types", value: "all" },
    ...Array.from(new Set((data?.opportunities ?? []).map((o) => o.type))).map((t) => ({ label: OPP_LABEL[t] ?? t, value: t })),
  ];
  const filteredOpps = (data?.opportunities ?? [])
    .filter((o) => oppType === "all" || o.type === oppType)
    .filter((o) => {
      if (!oppSearch) return true;
      const q = oppSearch.toLowerCase();
      return o.query.toLowerCase().includes(q) || (o.page ?? "").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (!oppSort) return 0;
      const dir = oppSort.dir === "ascending" ? 1 : -1;
      if (oppSort.index === 3) return dir * (a.impressions - b.impressions);
      if (oppSort.index === 6) return dir * ((a.volume ?? -1) - (b.volume ?? -1));
      if (oppSort.index === 8) return dir * (a.potentialClicks - b.potentialClicks);
      return 0;
    });

  const oppRows = filteredOpps.map((o) => [
    o.query,
    <Badge key={o.query} tone={o.type === "high_impression_no_click" ? "critical" : o.type === "low_ctr" ? "warning" : "info"}>{OPP_LABEL[o.type] ?? o.type}</Badge>,
    o.page
      ? <Button key={`pg-${o.query}`} variant="plain" url={o.page} external>{pagePath(o.page)}</Button>
      : <Text key={`pg-${o.query}`} as="span" tone="subdued">—</Text>,
    o.impressions.toLocaleString(),
    `${(o.ctr * 100).toFixed(1)}%`,
    o.position.toFixed(1),
    o.volume === null || o.volume === undefined ? "—" : o.volume.toLocaleString(),
    o.difficulty === null || o.difficulty === undefined
      ? <Text key={`d-${o.query}`} as="span" tone="subdued">—</Text>
      : <Badge key={`d-${o.query}`} tone={diffBand(o.difficulty).tone}>{`${o.difficulty} · ${diffBand(o.difficulty).label}`}</Badge>,
    <Tooltip key={`t-${o.query}`} content={o.reason}><Text as="span" fontWeight="semibold">+{o.potentialClicks}</Text></Tooltip>,
    promotedOpp.has(opportunityKey(o))
      ? <Badge key={`a-${o.query}`} tone="success">Created</Badge>
      : <Button key={`a-${o.query}`} size="slim" loading={promotingOpp.has(opportunityKey(o))} onClick={() => promoteOpportunity(o)}>Create brief</Button>,
  ]);

  // page health — already sorted by severity desc; flagged rows lead
  const pageHealth = data?.pageHealth ?? [];
  const flaggedPageHealth = pageHealth.filter((p) => p.flag !== null);

  const gaps = analysis?.contentGaps ?? [];
  const unpromotedGaps = gaps.filter((g) => !promoted.has(gapKey(g)));

  // ── panel props derived from the promoted*/promoting* Sets ──
  // Booleans (not raw Sets) are threaded down so a single item's membership
  // change doesn't force every row in a panel to re-render.
  const anyPromoting = promoting.size > 0;
  const gapFlags = gaps.map((g) => ({ isPromoted: promoted.has(gapKey(g)), isPromoting: promoting.has(gapKey(g)) }));
  const quickWinFlags = (analysis?.quickWins ?? []).map((_, i) => ({ isPlanned: promotedQw.has(i), isPlanning: promotingQw.has(i) }));
  const recFlags = (analysis?.recommendations ?? []).map((_, i) => ({ isPlanned: promotedRec.has(i), isPlanning: promotingRec.has(i) }));
  const offenderFlags: Record<string, {
    isPromotedMeta: boolean; isPromotingMeta: boolean;
    isPromotedH1: boolean; isPromotingH1: boolean;
    isPromotedThin: boolean; isPromotingThin: boolean;
  }> = {};
  (health?.worstOffenders ?? []).forEach((a) => {
    offenderFlags[a.handle] = {
      isPromotedMeta: promotedOnPage.has(`${a.handle}:missing-meta`),
      isPromotingMeta: promotingOnPage.has(`${a.handle}:missing-meta`),
      isPromotedH1: promotedOnPage.has(`${a.handle}:missing-h1`),
      isPromotingH1: promotingOnPage.has(`${a.handle}:missing-h1`),
      isPromotedThin: promotedOnPage.has(`${a.handle}:thin-content`),
      isPromotingThin: promotingOnPage.has(`${a.handle}:thin-content`),
    };
  });

  async function generateBrief() {
    setBriefLoading(true);
    setBrief(null);
    setBriefError(null);
    try {
      const res = await authFetch("/api/seo/brief", { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        const message = [d.error, d.detail].filter(Boolean).join(": ");
        setBriefError(message || "Failed to generate brief");
        return;
      }
      setBrief(d.brief);
    } catch (err) {
      console.error("[seo/brief]", err);
      setBriefError("Failed to generate brief. Please try again.");
    } finally {
      setBriefLoading(false);
    }
  }

  const tabs = [
    { id: "overview", content: "Overview" },
    { id: "opps", content: `Opportunities${data?.opportunities?.length ? ` (${data.opportunities.length})` : ""}` },
    { id: "gaps", content: "Content Gaps" },
    { id: "health", content: "On-Page Health" },
    { id: "keywords", content: "Keywords" },
    { id: "clusters", content: "Pillar Clusters" },
    { id: "pagehealth", content: `Page Health${flaggedPageHealth.length ? ` (${flaggedPageHealth.length})` : ""}` },
    { id: "oppclusters", content: `Opportunity Clusters${data?.clusters?.length ? ` (${data.clusters.length})` : ""}` },
    { id: "strategy", content: "Strategy" },
  ];

  return (
    <Page
      title="SEO Pilot"
      subtitle="Search Console + Analytics — observe, analyse, and act"
      primaryAction={{ content: "AI Analysis", onAction: runSeoAnalysis, loading: analyzing }}
      secondaryActions={[
        { content: "Refresh data", onAction: refreshData, loading: refreshing },
        { content: "Generate SEO Brief", onAction: generateBrief, loading: briefLoading },
      ]}
    >
      <Layout>
        {loadError && (
          <Layout.Section>
            <Banner tone="warning" title="Some data didn’t load" onDismiss={() => setLoadError(null)}><p>{loadError}</p></Banner>
          </Layout.Section>
        )}
        {toast && (
          <Layout.Section>
            <Banner tone="info" onDismiss={() => setToast(null)}><p>{toast}</p></Banner>
          </Layout.Section>
        )}
        {analysisError && (
          <Layout.Section>
            <Banner tone="critical" title="AI Analysis failed" onDismiss={() => setAnalysisError(null)}><p>{analysisError}</p></Banner>
          </Layout.Section>
        )}
        {briefError && (
          <Layout.Section>
            <Banner tone="critical" title="Brief generation failed" onDismiss={() => setBriefError(null)}><p>{briefError}</p></Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={tabs} selected={tab} onSelect={setTab} />
            <div style={{ padding: "var(--p-space-400)" }}>
              {loading ? (
                <InlineStack gap="200" blockAlign="center"><Spinner size="small" /><Text as="span">Loading…</Text></InlineStack>
              ) : (
                <>
                  {/* ── OVERVIEW ── */}
                  {tab === 0 && (
                    <OverviewPanel
                      brief={brief}
                      cur={cur}
                      prev={prev}
                      gscFetchedAt={data?.gscFetchedAt}
                      previousFetchedAt={t?.previousFetchedAt}
                      trend={trend}
                      trendFirst={trendFirst}
                      trendLast={trendLast}
                      moverRows={moverRows}
                      pageRows={pageRows}
                      queryRows={queryRows}
                      gscPages={data?.gscPages ?? []}
                      queryPagePairs={data?.queryPagePairs ?? []}
                    />
                  )}

                  {/* ── OPPORTUNITIES ── */}
                  {tab === 1 && (
                    <OpportunitiesPanel
                      oppCount={data?.opportunities?.length ?? 0}
                      oppSearch={oppSearch}
                      setOppSearch={setOppSearch}
                      oppType={oppType}
                      setOppType={setOppType}
                      oppTypeOptions={oppTypeOptions}
                      oppRows={oppRows}
                      setOppSort={setOppSort}
                    />
                  )}

                  {/* ── CONTENT GAPS ── */}
                  {tab === 2 && (
                    <ContentGapsPanel
                      gaps={gaps}
                      gapFlags={gapFlags}
                      unpromotedCount={unpromotedGaps.length}
                      anyPromoting={anyPromoting}
                      onPromoteAll={() => promoteGaps(unpromotedGaps)}
                      onPromoteGap={(g) => promoteGaps([g])}
                      analysis={analysis}
                      analysisAt={analysisAt}
                      quickWinFlags={quickWinFlags}
                      onPlanQuickWin={(i, w) => planStrategy(i, w, setPromotingQw, setPromotedQw)}
                      recFlags={recFlags}
                      onPlanRecommendation={(i, r) => planStrategy(i, r, setPromotingRec, setPromotedRec)}
                      onOpenContentPilot={() => router.push(withShopifyContextUrl("/content-pilot"))}
                    />
                  )}

                  {/* ── ON-PAGE HEALTH ── */}
                  {tab === 3 && (
                    <OnPageHealthPanel
                      health={health}
                      offenderFlags={offenderFlags}
                      onPromote={promoteOnPage}
                      onOpenContentPilot={() => router.push(withShopifyContextUrl("/content-pilot"))}
                    />
                  )}

                  {/* ── KEYWORDS ── */}
                  {tab === 4 && (
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h2">Tracked keyword positions</Text>
                      <Text as="p" tone="subdued">Positions are derived from your GSC snapshots. Add target keywords to monitor rank movement and get drop alerts.</Text>
                      <InlineStack gap="200" blockAlign="end" wrap>
                        <div style={{ minWidth: 280 }}>
                          <TextField label="Add keyword" labelHidden autoComplete="off" value={newKeyword} onChange={setNewKeyword} placeholder="e.g. organic black rice philippines" />
                        </div>
                        <Button onClick={addKeyword}>Track</Button>
                        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                          <TextField label="Search keywords" labelHidden placeholder="Search…" value={kwSearch} onChange={setKwSearch}
                            autoComplete="off" clearButton onClearButtonClick={() => setKwSearch("")} />
                        </div>
                      </InlineStack>
                      {keywords.length === 0 ? <Text as="p" tone="subdued">No keywords tracked yet.</Text> : (
                        <DataTable
                          columnContentTypes={["text", "numeric", "text", "numeric", "numeric", "text"]}
                          headings={["Keyword", "Position", "Δ Pos", "Clicks", "Impr.", "Status"]}
                          sortable={[true, true, true, true, true, false]}
                          onSort={(index, direction) => {
                            if (direction === "none") setKwSort(null);
                            else setKwSort({ index, dir: direction });
                          }}
                          rows={keywords
                            .filter((k) => !kwSearch || k.keyword.toLowerCase().includes(kwSearch.toLowerCase()))
                            .sort((a, b) => {
                              if (!kwSort) return 0;
                              const dir = kwSort.dir === "ascending" ? 1 : -1;
                              switch (kwSort.index) {
                                case 0: return dir * a.keyword.localeCompare(b.keyword);
                                case 1: return dir * ((a.position ?? Number.MAX_VALUE) - (b.position ?? Number.MAX_VALUE));
                                case 2: return dir * ((a.positionDelta ?? 0) - (b.positionDelta ?? 0));
                                case 3: return dir * (a.clicks - b.clicks);
                                case 4: return dir * (a.impressions - b.impressions);
                                default: return 0;
                              }
                            })
                            .map((k) => [
                            k.keyword,
                            k.position === null ? "—" : k.position.toFixed(1),
                            k.positionDelta === null ? "—" : `${k.positionDelta < 0 ? "▲" : "▼"} ${Math.abs(k.positionDelta).toFixed(1)}`,
                            String(k.clicks),
                            String(k.impressions),
                            <Badge key={k.keyword} tone={k.alert ? "critical" : k.status === "improved" ? "success" : k.status === "declined" ? "warning" : undefined}>
                              {k.alert ? "Drop alert" : k.status}
                            </Badge>,
                          ])}
                        />
                      )}
                    </BlockStack>
                  )}

                  {/* ── PILLAR CLUSTERS ── */}
                  {tab === 5 && (
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h2">Pillar / topic-cluster gaps</Text>
                      <Text as="p" tone="subdued">Clusters with high gap scores have the least supporting content — strong candidates for new articles and pillar pages.</Text>
                      {clusters.length === 0 ? <Text as="p" tone="subdued">No cluster data. Index blog content in Content Pilot.</Text> : (
                        <DataTable
                          columnContentTypes={["text", "numeric", "numeric", "text"]}
                          headings={["Topic", "Articles", "Keywords", "Gap score"]}
                          rows={clusters.map((c, i) => [
                            c.topic,
                            String(c.articleCount ?? 0),
                            String(c.keywordCount ?? 0),
                            <Badge key={`${c.topic}-${i}`} tone={c.gapScore >= 80 ? "critical" : c.gapScore >= 40 ? "warning" : "success"}>{String(c.gapScore)}</Badge>,
                          ])}
                        />
                      )}
                    </BlockStack>
                  )}

                  {/* ── PAGE HEALTH ── */}
                  {tab === 6 && (
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h2">Page health (GSC × GA4)</Text>
                      <Text as="p" tone="subdued">High-impression landing pages whose engagement signals (bounce, conversion) suggest the page is underperforming its search demand. Flagged pages lead.</Text>
                      {flaggedPageHealth.length === 0 ? (
                        <Text as="p" tone="subdued">
                          {pageHealth.length === 0
                            ? "No page health data yet — appears after the next GSC + GA4 data fetch."
                            : "No flagged pages. All high-impression pages are engaging well."}
                        </Text>
                      ) : (
                        <DataTable
                          columnContentTypes={["text", "numeric", "numeric", "numeric", "text"]}
                          headings={["URL", "Impr.", "Bounce", "Conversion", "Flag"]}
                          rows={flaggedPageHealth.map((p, i) => [
                            <Button key={`ph-${p.rawUrl}-${i}`} variant="plain" url={p.rawUrl} external>{p.url}</Button>,
                            p.impressions.toLocaleString(),
                            fmtPct(p.bounceRate),
                            fmtPct(p.conversionRate),
                            p.flag
                              ? <Badge key={`phf-${p.rawUrl}-${i}`} tone={PAGE_HEALTH_FLAG[p.flag]?.tone}>{PAGE_HEALTH_FLAG[p.flag]?.label ?? p.flag}</Badge>
                              : <Text key={`phf-${p.rawUrl}-${i}`} as="span" tone="subdued">—</Text>,
                          ])}
                        />
                      )}
                    </BlockStack>
                  )}

                  {/* ── OPPORTUNITY CLUSTERS ── */}
                  {tab === 7 && (
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h2">Opportunity clusters</Text>
                      <Text as="p" tone="subdued">Near-duplicate queries grouped into a single action. Tackle the highest-scoring cluster first — one title/meta rewrite can lift the whole group.</Text>
                      {(data?.clusters ?? []).length === 0 ? (
                        <Text as="p" tone="subdued">No opportunity clusters yet. Fetch fresh GSC data first.</Text>
                      ) : (
                        (data?.clusters ?? []).map((c) => (
                          <Card key={c.id}>
                            <BlockStack gap="200">
                              <InlineStack align="space-between" blockAlign="center" wrap>
                                <Text variant="headingSm" as="h3">{c.label}</Text>
                                <InlineStack gap="200" blockAlign="center">
                                  <Badge tone="info">{`${c.opportunities.length} quer${c.opportunities.length === 1 ? "y" : "ies"}`}</Badge>
                                  <Badge tone="success">{`+${c.totalPotentialClicks} potential`}</Badge>
                                </InlineStack>
                              </InlineStack>
                              {c.page
                                ? <Button variant="plain" url={c.page} external>{pagePath(c.page)}</Button>
                                : <Text as="span" tone="subdued" variant="bodySm">No mapped landing page</Text>}
                              <details>
                                <summary style={{ cursor: "pointer" }}>
                                  <Text as="span" tone="subdued" variant="bodySm">Show member queries</Text>
                                </summary>
                                <div style={{ marginTop: "var(--p-space-200)" }}>
                                  <DataTable
                                    columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                                    headings={["Query", "Impr.", "Position", "Potential"]}
                                    rows={c.opportunities.map((o, i) => [
                                      o.query,
                                      o.impressions.toLocaleString(),
                                      o.position.toFixed(1),
                                      <Text key={`oc-${c.id}-${o.query}-${i}`} as="span" fontWeight="semibold">+{o.potentialClicks}</Text>,
                                    ])}
                                  />
                                </div>
                              </details>
                            </BlockStack>
                          </Card>
                        ))
                      )}
                    </BlockStack>
                  )}

                  {tab === 8 && (
                    <BlockStack gap="500">
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center" wrap>
                          <Text variant="headingMd" as="h2">Keyword strategy</Text>
                          <Button
                            variant="primary"
                            size="slim"
                            loading={trackingAll}
                            onClick={trackAllPrimary}
                          >
                            {`Track all ${ALL_PRIMARY_KEYWORDS.length} primary`}
                          </Button>
                        </InlineStack>
                        <Text as="p" tone="subdued">
                          From the June 2026 keyword research report. Volume/difficulty are analyst proxy bands — Track a keyword to replace them with real GSC data, or Plan it to create the right Content Pilot proposal.
                        </Text>
                      </BlockStack>

                      {/* Clusters */}
                      <BlockStack gap="300">
                        <Text variant="headingSm" as="h3">Clusters</Text>
                        {KEYWORD_CLUSTERS.map((c) => (
                          <Card key={c.id}>
                            <BlockStack gap="150">
                              <InlineStack align="space-between" blockAlign="center" wrap>
                                <Text variant="headingSm" as="h4">{c.name}</Text>
                                <Text as="span" tone="subdued" variant="bodySm">{c.intent}</Text>
                              </InlineStack>
                              <Text as="p" tone="subdued" variant="bodySm">{c.why}</Text>
                              <InlineStack gap="150" wrap>
                                {c.coreKeywords.map((k) => <Badge key={k}>{k}</Badge>)}
                              </InlineStack>
                            </BlockStack>
                          </Card>
                        ))}
                      </BlockStack>

                      {/* Primary targets */}
                      <BlockStack gap="200">
                        <Text variant="headingSm" as="h3">Primary targets</Text>
                        <DataTable
                          columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                          headings={["Keyword", "Volume", "Difficulty", "Recommended page", "Priority", "Actions"]}
                          rows={PRIMARY_TARGETS.map((t: PrimaryTarget) => {
                            const rec = `Build a ${t.pageType} targeting the keyword "${t.keyword}" (${t.intent.toLowerCase()} intent, ${KEYWORD_CLUSTERS.find((c) => c.id === t.cluster)?.name ?? t.cluster} cluster).`;
                            return [
                              <Text key={`k-${t.keyword}`} as="span" fontWeight="semibold">{t.keyword}</Text>,
                              t.volumeBand,
                              t.difficulty,
                              t.pageType,
                              <Badge key={`p-${t.keyword}`} tone={t.priority === "Very high" ? "success" : t.priority === "High" ? "info" : undefined}>{t.priority}</Badge>,
                              <InlineStack key={`a-${t.keyword}`} gap="200" wrap={false}>
                                {trackedKw.has(t.keyword)
                                  ? <Badge tone="success">Tracking</Badge>
                                  : <Button size="slim" loading={trackingKw.has(t.keyword)} onClick={() => trackKeyword(t.keyword)}>Track</Button>}
                                {plannedKw.has(t.keyword)
                                  ? <Badge tone="success">Planned</Badge>
                                  : <Button size="slim" loading={planningKw.has(t.keyword)} onClick={() => planTarget(t.keyword, t.keyword, rec)}>Plan it</Button>}
                              </InlineStack>,
                            ];
                          })}
                        />
                      </BlockStack>

                      {/* Six-month roadmap */}
                      <BlockStack gap="200">
                        <Text variant="headingSm" as="h3">Six-month roadmap</Text>
                        <DataTable
                          columnContentTypes={["text", "text", "text", "text", "text"]}
                          headings={["Month", "Title", "Target keyword", "Format", "Action"]}
                          rows={ROADMAP.map((r) => {
                            const key = `rm:${r.title}`;
                            const rec = `${r.format}: "${r.title}" targeting "${r.targetKeyword}" (${r.intent.toLowerCase()} intent). Internally link to ${r.primaryLinkTarget}.`;
                            return [
                              r.month,
                              r.title,
                              r.targetKeyword,
                              r.format,
                              plannedKw.has(key)
                                ? <Badge key={`rb-${key}`} tone="success">Planned</Badge>
                                : <Button key={`ra-${key}`} size="slim" loading={planningKw.has(key)} onClick={() => planTarget(key, r.targetKeyword, rec)}>Plan it</Button>,
                            ];
                          })}
                        />
                      </BlockStack>

                      {/* Secondary bank */}
                      <BlockStack gap="200">
                        <Text variant="headingSm" as="h3">{`Secondary bank (${SECONDARY_BANK.length})`}</Text>
                        <DataTable
                          columnContentTypes={["text", "text", "text", "text", "text"]}
                          headings={["Keyword", "Intent", "Volume", "Suggested page", "Action"]}
                          rows={SECONDARY_BANK.map((s) => [
                            s.keyword,
                            s.intent,
                            s.volumeBand,
                            s.targetPage,
                            trackedKw.has(s.keyword)
                              ? <Badge key={`sb-${s.keyword}`} tone="success">Tracking</Badge>
                              : <Button key={`sa-${s.keyword}`} size="slim" loading={trackingKw.has(s.keyword)} onClick={() => trackKeyword(s.keyword)}>Track</Button>,
                          ])}
                        />
                      </BlockStack>
                    </BlockStack>
                  )}
                </>
              )}
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
