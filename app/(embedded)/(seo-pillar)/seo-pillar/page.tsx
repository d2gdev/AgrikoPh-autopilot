"use client";

import {
  Page, Layout, Card, Text, Badge, InlineStack, BlockStack, Banner,
  Button, Spinner, Tooltip,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { analysisCompletionToast } from "./components/types";
import { useSeoData } from "./components/useSeoData";
import { OverviewPanel } from "./components/panels/OverviewPanel";
import { OpportunitiesPanel } from "./components/panels/OpportunitiesPanel";
import { ContentGapsPanel } from "./components/panels/ContentGapsPanel";
import { SeoPilotNavigation } from "./components/SeoPilotNavigation";
import { MapOverviewPanel } from "./components/panels/MapOverviewPanel";
import { MapPagesPanel } from "./components/panels/MapPagesPanel";
import { MapWorkPanel } from "./components/panels/MapWorkPanel";
import type { MapAwareSeoGap } from "@/lib/seo/analysis";
import { submitMapProposal } from "./components/map-proposal-action";

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

const OPP_LABEL: Record<string, string> = {
  low_ctr: "Low CTR",
  striking_distance: "Striking distance",
  high_impression_no_click: "No clicks",
};

// difficulty 0–100 → band + Badge tone
const diffBand = (d: number): { tone: "success" | "warning" | "critical"; label: string } =>
  d < 34 ? { tone: "success", label: "Low" } : d < 67 ? { tone: "warning", label: "Med" } : { tone: "critical", label: "High" };

export default function SeoPillarReportPage() {
  const authFetch = useAuthFetch();

  const {
    data, loading,
    analysis, setAnalysis, setAnalysisAt,
    trend, trendFirst, trendLast,
    refreshing, loadError, setLoadError, toast, setToast, mapState, mapAnalysisState,
    refreshData,
  } = useSeoData();
  const [tab, setTab] = useState(0);

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [promotingMap, setPromotingMap] = useState<Set<string>>(new Set());
  const [promotedMap, setPromotedMap] = useState<Set<string>>(new Set());
  // AI SEO brief (ported from the retired /seo page)
  const [brief, setBrief] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  // Opportunities / Keywords tab controls
  const [oppSearch, setOppSearch] = useState("");
  const [oppType, setOppType] = useState("all");
  const [oppSort, setOppSort] = useState<{ index: number; dir: "ascending" | "descending" } | null>(null);

  const runSeoAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await authFetch("/api/seo/analyze", { method: "POST" });
      const d = await res.json();
      if (res.ok) {
        setAnalysis(d.analysis);
        setAnalysisAt(d.generatedAt ?? null);
        setTab(2);
        setToast(analysisCompletionToast(d.analysis));
      } else setAnalysisError(d.error ?? "AI analysis failed.");
    } catch { setAnalysisError("AI analysis failed. Please try again."); }
    finally { setAnalyzing(false); }
  }, [authFetch]);

  const proposeMapGap = useCallback(async (gap: MapAwareSeoGap) => {
    const key = gap.ruleIds.join("|");
    setPromotingMap(current => new Set([...current, key]));
    try {
      const result = await submitMapProposal(authFetch, gap);
      if (result.resolved) setPromotedMap(current => new Set([...current, key]));
      setToast(result.message);
    } catch { setToast("Could not create governed proposal."); }
    finally { setPromotingMap(current => { const next = new Set(current); next.delete(key); return next; }); }
  }, [authFetch]);

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
  const visibleOpportunities = data?.opportunities ?? [];
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
    <Button key={`a-${o.query}`} size="slim" disabled accessibilityLabel={`No map rule association for ${o.query}`}>No map rule association</Button>,
  ]);

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
    { id: "overview", content: "Map overview", label: "Map overview" },
    { id: "pages", content: "Pages & ownership", label: "Pages & ownership" },
    { id: "gaps", content: "Content gaps", label: "Content gaps" },
    { id: "work", content: "Links & technical", label: "Links & technical" },
    { id: "evidence", content: "Search evidence", label: "Search evidence" },
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
            <SeoPilotNavigation tabs={tabs} selected={tab} onSelect={setTab} />
            <div style={{ padding: "var(--p-space-400)" }}>
              {loading ? (
                <InlineStack gap="200" blockAlign="center"><Spinner size="small" /><Text as="span">Loading…</Text></InlineStack>
              ) : (
                <>
                  {/* ── OVERVIEW ── */}
                  {tab === 0 && (mapState.state === "ready" ? <MapOverviewPanel mapState={mapState}/> : <ContentGapsPanel mapState={mapState} analysisState={mapAnalysisState} busy={promotingMap} done={promotedMap} onPropose={proposeMapGap}/>)}

                  {/* ── OPPORTUNITIES ── */}
                  {tab === 1 && (mapState.state === "ready" ? <MapPagesPanel map={mapState.commandCenter}/> : <ContentGapsPanel mapState={mapState} analysisState={mapAnalysisState} busy={promotingMap} done={promotedMap} onPropose={proposeMapGap}/>)}

                  {/* ── CONTENT GAPS ── */}
                  {tab === 2 && (
                    <ContentGapsPanel mapState={mapState} analysisState={mapAnalysisState} busy={promotingMap} done={promotedMap} onPropose={proposeMapGap}/>
                  )}

                  {/* ── ON-PAGE HEALTH ── */}
                  {tab === 3 && (mapState.state === "ready" ? <MapWorkPanel map={mapState.commandCenter} gaps={mapAnalysisState.state === "ready" ? mapAnalysisState.analysis.gaps : []} busy={promotingMap} done={promotedMap} onPropose={proposeMapGap}/> : <ContentGapsPanel mapState={mapState} analysisState={mapAnalysisState} busy={promotingMap} done={promotedMap} onPropose={proposeMapGap}/>)}

                  {/* ── KEYWORDS ── */}
                  {tab === 4 && <BlockStack gap="500"><OverviewPanel brief={brief} cur={cur} prev={prev} gscFetchedAt={data?.gscFetchedAt} gscFreshness={data?.gscFreshness} ga4FetchedAt={data?.ga4FetchedAt} ga4Freshness={data?.ga4Freshness} previousFetchedAt={t?.previousFetchedAt} trend={trend} trendFirst={trendFirst} trendLast={trendLast} moverRows={moverRows} pageRows={pageRows} queryRows={queryRows} gscPages={data?.gscPages ?? []} queryPagePairs={data?.queryPagePairs ?? []}/><OpportunitiesPanel oppCount={visibleOpportunities.length} oppSearch={oppSearch} setOppSearch={setOppSearch} oppType={oppType} setOppType={setOppType} oppTypeOptions={oppTypeOptions} oppRows={oppRows} oppSort={oppSort} setOppSort={setOppSort}/></BlockStack>}

                </>
              )}
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
