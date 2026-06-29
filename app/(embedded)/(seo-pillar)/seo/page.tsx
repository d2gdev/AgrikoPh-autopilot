"use client";

import {
  Page,
  Layout,
  Card,
  DataTable,
  Text,
  Button,
  BlockStack,
  EmptyState,
  Banner,
  List,
} from "@shopify/polaris";
import { useState, useEffect } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { getCache, setCache } from "@/lib/client-cache";

interface SeoData {
  topQueries: Array<{
    query: string;
    clicks: number;
    impressions: number;
    ctr: string;
    position: string;
  }>;
  topPages: Array<{
    page: string;
    sessions: number;
    bounceRate: string;
    conversionRate: string;
  }>;
}

type SortDirection = "ascending" | "descending" | "none";

const SEO_SUMMARY_CACHE_KEY = "/api/seo?view=summary";

function sortQueries(
  queries: SeoData["topQueries"],
  colIndex: number,
  direction: SortDirection,
) {
  const dir = direction === "ascending" ? 1 : direction === "none" ? 0 : -1;
  return [...queries].sort((a, b) => {
    switch (colIndex) {
      case 0: return dir * a.query.localeCompare(b.query);
      case 1: return dir * (a.clicks - b.clicks);
      case 2: return dir * (a.impressions - b.impressions);
      case 3: return dir * (parseFloat(a.ctr) - parseFloat(b.ctr));
      case 4: return dir * (parseFloat(a.position) - parseFloat(b.position));
      default: return 0;
    }
  });
}

// ── Brief renderer ────────────────────────────────────────────────────────────

function InlineBold({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
      )}
    </>
  );
}

function BriefRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  const pendingBullets: string[] = [];

  function flushBullets() {
    if (pendingBullets.length === 0) return;
    elements.push(
      <List key={`b-${elements.length}`} type="bullet">
        {pendingBullets.map((b, i) => (
          <List.Item key={i}><InlineBold text={b} /></List.Item>
        ))}
      </List>,
    );
    pendingBullets.length = 0;
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushBullets(); continue; }

    const bullet = line.match(/^[-•*]\s+(.+)/) ?? line.match(/^\d+\.\s+(.+)/);
    if (bullet) { pendingBullets.push(bullet[1]!); continue; }

    flushBullets();
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      elements.push(
        <Text key={elements.length} variant="headingSm" as="h3">{heading[1]}</Text>,
      );
    } else {
      elements.push(
        <Text key={elements.length} as="p"><InlineBold text={line} /></Text>,
      );
    }
  }
  flushBullets();

  return <BlockStack gap="200">{elements}</BlockStack>;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function SeoPage() {
  const authFetch = useAuthFetch();
  const [data, setData] = useState<SeoData | null>(() => getCache<SeoData>(SEO_SUMMARY_CACHE_KEY));
  const [loading, setLoading] = useState(() => !getCache(SEO_SUMMARY_CACHE_KEY));
  const [analyzing, setAnalyzing] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
const [briefError, setBriefError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [querySortCol, setQuerySortCol] = useState(1);
  const [querySortDir, setQuerySortDir] = useState<SortDirection>("descending");

  function loadData() {
    setLoading(true);
    setLoadError(null);
    authFetch(SEO_SUMMARY_CACHE_KEY)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? `Failed to load SEO data (${r.status})`);
        }
        return r.json();
      })
      .then((d) => { setCache(SEO_SUMMARY_CACHE_KEY, d); setData(d); })
      .catch((err) => {
        console.error("[seo]", err);
        setLoadError(err instanceof Error ? err.message : "Failed to load SEO data.");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function generateBrief() {
    setAnalyzing(true);
    setBrief(null);
    setBriefError(null);
    try {
      const res = await authFetch("/api/seo/brief", { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        setBriefError(d.error ?? "Failed to generate brief");
        return;
      }
      setBrief(d.brief);
    } catch (err) {
      console.error("[seo/brief]", err);
      setBriefError("Failed to generate brief. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function refreshData() {
    setRefreshing(true);
    try {
      const res = await authFetch("/api/seo/refresh", { method: "POST" });
      if (res.ok) {
        const r = await authFetch(`${SEO_SUMMARY_CACHE_KEY}&refresh=1`);
        const nextData = await r.json();
        setCache(SEO_SUMMARY_CACHE_KEY, nextData);
        setData(nextData);
      }
    } catch (err) {
      console.error("[seo/refresh]", err);
    } finally {
      setRefreshing(false);
    }
  }

  const sortedQueries = sortQueries(data?.topQueries ?? [], querySortCol, querySortDir);

  const queryRows = sortedQueries.map((q) => [
    q.query, q.clicks, q.impressions, q.ctr, q.position,
  ]);

  const pageRows = (data?.topPages ?? []).map((p) => [
    p.page, p.sessions, p.bounceRate ?? "—", p.conversionRate ?? "—",
  ]);

  const hasRows = !!data && ((data.topQueries?.length ?? 0) > 0 || (data.topPages?.length ?? 0) > 0);

  return (
    <Page
      title="SEO"
      primaryAction={
        <Button onClick={generateBrief} loading={analyzing}>
          Generate SEO Brief with Claude
        </Button>
      }
    >
      <Layout>
        {loadError && (
          <Layout.Section>
            <Banner
              tone="critical"
              title="Couldn’t load SEO data"
              action={{ content: "Retry", onAction: loadData }}
              onDismiss={() => setLoadError(null)}
            >
              <p>{loadError}</p>
            </Banner>
          </Layout.Section>
        )}
        {briefError && (
          <Layout.Section>
            <Banner tone="critical" title="Brief generation failed" onDismiss={() => setBriefError(null)}>
              <p>{briefError}</p>
            </Banner>
          </Layout.Section>
        )}
        {brief && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">AI SEO Brief</Text>
                <BriefRenderer text={brief} />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
        <Layout.Section>
          {loading ? (
            <Card><Text as="p">Loading SEO data...</Text></Card>
          ) : loadError ? (
            <Card><Text as="p" tone="subdued">SEO data unavailable. Use Retry above.</Text></Card>
          ) : !hasRows ? (
            <EmptyState
              heading="No SEO data"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{ content: "Fetch SEO data now", onAction: refreshData, loading: refreshing }}
            >
              <Text as="p">Pull the latest GSC and GA4 data, or wait for the scheduled fetch.</Text>
            </EmptyState>
          ) : (
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Top Queries (GSC — 28d)</Text>
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric", "text", "text"]}
                    headings={["Query", "Clicks", "Impressions", "CTR", "Position"]}
                    rows={queryRows}
                    sortable={[true, true, true, true, true]}
                    defaultSortDirection={querySortDir === "none" ? "descending" : querySortDir}
                    initialSortColumnIndex={querySortCol}
                    onSort={(colIndex, direction) => {
                      setQuerySortCol(colIndex);
                      setQuerySortDir(direction);
                    }}
                  />
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Top Pages (GA4 — 28d)</Text>
                  <DataTable
                    columnContentTypes={["text", "numeric", "text", "text"]}
                    headings={["Page", "Sessions", "Bounce Rate", "Conv. Rate"]}
                    rows={pageRows}
                  />
                </BlockStack>
              </Card>
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
