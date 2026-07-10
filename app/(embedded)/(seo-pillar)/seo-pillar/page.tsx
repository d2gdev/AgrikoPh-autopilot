"use client";

import {
  Page, Layout, Card, Text, Badge, InlineStack, BlockStack, DataTable, Banner,
  Button, TextField, Tabs, Spinner, Tooltip, List, Select,
} from "@shopify/polaris";
import { useState, useCallback, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { useAuthFetch, withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { KEYWORD_CLUSTERS, PRIMARY_TARGETS, SECONDARY_BANK, ROADMAP, ALL_PRIMARY_KEYWORDS, type PrimaryTarget } from "@/lib/seo/keyword-strategy";
import { timeAgo } from "@/lib/format";
import type {
  Query, PageRow, Totals, Mover, Trends, Opportunity, OpportunityCluster,
  PageHealthRow, GscPage, QueryPagePair,
  ContentGap, HealthTotals, HealthOffender,
} from "./components/types";
import { gapKey, opportunityKey, fmtPct } from "./components/types";
import { useSeoData } from "./components/useSeoData";
import { OverviewPanel } from "./components/panels/OverviewPanel";
import { OpportunitiesPanel } from "./components/panels/OpportunitiesPanel";
import { ContentGapsPanel } from "./components/panels/ContentGapsPanel";
import { OnPageHealthPanel } from "./components/panels/OnPageHealthPanel";
import { KeywordsPanel } from "./components/panels/KeywordsPanel";
import { PillarClustersPanel } from "./components/panels/PillarClustersPanel";
import { PageHealthPanel } from "./components/panels/PageHealthPanel";
import { OpportunityClustersPanel } from "./components/panels/OpportunityClustersPanel";
import { StrategyPanel } from "./components/panels/StrategyPanel";

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

  const {
    data, loading,
    analysis, setAnalysis, analysisAt, setAnalysisAt,
    health, keywords, setKeywords, clusters, trend, trendFirst, trendLast,
    refreshing, loadError, setLoadError, toast, setToast,
    refreshData,
  } = useSeoData();
  const [tab, setTab] = useState(0);

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

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
        if (d.created > 0 || d.skipped > 0) {
          setPromoted((s) => new Set([...s, ...keys]));
        }
        if (d.created > 0) {
          setToast(`Created ${d.created} draft proposal${d.created === 1 ? "" : "s"} in Content Pilot${d.skipped ? ` (${d.skipped} already handled or not promotable)` : ""}.`);
        } else if (d.skipped > 0) {
          setToast(`${d.skipped} gap${d.skipped === 1 ? "" : "s"} already handled or not promotable — removed from this view.`);
        } else {
          setToast("No proposals created.");
        }
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
        if (d.created > 0 || d.skipped > 0) {
          setPromotedOpp((s) => new Set([...s, key]));
        }
        if (d.created > 0) {
          setToast("Created draft proposal in Content Pilot.");
        } else if (d.skipped > 0) {
          setToast("Already handled or not promotable — removed from this view.");
        } else {
          setToast("No proposal created.");
        }
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
  const visibleOpportunities = (data?.opportunities ?? []).filter((o) => !promotedOpp.has(opportunityKey(o)));
  const filteredOpps = visibleOpportunities
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

  const gaps = (analysis?.contentGaps ?? []).filter((g) => !promoted.has(gapKey(g)));

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
        {analysis?.aiStatus === "partial" && (
          <Layout.Section>
            <Banner tone="warning" title="AI strategy is incomplete"><p>Programmatic findings are available, but AI strategy text failed. Retry AI Analysis to complete it.</p></Banner>
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
                      oppCount={visibleOpportunities.length}
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
                      unpromotedCount={gaps.length}
                      anyPromoting={anyPromoting}
                      onPromoteAll={() => promoteGaps(gaps)}
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
                    <KeywordsPanel
                      keywords={keywords}
                      newKeyword={newKeyword}
                      setNewKeyword={setNewKeyword}
                      addKeyword={addKeyword}
                      kwSearch={kwSearch}
                      setKwSearch={setKwSearch}
                      kwSort={kwSort}
                      setKwSort={setKwSort}
                    />
                  )}

                  {/* ── PILLAR CLUSTERS ── */}
                  {tab === 5 && (
                    <PillarClustersPanel clusters={clusters} />
                  )}

                  {/* ── PAGE HEALTH ── */}
                  {tab === 6 && (
                    <PageHealthPanel
                      pageHealth={pageHealth}
                      flaggedPageHealth={flaggedPageHealth}
                      pageHealthFlag={PAGE_HEALTH_FLAG}
                    />
                  )}

                  {/* ── OPPORTUNITY CLUSTERS ── */}
                  {tab === 7 && (
                    <OpportunityClustersPanel
                      clusters={data?.clusters ?? []}
                      pagePath={pagePath}
                    />
                  )}

                  {tab === 8 && (
                    <StrategyPanel
                      trackingAll={trackingAll}
                      trackAllPrimary={trackAllPrimary}
                      trackedKw={trackedKw}
                      trackingKw={trackingKw}
                      trackKeyword={trackKeyword}
                      plannedKw={plannedKw}
                      planningKw={planningKw}
                      planTarget={planTarget}
                    />
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
