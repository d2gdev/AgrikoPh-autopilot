"use client";

import { getCache, setCache } from "@/lib/client-cache";

// Safely parse a Response as JSON. If the body is not JSON (e.g. an HTML error
// page from a proxy or Next.js itself), returns { error: <raw text> } rather
// than throwing SyntaxError: Unexpected token '<'.
async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { return { error: `Server returned non-JSON (HTTP ${res.status}): ${text.slice(0, 120)}` }; }
}

import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  DataTable,
  Spinner,
  Banner,
  Tabs,
  Button,
  Box,
  TextField,
  Select,
  Checkbox,
  Divider,
  Modal,
} from "@shopify/polaris";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthFetch, withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { sanitizeHtml } from "@/lib/content-pilot/sanitize-html";
import { loadAllArticlePages, type ArticlePage } from "@/lib/content-pilot/article-pagination";
import { contentIndexFeedback, overviewLoadWarning } from "@/lib/content-pilot/operator-feedback";

// ── Types ──────────────────────────────────────────────────────────────────

import type { ArticleRow, TopicCluster, LinkGraphData, ContentProposal } from "./components/types";

// ── Helpers ────────────────────────────────────────────────────────────────

import {
  countWordsFromHtml,
  fmt,
  ScoreBadge,
  PriorityBadge,
  ImpactBadge,
  SeoDeltaBadge,
  draftFailureMessage,
  ProposedChangeSummary,
} from "./components/helpers";

// ── Overview Tab ───────────────────────────────────────────────────────────

import { OverviewTab } from "./components/OverviewTab";

// ── Queue Tab (unified proposals + drafts) ─────────────────────────────────

import { QueueTab } from "./components/QueueTab";


// ── Brief Tab ──────────────────────────────────────────────────────────────

import { BriefTab } from "./components/BriefTab";

// ── Main Page ──────────────────────────────────────────────────────────────

export default function ContentPilotPage() {
  const authFetch = useAuthFetch();
  const [selectedTab, setSelectedTab] = useState(0);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t) {
      const n = parseInt(t, 10);
      if (Number.isFinite(n) && n >= 0 && n <= 2) setSelectedTab(n);
    }
  }, []);
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [clusters, setClusters] = useState<TopicCluster[]>([]);
  const [linkGraph, setLinkGraph] = useState<LinkGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [articlesError, setArticlesError] = useState(false); // Fix #3
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<{ tone: "success" | "warning"; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const loadOverview = useCallback((): Promise<void> => {
    setLoading(true);
    setArticlesError(false);
    setWarning(null);

    const fetchJson = async (input: string, timeoutMs = 30000): Promise<unknown> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await authFetch(input, { signal: controller.signal });
        clearTimeout(timeoutId);
        const data = await safeJson(res);
        if (!res.ok) {
          console.error(`[content-pilot] ${input} returned ${res.status}:`, data);
          return null;
        }
        return data;
      } catch (err) {
        clearTimeout(timeoutId);
        const reason = controller.signal.aborted ? "timed out" : String(err);
        console.error(`[content-pilot] ${input} failed: ${reason}`);
        return null;
      }
    };

    const articlePages = loadAllArticlePages<ArticleRow>(async (page) => {
      const value = await fetchJson(`/api/content-pilot/articles?page=${page}`);
      if (!value || !Array.isArray((value as { articles?: unknown }).articles)) {
        throw new Error(`Article page ${page} failed to load`);
      }
      return value as ArticlePage<ArticleRow>;
    });

    return Promise.all([
      articlePages,
      fetchJson("/api/content-pilot/topic-clusters"),
      fetchJson("/api/content-pilot/link-graph"),
    ])
      .then(([a, c, g]) => {
        setArticles(a.articles);
        setTotal(a.total);
        if (c) setClusters((c as { clusters: TopicCluster[] }).clusters ?? []);
        if (g) setLinkGraph(g as LinkGraphData);
        setWarning(overviewLoadWarning({ clustersLoaded: Boolean(c), linkGraphLoaded: Boolean(g) }));
        setLoading(false);
      })
      .catch((err) => {
        setArticlesError(true);
        setError(`Overview load failed: ${err instanceof Error ? err.message : String(err)}`);
        setLoading(false);
      });
  }, [authFetch]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const runIndexer = useCallback(async () => {
    setIndexing(true);
    setError(null);
    setIndexResult(null);
    try {
      const res = await authFetch("/api/content-pilot/index", { method: "POST" });
      const d = await safeJson(res);
      if (!res.ok) {
        setError((d.error as string) ?? "Indexer failed");
      } else {
        setIndexResult(contentIndexFeedback(d));
        setSelectedTab(0);
        await loadOverview();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setIndexing(false);
    }
  }, [authFetch, loadOverview]);

  const goodSeo = articles.filter((a) => a.seoScore >= 80).length;
  const criticalSeo = articles.filter((a) => a.seoScore < 50).length;

  const tabs = [
    { id: "overview", content: "Overview" },
    { id: "queue", content: "Queue" },
    { id: "brief", content: "Brief" },
  ];

  return (
    <Page
      title="Content Pilot"
      subtitle="Blog article SEO intelligence"
      primaryAction={{ content: "Run Indexer", onAction: runIndexer, loading: indexing }}
    >
      <Layout>
        {indexResult && (
          <Layout.Section>
            <Banner tone={indexResult.tone} onDismiss={() => setIndexResult(null)}>
              {indexResult.message}
            </Banner>
          </Layout.Section>
        )}
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          </Layout.Section>
        )}
        {warning && (
          <Layout.Section>
            <Banner tone="warning" onDismiss={() => setWarning(null)}>
              {warning}
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineStack gap="400" wrap>
            <div style={{ flex: "1 1 180px", minWidth: 180 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">
                  Total Indexed
                </Text>
                <Text variant="heading2xl" as="p">
                  {loading ? "—" : total}
                </Text>
              </BlockStack>
            </Card>
            </div>
            <div style={{ flex: "1 1 180px", minWidth: 180 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">
                  SEO Score ≥80
                </Text>
                <Text variant="heading2xl" as="p">
                  {loading ? "—" : goodSeo}
                </Text>
              </BlockStack>
            </Card>
            </div>
            <div style={{ flex: "1 1 180px", minWidth: 180 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">
                  Critical (&lt;50)
                </Text>
                <Text variant="heading2xl" as="p">
                  {loading ? "—" : criticalSeo}
                </Text>
              </BlockStack>
            </Card>
            </div>
            <div style={{ flex: "1 1 180px", minWidth: 180 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">
                  Orphan Articles
                </Text>
                <Text variant="heading2xl" as="p">
                  {loading ? "—" : (linkGraph?.orphanCount ?? "—")}
                </Text>
              </BlockStack>
            </Card>
            </div>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <Box padding="400">
                <div style={{ display: selectedTab === 0 ? undefined : "none" }}>
                  <OverviewTab
                    articles={articles}
                    clusters={clusters}
                    linkGraph={linkGraph}
                    loading={loading}
                    articlesError={articlesError}
                  />
                </div>
                <div style={{ display: selectedTab === 1 ? undefined : "none" }}>
                  <QueueTab authFetch={authFetch} active={selectedTab === 1} />
                </div>
                <div style={{ display: selectedTab === 2 ? undefined : "none" }}>
                  <BriefTab authFetch={authFetch} clusters={clusters} />
                </div>
              </Box>
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
