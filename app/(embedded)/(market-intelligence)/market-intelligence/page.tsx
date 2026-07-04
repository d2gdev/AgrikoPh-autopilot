"use client";

import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Collapsible,
  DataTable,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Select,
  Badge,
  Spinner,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { getCache, setCache } from "@/lib/client-cache";
import { formatMoney, formatPhp } from "@/lib/format";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyMessage } from "@/components/ui/states";
import {
  AdCreativeCard,
  CompetitiveBrief,
  InsightCard,
  InsightGroupCard,
  IntelHero,
  OurProduct,
  PriceComparisonCard,
  findMatches,
  SEVERITY_RANK,
  adRunningDays,
  shortDate,
  type CompetitorAd,
  type MarketInsight,
} from "./components";

interface ShoppingResult {
  id: string;
  capturedAt: string;
  keyword: string;
  title: string;
  titleEn?: string | null;
  store?: string | null;
  price?: number | null;
  currency?: string | null;
  searchPosition?: number | null;
  smoothed7d?: number | null;
}

interface KeywordResearchResult {
  id: string;
  capturedAt: string;
  seedKeyword: string;
  keyword: string;
  avgMonthlySearches?: number | null;
  competition?: string | null;
  competitionIndex?: number | null;
  lowTopOfPageBidMicros?: string | null;
  highTopOfPageBidMicros?: string | null;
}

interface MarketData {
  insights: MarketInsight[];
  shoppingResults: ShoppingResult[];
  competitorAds: CompetitorAd[];
  keywordResearch: KeywordResearchResult[];
  stats: {
    activeCompetitors: number;
    activeKeywords: number;
    openInsights: number;
  };
  lastJobRun?: {
    status: string;
    startedAt: string;
    completedAt?: string | null;
    summary?: unknown;
  } | null;
}

type TriggerResponse = {
  ok?: boolean;
  queued?: boolean;
  runId?: string;
  status?: string;
  jobName?: string;
  alreadyQueued?: boolean;
  error?: string;
};

const MARKET_INTELLIGENCE_CACHE_KEY = "/api/market-intelligence";

// Safely parse a response body. A crashed/bodiless 500 yields an empty string,
// which would otherwise throw "Unexpected end of JSON input" on res.json().
// Returns the parsed payload, throwing a meaningful error for empty/non-JSON bodies.
async function readJson(res: Response, fallbackMessage: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) {
    throw new Error(res.ok ? fallbackMessage : `${fallbackMessage} (HTTP ${res.status})`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${fallbackMessage} (HTTP ${res.status})`);
  }
}

export default function MarketIntelligencePage() {
  const authFetch = useAuthFetch();
  const [data, setData] = useState<MarketData | null>(() => getCache<MarketData>(MARKET_INTELLIGENCE_CACHE_KEY));
  const [loading, setLoading] = useState(() => !getCache(MARKET_INTELLIGENCE_CACHE_KEY));
  const [running, setRunning] = useState(false);
  const [researching, setResearching] = useState(false);
  const [captureRunId, setCaptureRunId] = useState<string | null>(null);
  const [keywordRunId, setKeywordRunId] = useState<string | null>(null);
  const [captureRunStatus, setCaptureRunStatus] = useState<string | null>(null);
  const [keywordRunStatus, setKeywordRunStatus] = useState<string | null>(null);
  const [savingKeyword, setSavingKeyword] = useState(false);
  const [savingCompetitor, setSavingCompetitor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const runningPollRef = useRef(false);
  const keywordPollRef = useRef(false);
  // Stops the poll loop's setState calls and its next 2.5s wait iteration once
  // the page unmounts (e.g. operator navigates away mid-capture) — the loop
  // otherwise keeps firing /api/jobs/status and setting state on an unmounted
  // component for up to its full 10-minute timeout.
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  async function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function pollJobRun(runId: string, kind: "capture" | "keyword") {
    const pollRef = kind === "capture" ? runningPollRef : keywordPollRef;
    if (pollRef.current) return;
    pollRef.current = true;
    const setRunStatus = kind === "capture" ? setCaptureRunStatus : setKeywordRunStatus;
    const clearRunState = kind === "capture"
      ? () => {
          setCaptureRunId(null);
          setCaptureRunStatus(null);
        }
      : () => {
          setKeywordRunId(null);
          setKeywordRunStatus(null);
        };

    try {
      const started = Date.now();
      const timeoutMs = 10 * 60_000;
      while (Date.now() - started < timeoutMs) {
        if (!isMountedRef.current) return;
        const pollRes = await authFetch(`/api/jobs/status?runId=${encodeURIComponent(runId)}`);
        if (!isMountedRef.current) return;
        const payload = await readJson(pollRes, `${kind === "capture" ? "Market Intelligence" : "Keyword research"} status request failed`);
        if (!pollRes.ok) {
          throw new Error((payload.error as string) ?? `${kind} status request failed`);
        }

        const status = typeof payload.status === "string" ? payload.status.toLowerCase() : "";
        setRunStatus(status);
        const jobName = String(payload.jobName ?? "");
        const statusMessage = status === "running" || status === "queued"
          ? `${jobName} is ${status === "queued" ? "queued" : "running"}`
          : `${jobName} ${status}`;
        setNotice(statusMessage);

        if (status !== "queued" && status !== "running") {
          if (status !== "success" && status !== "partial") {
            setError(`Job ${jobName} finished with status ${status}`);
            // Clear the success-toned notice so a failed job doesn't render a
            // green "…failed" banner alongside the red error banner.
            setNotice(null);
          } else {
            setError(null);
          }
          await load(true);
          if (isMountedRef.current) clearRunState();
          break;
        }
        await wait(2500);
      }
      if (isMountedRef.current && pollRef.current && Date.now() - started >= timeoutMs) {
        setError(`${kind === "capture" ? "Market Intelligence" : "Keyword research"} run timed out after 10 minutes.`);
        setNotice(null);
        clearRunState();
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(String(err));
        clearRunState();
      }
    } finally {
      pollRef.current = false;
    }
  }

  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("");
  const [locationName, setLocationName] = useState("Philippines");

  const [competitorName, setCompetitorName] = useState("");
  const [competitorDomain, setCompetitorDomain] = useState("");
  const [pageName, setPageName] = useState("");
  const [pageId, setPageId] = useState("");

  const [selectedTab, setSelectedTab] = useState(0);

  const [filterDays, setFilterDays] = useState("30");
  const [filterKeyword, setFilterKeyword] = useState("");
  const [filterCompetitor, setFilterCompetitor] = useState("");
  const [showAllAds, setShowAllAds] = useState(false);

  const [manageOpen, setManageOpen] = useState(false);

  const [ourProducts, setOurProducts] = useState<OurProduct[]>(() => getCache<OurProduct[]>("/api/market-intelligence/our-products") ?? []);
  const [ourProductsLoading, setOurProductsLoading] = useState(() => !getCache("/api/market-intelligence/our-products"));

  const load = useCallback(async (forceRefresh = false) => {
    setError(null);
    try {
      const res = await authFetch(forceRefresh ? `${MARKET_INTELLIGENCE_CACHE_KEY}?refresh=1` : MARKET_INTELLIGENCE_CACHE_KEY);
      const payload = await readJson(res, "Market Intelligence request failed");
      if (!res.ok) throw new Error((payload.error as string) ?? "Market Intelligence request failed");
      setCache(MARKET_INTELLIGENCE_CACHE_KEY, payload);
      setData(payload as unknown as MarketData);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setOurProductsLoading(true);
    authFetch("/api/market-intelligence/our-products")
      .then(r => r.json())
      .then((d: { products: OurProduct[]; error?: string }) => {
        if (d.error) {
          setError(d.error);
          setOurProducts([]);
        } else {
          setCache("/api/market-intelligence/our-products", d.products ?? []);
          setOurProducts(d.products ?? []);
        }
      })
      .catch((_err) => {
        setError("Could not load your products from Shopify. Check credentials in Settings.");
        setOurProducts([]);
      })
      .finally(() => setOurProductsLoading(false));
  }, [authFetch]);

  const runCapture = useCallback(async () => {
    setRunning(true);
    setNotice(null);
    setError(null);
    try {
      const res = await authFetch("/api/market-intelligence/trigger", { method: "POST" });
      const payload = await readJson(res, "Market Intelligence run failed") as TriggerResponse;
      if (!res.ok) throw new Error((payload.error as string) ?? "Market Intelligence run failed");

      const runId = payload.runId;
      const status = (payload.status ?? "").toLowerCase();
      if (status === "queued" || status === "running") {
        if (runId) {
          setNotice("Market Intelligence capture queued.");
          setCaptureRunId(runId);
          setCaptureRunStatus(status);
          void pollJobRun(runId, "capture");
        } else {
          setNotice("Market Intelligence capture started.");
        }
      } else if (payload.ok) {
        await load(true);
        setNotice("Market Intelligence capture finished.");
      } else {
        throw new Error("Market Intelligence trigger did not return run details.");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }, [authFetch, load, pollJobRun]);

  const runKeywordResearch = useCallback(async () => {
    setResearching(true);
    setNotice(null);
    setError(null);
    try {
      const res = await authFetch("/api/market-intelligence/keyword-research", { method: "POST" });
      const payload = await readJson(res, "Keyword research failed") as TriggerResponse;
      if (!res.ok) throw new Error((payload.error as string) ?? "Keyword research failed");

      const runId = payload.runId;
      const status = (payload.status ?? "").toLowerCase();
      if (status === "queued" || status === "running") {
        if (runId) {
          setNotice("Keyword research queued.");
          setKeywordRunId(runId);
          setKeywordRunStatus(status);
          void pollJobRun(runId, "keyword");
        } else {
          setNotice("Keyword research started.");
        }
      } else if (payload.ok) {
        await load(true);
        setNotice("Keyword research finished.");
      } else {
        throw new Error("Keyword research trigger did not return run details.");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setResearching(false);
    }
  }, [authFetch, load, pollJobRun]);

  const saveKeyword = useCallback(async () => {
    if (!keyword.trim()) return;
    setSavingKeyword(true);
    setNotice(null);
    setError(null);
    try {
      const res = await authFetch("/api/market-intelligence/config", {
        method: "POST",
        body: JSON.stringify({
          keywords: [{ keyword, category: category || null, locationName: locationName || null, languageCode: "en" }],
        }),
      });
      const payload = await readJson(res, "Keyword save failed");
      if (!res.ok) throw new Error((payload.error as string) ?? "Keyword save failed");
      setKeyword("");
      setCategory("");
      setNotice("Keyword saved.");
      await load(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingKeyword(false);
    }
  }, [authFetch, category, keyword, load, locationName]);

  const saveCompetitor = useCallback(async () => {
    if (!competitorName.trim() || !pageName.trim()) return;
    setSavingCompetitor(true);
    setNotice(null);
    setError(null);
    try {
      const res = await authFetch("/api/market-intelligence/config", {
        method: "POST",
        body: JSON.stringify({
          competitors: [{
            name: competitorName,
            domain: competitorDomain || null,
            pages: [{ platform: "facebook", pageName, pageId: pageId || null }],
          }],
        }),
      });
      const payload = await readJson(res, "Competitor save failed");
      if (!res.ok) throw new Error((payload.error as string) ?? "Competitor save failed");
      setCompetitorName("");
      setCompetitorDomain("");
      setPageName("");
      setPageId("");
      setNotice("Competitor saved.");
      await load(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingCompetitor(false);
    }
  }, [authFetch, competitorDomain, competitorName, load, pageId, pageName]);

  const cutoff = useMemo(() => {
    if (filterDays === "all") return null;
    const d = new Date();
    d.setDate(d.getDate() - parseInt(filterDays, 10));
    return d;
  }, [filterDays]);

  // Insights feed: severity-sorted, but with repetitive long-running-ad insights
  // collapsed per competitor into one expandable group so a single competitor's
  // ten near-identical ad alerts don't bury genuinely new price/ad changes.
  // Each item is either a standalone insight or a grouped run.
  const insightItems = useMemo(() => {
    const filtered = (data?.insights ?? []).filter((i) => !cutoff || new Date(i.createdAt) >= cutoff);

    const groups = new Map<string, MarketInsight[]>();
    const singles: MarketInsight[] = [];
    for (const insight of filtered) {
      const competitor = insight.competitor?.name;
      if (insight.type === "long_running_competitor_ad" && competitor) {
        const key = competitor;
        const arr = groups.get(key);
        if (arr) arr.push(insight); else groups.set(key, [insight]);
      } else {
        singles.push(insight);
      }
    }

    type Item =
      | { kind: "single"; id: string; insight: MarketInsight; rank: number; when: number }
      | { kind: "group"; id: string; label: string; typeLabel: string; severity: string; insights: MarketInsight[]; rank: number; when: number };

    const items: Item[] = [];
    for (const insight of singles) {
      items.push({
        kind: "single",
        id: insight.id,
        insight,
        rank: SEVERITY_RANK[insight.severity] ?? 9,
        when: new Date(insight.createdAt).getTime(),
      });
    }
    for (const [competitor, groupInsights] of groups) {
      // A lone long-running-ad insight isn't worth grouping — render it normally.
      if (groupInsights.length === 1) {
        const insight = groupInsights[0]!;
        items.push({
          kind: "single",
          id: insight.id,
          insight,
          rank: SEVERITY_RANK[insight.severity] ?? 9,
          when: new Date(insight.createdAt).getTime(),
        });
        continue;
      }
      const rank = Math.min(...groupInsights.map((i) => SEVERITY_RANK[i.severity] ?? 9));
      const severity = groupInsights.find((i) => (SEVERITY_RANK[i.severity] ?? 9) === rank)?.severity ?? "info";
      const when = Math.max(...groupInsights.map((i) => new Date(i.createdAt).getTime()));
      items.push({
        kind: "group",
        id: `group:${competitor}`,
        label: competitor,
        typeLabel: "long-running ads",
        severity,
        insights: groupInsights.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        rank,
        when,
      });
    }

    return items.sort((a, b) => (a.rank - b.rank) || (b.when - a.when));
  }, [data?.insights, cutoff]);

  // Shared with Price Comparison below and its empty-state check, so both
  // respect the global date-range filter the same way the Shopping tab does —
  // previously Price Comparison read data.shoppingResults directly, so its
  // cards (and the "no data for this date range" empty state) silently
  // ignored the filter while the Shopping tab's own table respected it.
  const dateFilteredShoppingResults = useMemo(() => (data?.shoppingResults ?? [])
    .filter((r) => !cutoff || new Date(r.capturedAt) >= cutoff),
    [data?.shoppingResults, cutoff]);

  const shoppingRows = useMemo(() => dateFilteredShoppingResults
    .filter((r) => {
      if (filterKeyword && !r.keyword.toLowerCase().includes(filterKeyword.toLowerCase())) return false;
      return true;
    })
    .map((result) => {
      const title = result.titleEn ?? result.title;
      return [
      result.keyword,
      title.length > 72 ? `${title.slice(0, 72)}...` : title,
      result.store ?? "-",
      result.price != null ? formatMoney(result.price, result.currency) : "-",
      result.searchPosition != null ? String(result.searchPosition) : "-",
      shortDate(result.capturedAt),
      ];
    }), [dateFilteredShoppingResults, filterKeyword]);

  // Competitor ads as creative cards (filtered like the old table).
  // Ads that have been *running* 60+ days (by ad start date) — proven, durable
  // competitor creative. Distinct from `cutoff`, which filters by capture date.
  const longRunCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 60);
    return d;
  }, []);

  const adCards = useMemo(() => {
    const filtered = (data?.competitorAds ?? []).filter((ad) => {
      if (cutoff && new Date(ad.capturedAt) < cutoff) return false;
      const name = (ad.competitor?.name ?? ad.pageName ?? "").toLowerCase();
      if (filterCompetitor && !name.includes(filterCompetitor.toLowerCase())) return false;
      // By default restrict to proven, long-running creative (start date 60+
      // days ago) — but this hides every ad for a newly-tracked competitor
      // until their creative has run that long, so let the operator opt into
      // seeing everything captured via showAllAds.
      if (!showAllAds && (!ad.startDate || new Date(ad.startDate) > longRunCutoff)) return false;
      return true;
    });

    // Dedup near-identical creatives (Meta runs one creative as many ad entries).
    // Group by competitor + normalized copy; keep the longest-running as the
    // representative and count the rest.
    const groups = new Map<string, { ad: typeof filtered[number]; count: number }>();
    for (const ad of filtered) {
      const who = (ad.competitor?.name ?? ad.pageName ?? "").toLowerCase().trim();
      const text = (ad.adCopyEn ?? ad.adCopy ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
      const key = `${who}::${text}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { ad, count: 1 });
      } else {
        existing.count += 1;
        if ((adRunningDays(ad) ?? 0) > (adRunningDays(existing.ad) ?? 0)) existing.ad = ad;
      }
    }

    // Sort by running duration, longest-first — the most-validated ads on top.
    return [...groups.values()].sort((a, b) => (adRunningDays(b.ad) ?? 0) - (adRunningDays(a.ad) ?? 0));
  }, [data?.competitorAds, cutoff, filterCompetitor, showAllAds]);

  // Which angles endure: distribution of creative angle across the shown ads.
  const angleSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of adCards) {
      const a = g.ad.creativeAngle;
      if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return [...counts.entries()].sort((x, y) => y[1] - x[1]);
  }, [adCards]);

  const keywordResearchRows = useMemo(() => (data?.keywordResearch ?? [])
    .filter((result) => !cutoff || new Date(result.capturedAt) >= cutoff)
    .map((result) => [
    result.keyword,
    result.avgMonthlySearches != null ? result.avgMonthlySearches.toLocaleString("en-PH") : "-",
    result.competition ?? "-",
    result.competitionIndex != null ? String(result.competitionIndex) : "-",
    result.lowTopOfPageBidMicros ? formatPhp(Number(result.lowTopOfPageBidMicros) / 1_000_000) : "-",
    result.highTopOfPageBidMicros ? formatPhp(Number(result.highTopOfPageBidMicros) / 1_000_000) : "-",
    shortDate(result.capturedAt),
  ]), [data?.keywordResearch, cutoff]);

  const priceComparisons = useMemo(() =>
    ourProducts.map(product => ({
      product,
      matches: findMatches(product, dateFilteredShoppingResults),
    })),
    [ourProducts, dateFilteredShoppingResults],
  );

  const lastStatus = data?.lastJobRun?.status;
  const captureInProgress = Boolean(captureRunId);
  const keywordInProgress = Boolean(keywordRunId);
  const captureBannerText = captureRunId
    ? `Market Intelligence capture ${captureRunStatus || "queued"}`
    : null;
  const keywordBannerText = keywordRunId
    ? `Keyword research ${keywordRunStatus || "queued"}`
    : null;

  return (
    <Page
      title="Market Intelligence"
      subtitle="Competitor ad creative, shopping visibility, and pricing movement"
      primaryAction={{ content: "Run capture", onAction: runCapture, loading: running }}
      secondaryActions={[{ content: "Keyword research", onAction: runKeywordResearch, loading: researching }]}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Market Intelligence error" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}
        {notice && (
          <Layout.Section>
            <Banner tone="success" title={notice} onDismiss={() => setNotice(null)} />
          </Layout.Section>
        )}
        {captureInProgress && (
          <Layout.Section>
            <Banner tone="info" title={captureBannerText ?? undefined} />
          </Layout.Section>
        )}
        {keywordInProgress && (
          <Layout.Section>
            <Banner tone="info" title={keywordBannerText ?? undefined} />
          </Layout.Section>
        )}

        {/* Signature: competitive-intelligence hero band */}
        <Layout.Section>
          <IntelHero
            activeCompetitors={data?.stats.activeCompetitors ?? 0}
            activeKeywords={data?.stats.activeKeywords ?? 0}
            openInsights={data?.stats.openInsights ?? 0}
            lastRunAt={data?.lastJobRun?.completedAt ?? data?.lastJobRun?.startedAt}
            lastStatus={lastStatus}
            loading={loading}
          />
        </Layout.Section>

        {/* Global date-range filter — a compact inline control rather than a
            lone dropdown marooned in a full-width card. Text filters live in
            their tabs. */}
        <Layout.Section>
          <InlineStack align="end" blockAlign="center">
            <div style={{ minWidth: 200 }}>
              <Select
                label="Date range"
                labelInline
                options={[
                  { label: "Last 7 days", value: "7" },
                  { label: "Last 30 days", value: "30" },
                  { label: "Last 90 days", value: "90" },
                  { label: "All time", value: "all" },
                ]}
                value={filterDays}
                onChange={setFilterDays}
              />
            </div>
          </InlineStack>
        </Layout.Section>

        {/* Competitive brief */}
        <Layout.Section>
          <BlockStack gap="400">
            <CompetitiveBrief />
          </BlockStack>
        </Layout.Section>

        {/* Tabbed content */}
        <Layout.Section>
          <Tabs
            tabs={[
              { id: "insights", content: "Insights" },
              { id: "ads", content: "Ads" },
              { id: "shopping", content: "Shopping" },
              { id: "keywords", content: "Keywords" },
            ]}
            selected={selectedTab}
            onSelect={setSelectedTab}
          >
            <div style={{ paddingTop: 16 }}>

              {/* Tab 0 — Insights */}
              {selectedTab === 0 && (
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text variant="headingLg" as="h2">What changed</Text>
                    <Text as="p" tone="subdued">Prioritised insights from the latest capture — most urgent first.</Text>
                  </BlockStack>
                  {loading ? (
                    <InlineStack align="center"><Spinner size="small" /></InlineStack>
                  ) : insightItems.length === 0 ? (
                    <Card>
                      <EmptyMessage title="No insights yet" description="Run a capture to analyze competitor moves." />
                    </Card>
                  ) : (
                    <BlockStack gap="300">
                      {insightItems.map((item) => item.kind === "group" ? (
                        <InsightGroupCard
                          key={item.id}
                          label={item.label}
                          typeLabel={item.typeLabel}
                          severity={item.severity}
                          insights={item.insights}
                        />
                      ) : (
                        <InsightCard key={item.id} insight={item.insight} />
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              )}

              {/* Tab 1 — Ads */}
              {selectedTab === 1 && (
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="end">
                    <BlockStack gap="100">
                      <Text variant="headingMd" as="h2">Competitor ad creative</Text>
                      <Text as="p" tone="subdued">
                        {showAllAds
                          ? "All captured competitor ads — longest-running first."
                          : "Proven, long-running ads only (60+ days) — longest-running first."}
                      </Text>
                    </BlockStack>
                    <InlineStack gap="400" blockAlign="end">
                      <Checkbox
                        label="Show all captured ads"
                        checked={showAllAds}
                        onChange={setShowAllAds}
                        helpText="Include newly-tracked competitors"
                      />
                      <div style={{ minWidth: 220 }}>
                        <TextField
                          label="Filter by competitor"
                          value={filterCompetitor}
                          onChange={setFilterCompetitor}
                          placeholder="e.g. Harvest Gold"
                          autoComplete="off"
                          clearButton
                          onClearButtonClick={() => setFilterCompetitor("")}
                        />
                      </div>
                    </InlineStack>
                  </InlineStack>
                  {angleSummary.length > 0 && (
                    <InlineStack gap="150" blockAlign="center" wrap>
                      <Text as="span" variant="bodySm" tone="subdued">Angles:</Text>
                      {angleSummary.map(([angle, n]) => (
                        <Badge key={angle} tone="info">{`${angle.replace(/-/g, " ")} ×${n}`}</Badge>
                      ))}
                    </InlineStack>
                  )}
                  {loading ? (
                    <InlineStack align="center"><Spinner size="small" /></InlineStack>
                  ) : adCards.length === 0 ? (
                    <Card>
                      <EmptyMessage
                        title="No competitor ads found"
                        description={
                          showAllAds
                            ? "No competitor ads captured yet. Add a competitor in Manage tracking below to start capturing."
                            : 'No ads have run 60+ days yet. Check "Show all captured ads" above to see newly-tracked competitors\' ads.'
                        }
                      />
                    </Card>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                      {adCards.map((g) => <AdCreativeCard key={g.ad.id} ad={g.ad} count={g.count} />)}
                    </div>
                  )}
                </BlockStack>
              )}

              {/* Tab 2 — Shopping */}
              {selectedTab === 2 && (
                <BlockStack gap="400">
                  <InlineStack align="end">
                    <div style={{ minWidth: 220 }}>
                      <TextField
                        label="Filter by keyword"
                        value={filterKeyword}
                        onChange={setFilterKeyword}
                        placeholder="e.g. organic rice"
                        autoComplete="off"
                        clearButton
                        onClearButtonClick={() => setFilterKeyword("")}
                      />
                    </div>
                  </InlineStack>
                  <SectionCard title="Shopping visibility & pricing">
                    <Text as="p" tone="subdued">Where products surface on Google Shopping and at what price.</Text>
                    {loading ? (
                      <InlineStack align="center"><Spinner size="small" /></InlineStack>
                    ) : shoppingRows.length === 0 ? (
                      <EmptyMessage title="No shopping results yet" description="Track a keyword below, then run a capture." />
                    ) : (
                      <DataTable
                        columnContentTypes={["text", "text", "text", "text", "numeric", "text"]}
                        headings={["Keyword", "Product", "Store", "Price", "Position", "Captured"]}
                        rows={shoppingRows}
                      />
                    )}
                  </SectionCard>
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text variant="headingMd" as="h2">Price comparison</Text>
                      <Text as="p" tone="subdued">Your products vs. comparable competitor prices from current shopping data.</Text>
                    </BlockStack>
                    {ourProductsLoading || loading ? (
                      <InlineStack align="center"><Spinner size="small" /></InlineStack>
                    ) : ourProducts.length === 0 ? (
                      <Card>
                        <EmptyMessage
                          title="Could not load your products"
                          description="Check your Shopify credentials in Settings."
                        />
                      </Card>
                    ) : dateFilteredShoppingResults.length === 0 ? (
                      <Card>
                        <EmptyMessage
                          title="No competitor pricing data"
                          description="No competitor pricing data for this date range. Try a wider date range or run a market capture."
                        />
                      </Card>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "12px" }}>
                        {priceComparisons.map(({ product, matches }) => (
                          <PriceComparisonCard key={product.id} product={product} matches={matches} />
                        ))}
                      </div>
                    )}
                  </BlockStack>
                </BlockStack>
              )}

              {/* Tab 3 — Keywords */}
              {selectedTab === 3 && (
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">Keyword Planner research</Text>
                    <Text as="p" tone="subdued">Search volume, competition, and bid estimates for tracked SEO keywords.</Text>
                  </BlockStack>
                  {keywordResearchRows.length === 0 ? (
                    <Card>
                      {(data?.keywordResearch ?? []).length > 0 ? (
                        <EmptyMessage
                          title="No keyword research for this date range"
                          description="Keyword data exists but falls outside the selected range — try a wider date range."
                        />
                      ) : (
                        <EmptyMessage title="No keyword research captured yet" description={'Use the "Keyword research" button above to run a capture.'} />
                      )}
                    </Card>
                  ) : (
                    <DataTable
                      columnContentTypes={["text", "numeric", "text", "numeric", "numeric", "numeric", "text"]}
                      headings={["Keyword", "Monthly Searches", "Competition", "Index", "Low Bid", "High Bid", "Captured"]}
                      rows={keywordResearchRows}
                    />
                  )}
                </BlockStack>
              )}

            </div>
          </Tabs>
        </Layout.Section>

        {/* Manage tracking (collapsible setup) */}
        <Layout.Section>
          <SectionCard
            title="Manage tracking"
            action={
              <Button
                variant="plain"
                disclosure={manageOpen ? "up" : "down"}
                onClick={() => setManageOpen((v) => !v)}
                ariaExpanded={manageOpen}
                ariaControls="manage-tracking-panel"
              >
                {manageOpen ? "Hide" : "Add keyword or competitor"}
              </Button>
            }
          >
            <Collapsible id="manage-tracking-panel" open={manageOpen} transition={{ duration: "150ms", timingFunction: "ease-in-out" }}>
                <InlineStack gap="400" wrap align="start">
                  <div style={{ flex: "1 1 280px", minWidth: 280 }}>
                    <BlockStack gap="300">
                      <Text variant="headingSm" as="h3">Track Shopping Keyword</Text>
                      <FormLayout>
                        <TextField label="Keyword" value={keyword} onChange={setKeyword} autoComplete="off" />
                        <TextField label="Category" value={category} onChange={setCategory} autoComplete="off" />
                        <TextField label="Location" value={locationName} onChange={setLocationName} autoComplete="off" />
                        <Button onClick={saveKeyword} loading={savingKeyword} disabled={!keyword.trim()}>Save keyword</Button>
                      </FormLayout>
                    </BlockStack>
                  </div>
                  <div style={{ flex: "1 1 280px", minWidth: 280 }}>
                    <BlockStack gap="300">
                      <Text variant="headingSm" as="h3">Track Meta Competitor</Text>
                      <FormLayout>
                        <TextField label="Competitor name" value={competitorName} onChange={setCompetitorName} autoComplete="off" />
                        <TextField label="Domain" value={competitorDomain} onChange={setCompetitorDomain} autoComplete="off" />
                        <TextField label="Facebook page name" value={pageName} onChange={setPageName} autoComplete="off" />
                        <TextField label="Facebook page ID" value={pageId} onChange={setPageId} autoComplete="off" />
                        <Button onClick={saveCompetitor} loading={savingCompetitor} disabled={!competitorName.trim() || !pageName.trim()}>
                          Save competitor
                        </Button>
                      </FormLayout>
                    </BlockStack>
                  </div>
                </InlineStack>
              </Collapsible>
          </SectionCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
