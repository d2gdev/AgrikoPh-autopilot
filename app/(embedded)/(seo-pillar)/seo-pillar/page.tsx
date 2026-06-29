"use client";

import {
  Page, Layout, Card, Text, Badge, InlineStack, BlockStack, DataTable, Banner,
  Button, TextField, Tabs, Spinner, Tooltip,
} from "@shopify/polaris";
import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { useAuthFetch, withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { getCache, setCache } from "@/lib/client-cache";
import { KEYWORD_CLUSTERS, PRIMARY_TARGETS, SECONDARY_BANK, ROADMAP, ALL_PRIMARY_KEYWORDS, type PrimaryTarget } from "@/lib/seo/keyword-strategy";

// ── response types ──
interface Query { query: string; clicks: number; impressions: number; ctr: string; position: string }
interface PageRow { page: string; sessions: number; [key: string]: unknown }
interface Totals { clicks: number; impressions: number; avgCtr: number; avgPosition: number }
interface Mover { query: string; clicks: number; clicksDelta: number; impressionsDelta: number; positionDelta: number; direction: "up" | "down" }
interface Trends { current: Totals; previous: Totals | null; currentFetchedAt: string | null; previousFetchedAt: string | null; movers: Mover[] }
interface Opportunity { query: string; impressions: number; clicks: number; ctr: number; position: number; type: string; potentialClicks: number; reason: string; page?: string | null; pageClicks?: number | null; pageImpressions?: number | null; score?: number; volume?: number | null; difficulty?: number | null }
interface OpportunityCluster { id: string; label: string; page: string | null; opportunities: Opportunity[]; totalPotentialClicks: number; topScore: number }
interface SnapshotTrendPoint { date: string; clicks: number; impressions: number; avgPosition: number; ctr: number }
interface PageHealthRow { url: string; rawUrl: string; impressions: number; clicks: number; position: number; sessions: number | null; bounceRate: number | null; conversionRate: number | null; flag: "high-impressions-high-bounce" | "high-impressions-low-conversion" | null; severity: number }
interface GscPage { page: string; clicks: number; impressions: number; ctr: string; position: string }
interface QueryPagePair { query: string; page: string; clicks: number; impressions: number; position: string }
interface SeoData {
  topQueries: Query[]; topPages: PageRow[]; gscFetchedAt: string | null; ga4FetchedAt: string | null;
  trends: Trends | null; opportunities: Opportunity[];
  gscPages: GscPage[]; queryPagePairs: QueryPagePair[];
  pageHealth?: PageHealthRow[];
  clusters?: OpportunityCluster[];
}
interface ContentGap { query: string; impressions: number; position: number; suggestedTitle: string }
interface Analysis { summary?: string; quickWins?: string[]; contentGaps?: ContentGap[]; recommendations?: string[] }
interface HealthTotals { total: number; missingMeta: number; thinContent: number; noInternalLinks: number; lowHeadings: number; orphan: number; titleLengthOff?: number; descLengthOff?: number; missingDesc?: number; missingH1?: number; duplicateTitle?: number }
interface HealthOffender { handle: string; title: string; wordCount: number; issues: string[] }
interface Health { totals: HealthTotals; worstOffenders: HealthOffender[] }
interface KeywordRow { keyword: string; position: number | null; clicks: number; impressions: number; positionDelta: number | null; status: string; alert: boolean }
interface Cluster { topic: string; articleCount: number; keywordCount: number; gapScore: number }

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return "< 1h ago";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const gapKey = (g: { query: string; suggestedTitle: string }) => `${g.query}::${g.suggestedTitle}`;

// fractions 0–1 → "x.x%", null → "—"
const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);

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

// delta chip: shows change vs previous period. lowerIsBetter for position.
function Delta({ curr, prev, lowerIsBetter = false, suffix = "" }: { curr: number; prev: number | null | undefined; lowerIsBetter?: boolean; suffix?: string }) {
  if (prev === null || prev === undefined) return null;
  const diff = curr - prev;
  if (Math.abs(diff) < 0.0001) return <Text as="span" tone="subdued" variant="bodySm">no change</Text>;
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  const arrow = diff > 0 ? "▲" : "▼";
  const val = Math.abs(diff);
  const shown = suffix === "%" ? `${(val * 100).toFixed(1)}%` : Number.isInteger(val) ? val.toLocaleString() : val.toFixed(1);
  return <Text as="span" tone={better ? "success" : "critical"} variant="bodySm">{arrow} {shown}{suffix && suffix !== "%" ? suffix : ""}</Text>;
}

// difficulty 0–100 → band + Badge tone
const diffBand = (d: number): { tone: "success" | "warning" | "critical"; label: string } =>
  d < 34 ? { tone: "success", label: "Low" } : d < 67 ? { tone: "warning", label: "Med" } : { tone: "critical", label: "High" };

// lightweight inline SVG line chart — no dependency
function Sparkline({ points, color = "#2c6ecb", height = 40, width = 220 }: { points: number[]; color?: string; height?: number; width?: number }) {
  if (points.length === 0) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-hidden>
      <polyline fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={coords.join(" ")} />
    </svg>
  );
}

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

  const loadCore = useCallback(async () => {
    const r = await authFetch("/api/seo");
    const d = await r.json() as SeoData;
    setCache("/api/seo", d);
    setData(d);
  }, [authFetch]);

  useEffect(() => {
    const okJson = async (url: string, section: string) => {
      const r = await authFetch(url);
      if (!r.ok) throw new Error(section);
      return r.json();
    };
    const failed: string[] = [];
    const track = (p: Promise<unknown>, section: string) =>
      p.catch((e) => { failed.push(section); throw e; });
    Promise.allSettled([
      track(okJson("/api/seo", "SEO data").then((d) => { setCache("/api/seo", d); setData(d as SeoData); }), "SEO data"),
      track(okJson("/api/seo/analysis", "AI analysis").then((d) => { setAnalysis(d.analysis ?? null); setAnalysisAt(d.generatedAt ?? null); }), "AI analysis"),
      track(okJson("/api/seo/health", "On-page health").then((d) => setHealth(d?.totals ? d : null)), "On-page health"),
      track(okJson("/api/seo/keywords", "Keywords").then((d) => setKeywords(d.keywords ?? [])), "Keywords"),
      track(okJson("/api/content-pilot/topic-clusters", "Pillar clusters").then((d) => setClusters(d.clusters ?? [])), "Pillar clusters"),
      track(okJson("/api/seo/history?source=gsc", "Trend").then((d) => setTrend(d.trend ?? [])), "Trend"),
    ]).then(() => {
      if (failed.length) setLoadError(`Some sections failed to load: ${failed.join(", ")}. Try Refresh data.`);
    }).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshData = useCallback(async () => {
    setRefreshing(true);
    setToast(null);
    try {
      const res = await authFetch("/api/seo/refresh", { method: "POST" });
      if (res.status === 409) setToast("A data fetch is already running — try again shortly.");
      else if (!res.ok) setToast("Refresh failed.");
      else { await loadCore(); setToast("SEO data refreshed."); }
    } catch { setToast("Refresh failed."); }
    finally { setRefreshing(false); }
  }, [authFetch, loadCore]);

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
    setPromotingOpp((s) => new Set([...s, o.query]));
    try {
      const suggestedTitle = `${o.query.charAt(0).toUpperCase() + o.query.slice(1)}: A Complete Guide`;
      const res = await authFetch("/api/seo/gaps/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gaps: [{ query: o.query, impressions: o.impressions, position: o.position, suggestedTitle }] }),
      });
      const d = await res.json();
      if (res.ok) {
        setPromotedOpp((s) => new Set([...s, o.query]));
        setToast(`Created draft proposal in Content Pilot${d.skipped ? " (already exists)" : ""}.`);
      } else setToast(d.error ?? "Could not create proposal.");
    } catch { setToast("Could not create proposal."); }
    finally { setPromotingOpp((s) => { const n = new Set(s); n.delete(o.query); return n; }); }
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
  }, [authFetch, router]);

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

  const oppRows = (data?.opportunities ?? []).map((o) => [
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
    promotedOpp.has(o.query)
      ? <Badge key={`a-${o.query}`} tone="success">Created</Badge>
      : <Button key={`a-${o.query}`} size="slim" loading={promotingOpp.has(o.query)} onClick={() => promoteOpportunity(o)}>Create brief</Button>,
  ]);

  // page health — already sorted by severity desc; flagged rows lead
  const pageHealth = data?.pageHealth ?? [];
  const flaggedPageHealth = pageHealth.filter((p) => p.flag !== null);

  const gaps = analysis?.contentGaps ?? [];
  const unpromotedGaps = gaps.filter((g) => !promoted.has(gapKey(g)));

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
        { content: "SEO Details", onAction: () => router.push(withShopifyContextUrl("/seo")) },
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
                    <BlockStack gap="400">
                      <InlineStack gap="400" wrap>
                        {[
                          { label: "Total Clicks", val: cur?.clicks?.toLocaleString() ?? "—", node: cur && <Delta curr={cur.clicks} prev={prev?.clicks} /> },
                          { label: "Impressions", val: cur?.impressions?.toLocaleString() ?? "—", node: cur && <Delta curr={cur.impressions} prev={prev?.impressions} /> },
                          { label: "Avg CTR", val: cur ? `${(cur.avgCtr * 100).toFixed(1)}%` : "—", node: cur && <Delta curr={cur.avgCtr} prev={prev?.avgCtr} suffix="%" /> },
                          { label: "Avg Position", val: cur ? cur.avgPosition.toFixed(1) : "—", node: cur && <Delta curr={cur.avgPosition} prev={prev?.avgPosition} lowerIsBetter /> },
                        ].map((m) => (
                          <Card key={m.label}>
                            <BlockStack gap="100">
                              <Text variant="headingSm" as="h3" tone="subdued">{m.label}</Text>
                              <Text variant="heading2xl" as="p">{m.val}</Text>
                              {m.node}
                            </BlockStack>
                          </Card>
                        ))}
                      </InlineStack>
                      {data?.gscFetchedAt && (
                        <Text as="p" tone="subdued" variant="bodySm">
                          GSC updated {timeAgo(data.gscFetchedAt)}{t?.previousFetchedAt ? ` · compared to ${timeAgo(t.previousFetchedAt)}` : " · no prior period to compare yet"}
                        </Text>
                      )}

                      <Card>
                        <BlockStack gap="300">
                          <Text variant="headingMd" as="h2">Trend over time</Text>
                          {trend.length === 0 || !trendFirst || !trendLast ? (
                            <Text as="p" tone="subdued">No trend yet — appears once at least one GSC snapshot exists.</Text>
                          ) : (
                            <InlineStack gap="600" wrap blockAlign="start">
                              <BlockStack gap="100">
                                <Text variant="headingSm" as="h3" tone="subdued">Clicks</Text>
                                <Sparkline points={trend.map((p) => p.clicks)} color="#2c6ecb" />
                                <Text as="span" variant="bodySm" tone="subdued">{trendFirst.clicks.toLocaleString()} → {trendLast.clicks.toLocaleString()}</Text>
                              </BlockStack>
                              <BlockStack gap="100">
                                <Text variant="headingSm" as="h3" tone="subdued">Impressions</Text>
                                <Sparkline points={trend.map((p) => p.impressions)} color="#9c6ade" />
                                <Text as="span" variant="bodySm" tone="subdued">{trendFirst.impressions.toLocaleString()} → {trendLast.impressions.toLocaleString()}</Text>
                              </BlockStack>
                              <BlockStack gap="100">
                                <Text variant="headingSm" as="h3" tone="subdued">Avg position</Text>
                                <Sparkline points={trend.map((p) => -p.avgPosition)} color="#47c1bf" />
                                <Text as="span" variant="bodySm" tone="subdued">{trendFirst.avgPosition.toFixed(1)} → {trendLast.avgPosition.toFixed(1)}</Text>
                              </BlockStack>
                            </InlineStack>
                          )}
                        </BlockStack>
                      </Card>

                      <Layout>
                        <Layout.Section variant="oneHalf">
                          <Card>
                            <BlockStack gap="300">
                              <Text variant="headingMd" as="h2">Movers</Text>
                              {moverRows.length === 0 ? (
                                <Text as="p" tone="subdued">No prior period to compare yet. Movers appear once two snapshots exist.</Text>
                              ) : (
                                <DataTable columnContentTypes={["text", "text", "text", "numeric"]} headings={["Query", "Δ Clicks", "Δ Pos", "Clicks"]} rows={moverRows} />
                              )}
                            </BlockStack>
                          </Card>
                        </Layout.Section>
                        <Layout.Section variant="oneHalf">
                          <Card>
                            <BlockStack gap="300">
                              <Text variant="headingMd" as="h2">Top Pages (GA4)</Text>
                              {pageRows.length === 0 ? <Text as="p" tone="subdued">No GA4 data yet.</Text> : (
                                <DataTable columnContentTypes={["text", "numeric"]} headings={["Page", "Sessions"]} rows={pageRows} />
                              )}
                            </BlockStack>
                          </Card>
                        </Layout.Section>
                      </Layout>

                      <Card>
                        <BlockStack gap="300">
                          <Text variant="headingMd" as="h2">Top Search Queries</Text>
                          {queryRows.length === 0 ? <Text as="p" tone="subdued">No GSC data yet.</Text> : (
                            <DataTable columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]} headings={["Query", "Clicks", "Impr.", "CTR", "Position"]} rows={queryRows} />
                          )}
                        </BlockStack>
                      </Card>

                      <Layout>
                        <Layout.Section variant="oneHalf">
                          <Card>
                            <BlockStack gap="300">
                              <Text variant="headingMd" as="h2">Landing Pages (GSC)</Text>
                              {(data?.gscPages ?? []).length === 0 ? (
                                <Text as="p" tone="subdued">No GSC page data yet — appears after the next data fetch.</Text>
                              ) : (
                                <DataTable
                                  columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                                  headings={["Page", "Clicks", "Impr.", "Position"]}
                                  rows={(data?.gscPages ?? []).slice(0, 15).map((p) => [p.page, String(p.clicks), String(p.impressions), p.position])}
                                />
                              )}
                            </BlockStack>
                          </Card>
                        </Layout.Section>
                        <Layout.Section variant="oneHalf">
                          <Card>
                            <BlockStack gap="300">
                              <Text variant="headingMd" as="h2">Which Query → Which Page</Text>
                              {(data?.queryPagePairs ?? []).length === 0 ? (
                                <Text as="p" tone="subdued">No query×page data yet — appears after the next data fetch.</Text>
                              ) : (
                                <DataTable
                                  columnContentTypes={["text", "text", "numeric"]}
                                  headings={["Query", "Page", "Clicks"]}
                                  rows={(data?.queryPagePairs ?? []).slice(0, 15).map((qp) => [qp.query, qp.page, String(qp.clicks)])}
                                />
                              )}
                            </BlockStack>
                          </Card>
                        </Layout.Section>
                      </Layout>
                    </BlockStack>
                  )}

                  {/* ── OPPORTUNITIES ── */}
                  {tab === 1 && (
                    <BlockStack gap="300">
                      <Text variant="headingMd" as="h2">CTR & ranking opportunities</Text>
                      <Text as="p" tone="subdued">Queries where a title/meta rewrite or a small ranking push could win clicks you&apos;re already close to. &ldquo;Potential&rdquo; estimates extra monthly clicks at benchmark CTR.</Text>
                      {oppRows.length === 0 ? <Text as="p" tone="subdued">No opportunities surfaced. Fetch fresh GSC data first.</Text> : (
                        <DataTable
                          columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric", "numeric", "text", "numeric", "text"]}
                          headings={["Query", "Type", "Landing page", "Impr.", "CTR", "Position", "Volume", "Difficulty", "Potential", "Action"]}
                          rows={oppRows}
                          sortable={[false, false, false, true, false, false, true, false, true, false]}
                        />
                      )}
                    </BlockStack>
                  )}

                  {/* ── CONTENT GAPS ── */}
                  {tab === 2 && (
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="headingMd" as="h2">AI content-gap analysis</Text>
                        {gaps.length > 0 && (
                          <Button variant="primary" loading={[...promoting].length > 0} disabled={unpromotedGaps.length === 0}
                            onClick={() => promoteGaps(unpromotedGaps)}>
                            {`Create ${unpromotedGaps.length} draft${unpromotedGaps.length === 1 ? "" : "s"}`}
                          </Button>
                        )}
                      </InlineStack>
                      {!analysis ? (
                        <Text as="p" tone="subdued">No analysis yet. Click <b>AI Analysis</b> (top-right) to generate one from your latest GSC data.</Text>
                      ) : (
                        <>
                          {analysisAt && <Text as="p" tone="subdued" variant="bodySm">Generated {timeAgo(analysisAt)}</Text>}
                          {analysis.summary && <Text as="p">{analysis.summary}</Text>}
                          {(analysis.quickWins ?? []).length > 0 && (
                            <BlockStack gap="100">
                              <Text variant="headingSm" as="h3">Quick wins</Text>
                              {analysis.quickWins!.map((w, i) => (
                                <InlineStack key={i} gap="200" align="space-between" blockAlign="start" wrap={false}>
                                  <Text as="p">• {w}</Text>
                                  {promotedQw.has(i)
                                    ? <Badge tone="success">Planned</Badge>
                                    : <Button size="slim" loading={promotingQw.has(i)} onClick={() => planStrategy(i, w, setPromotingQw, setPromotedQw)}>Plan it</Button>}
                                </InlineStack>
                              ))}
                            </BlockStack>
                          )}
                          {gaps.length > 0 && (
                            <BlockStack gap="200">
                              <Text variant="headingSm" as="h3">Content gaps → draft proposals</Text>
                              <DataTable
                                columnContentTypes={["text", "numeric", "numeric", "text", "text"]}
                                headings={["Query", "Impr.", "Position", "Suggested title", "Action"]}
                                rows={gaps.map((g, i) => [
                                  g.query,
                                  Number(g.impressions ?? 0).toLocaleString(),
                                  Number(g.position ?? 0).toFixed(1),
                                  g.suggestedTitle,
                                  promoted.has(gapKey(g))
                                    ? <Badge key={`${gapKey(g)}-${i}`} tone="success">Created</Badge>
                                    : <Button key={`${gapKey(g)}-${i}`} size="slim" loading={promoting.has(gapKey(g))} onClick={() => promoteGaps([g])}>Create draft</Button>,
                                ])}
                              />
                              <InlineStack>
                                <Button variant="plain" onClick={() => router.push(withShopifyContextUrl("/content-pilot"))}>Open Content Pilot to review &amp; publish drafts →</Button>
                              </InlineStack>
                            </BlockStack>
                          )}
                          {(analysis.recommendations ?? []).length > 0 && (
                            <BlockStack gap="100">
                              <Text variant="headingSm" as="h3">Recommendations</Text>
                              {analysis.recommendations!.map((r, i) => (
                                <InlineStack key={i} gap="200" align="space-between" blockAlign="start" wrap={false}>
                                  <Text as="p">• {r}</Text>
                                  {promotedRec.has(i)
                                    ? <Badge tone="success">Planned</Badge>
                                    : <Button size="slim" loading={promotingRec.has(i)} onClick={() => planStrategy(i, r, setPromotingRec, setPromotedRec)}>Plan it</Button>}
                                </InlineStack>
                              ))}
                            </BlockStack>
                          )}
                        </>
                      )}
                    </BlockStack>
                  )}

                  {/* ── ON-PAGE HEALTH ── */}
                  {tab === 3 && (
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h2">On-page SEO health (blog articles)</Text>
                      {!health ? <Text as="p" tone="subdued">No indexed articles yet. Run blog indexing in Content Pilot.</Text> : (
                        <>
                          <InlineStack gap="300" wrap>
                            {[
                              { label: "Articles", val: health.totals.total, tone: undefined as "critical" | "caution" | undefined },
                              { label: "Missing meta", val: health.totals.missingMeta, tone: "critical" as const },
                              { label: "Thin (<300w)", val: health.totals.thinContent, tone: "caution" as const },
                              { label: "No internal links", val: health.totals.noInternalLinks, tone: "caution" as const },
                              { label: "Orphans", val: health.totals.orphan, tone: "caution" as const },
                              { label: "Missing desc", val: health.totals.missingDesc ?? 0, tone: "critical" as const },
                              { label: "Missing H1", val: health.totals.missingH1 ?? 0, tone: "critical" as const },
                              { label: "Title length off", val: health.totals.titleLengthOff ?? 0, tone: "caution" as const },
                              { label: "Desc length off", val: health.totals.descLengthOff ?? 0, tone: "caution" as const },
                              { label: "Duplicate title", val: health.totals.duplicateTitle ?? 0, tone: "caution" as const },
                            ].map((c) => (
                              <Card key={c.label}>
                                <BlockStack gap="100">
                                  <Text variant="headingSm" as="h3" tone="subdued">{c.label}</Text>
                                  <Text variant="headingXl" as="p" tone={c.tone}>{String(c.val)}</Text>
                                </BlockStack>
                              </Card>
                            ))}
                          </InlineStack>
                          {health.worstOffenders.length > 0 && (
                            <Card>
                              <BlockStack gap="300">
                                <Text variant="headingSm" as="h3">Needs attention</Text>
                                <DataTable
                                  columnContentTypes={["text", "numeric", "text", "text"]}
                                  headings={["Article", "Words", "Issues", "Actions"]}
                                  rows={health.worstOffenders.map((a) => {
                                    const issueTone = (iss: string): "critical" | "warning" | "info" => {
                                      if (["Missing meta title", "Missing meta description", "Missing H1"].includes(iss)) return "critical";
                                      if (["Thin content", "Title length off", "Description length off", "Duplicate title"].includes(iss)) return "warning";
                                      return "info";
                                    };
                                    const hasMeta = a.issues.some((i) => i === "Missing meta title" || i === "Missing meta description");
                                    const hasH1 = a.issues.includes("Missing H1");
                                    const hasThin = a.issues.includes("Thin content");
                                    const metaKey = `${a.handle}:missing-meta`;
                                    const h1Key = `${a.handle}:missing-h1`;
                                    const thinKey = `${a.handle}:thin-content`;
                                    return [
                                      <Button key={a.handle} variant="plain" onClick={() => router.push(withShopifyContextUrl("/content-pilot"))}>{a.title}</Button>,
                                      String(a.wordCount),
                                      <InlineStack key={`issues-${a.handle}`} gap="100" wrap>
                                        {a.issues.map((iss) => (
                                          <Badge key={iss} tone={issueTone(iss)}>{iss}</Badge>
                                        ))}
                                      </InlineStack>,
                                      <InlineStack key={`actions-${a.handle}`} gap="100" wrap>
                                        {hasMeta && (
                                          promotedOnPage.has(metaKey)
                                            ? <Badge key={metaKey} tone="success">Meta queued</Badge>
                                            : <Button key={`fix-meta-${a.handle}`} size="slim" loading={promotingOnPage.has(metaKey)} onClick={() => promoteOnPage(a.handle, a.title, "missing-meta", a.wordCount)}>Fix Meta</Button>
                                        )}
                                        {hasH1 && (
                                          promotedOnPage.has(h1Key)
                                            ? <Badge key={h1Key} tone="success">H1 queued</Badge>
                                            : <Button key={`fix-h1-${a.handle}`} size="slim" loading={promotingOnPage.has(h1Key)} onClick={() => promoteOnPage(a.handle, a.title, "missing-h1", a.wordCount)}>Fix H1</Button>
                                        )}
                                        {hasThin && (
                                          promotedOnPage.has(thinKey)
                                            ? <Badge key={thinKey} tone="success">Expand queued</Badge>
                                            : <Button key={`expand-${a.handle}`} size="slim" loading={promotingOnPage.has(thinKey)} onClick={() => promoteOnPage(a.handle, a.title, "thin-content", a.wordCount)}>Expand</Button>
                                        )}
                                      </InlineStack>,
                                    ];
                                  })}
                                />
                              </BlockStack>
                            </Card>
                          )}
                        </>
                      )}
                    </BlockStack>
                  )}

                  {/* ── KEYWORDS ── */}
                  {tab === 4 && (
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h2">Tracked keyword positions</Text>
                      <Text as="p" tone="subdued">Positions are derived from your GSC snapshots. Add target keywords to monitor rank movement and get drop alerts.</Text>
                      <InlineStack gap="200" blockAlign="end">
                        <div style={{ minWidth: 280 }}>
                          <TextField label="Add keyword" labelHidden autoComplete="off" value={newKeyword} onChange={setNewKeyword} placeholder="e.g. organic black rice philippines" />
                        </div>
                        <Button onClick={addKeyword}>Track</Button>
                      </InlineStack>
                      {keywords.length === 0 ? <Text as="p" tone="subdued">No keywords tracked yet.</Text> : (
                        <DataTable
                          columnContentTypes={["text", "numeric", "text", "numeric", "numeric", "text"]}
                          headings={["Keyword", "Position", "Δ Pos", "Clicks", "Impr.", "Status"]}
                          rows={keywords.map((k) => [
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
