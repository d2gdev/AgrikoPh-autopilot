"use client";

import {
  Page, Layout, Card, Text, Badge, InlineStack, BlockStack, DataTable, Spinner, Thumbnail, CalloutCard, Banner,
} from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { getCache, setCache } from "@/lib/client-cache";

interface Post {
  id: string;
  message: string;
  createdTime: string;
  permalinkUrl: string;
  likes: number;
  comments: number;
  shares: number;
  fullPicture: string | null;
}

interface PageInfo { id: string; name: string; }

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function engagementTone(total: number): "success" | "warning" | undefined {
  if (total >= 50) return "success";
  if (total >= 10) return "warning";
  return undefined;
}

export default function SocialPilotPage() {
  const authFetch = useAuthFetch();
  const [posts, setPosts] = useState<Post[]>(() => getCache<Post[]>("/api/social-pilot:posts") ?? []);
  const [activePage, setActivePage] = useState<PageInfo | null>(() => getCache<PageInfo>("/api/social-pilot:activePage"));
  const [loading, setLoading] = useState(() => !getCache("/api/social-pilot:posts"));
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [analysis, setAnalysis] = useState<{
    summary?: string;
    bestContentType?: string;
    bestTime?: string;
    recommendations?: string[];
  } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    authFetch("/api/social-pilot")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          if (d.code === "META_NOT_CONFIGURED" || d.error.includes("META_ACCESS_TOKEN")) {
            setNotConfigured(true);
          } else {
            setError(d.error);
          }
        }
        setCache("/api/social-pilot:posts", d.posts ?? []);
        setCache("/api/social-pilot:activePage", d.activePage ?? null);
        setPosts(d.posts ?? []);
        setActivePage(d.activePage ?? null);
        setLoading(false);
      })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await authFetch("/api/social-pilot/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts }),
      });
      const d = await res.json();
      if (!res.ok) {
        setAnalysisError(d.error ?? "AI analysis failed. Please try again.");
        return;
      }
      setAnalysis(d.analysis);
    } catch (err) {
      console.error("[social-pilot] analysis error", err);
      setAnalysisError("AI analysis failed. Please try again.");
    } finally { setAnalyzing(false); }
  }, [authFetch, posts]);

  const totalLikes = posts.reduce((s, p) => s + p.likes, 0);
  const totalComments = posts.reduce((s, p) => s + p.comments, 0);
  const totalShares = posts.reduce((s, p) => s + p.shares, 0);
  const avgEngagement = posts.length > 0
    ? Math.round((totalLikes + totalComments + totalShares) / posts.length)
    : 0;

  const rows = posts.slice(0, 30).map((p) => {
    const total = p.likes + p.comments + p.shares;
    return [
      p.fullPicture ? (
        <Thumbnail source={p.fullPicture} size="small" alt="" />
      ) : (
        <Text as="span" tone="subdued">—</Text>
      ),
      p.message ? p.message.slice(0, 80) + (p.message.length > 80 ? "…" : "") : "(no caption)",
      timeAgo(p.createdTime),
      String(p.likes),
      String(p.comments),
      String(p.shares),
      <Badge tone={engagementTone(total)}>{String(total)}</Badge>,
    ];
  });

  if (!loading && notConfigured) {
    return (
      <Page title="Social Pilot" subtitle="Organic social performance">
        <Layout>
          <Layout.Section>
            <CalloutCard
              title="Connect Meta (Facebook)"
              illustration="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              primaryAction={{ content: "Meta App Settings", url: "https://developers.facebook.com/apps", external: true }}
            >
              <Text as="p">
                Add your Meta User Access Token as <strong>META_ACCESS_TOKEN</strong> in the server environment.
                The token needs <strong>pages_show_list</strong> and <strong>pages_read_engagement</strong> permissions.
                Optionally set <strong>META_PAGE_ID</strong> to pin a specific Facebook Page.
              </Text>
            </CalloutCard>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Social Pilot"
      subtitle={activePage ? `Facebook: ${activePage.name}` : "Organic social performance"}
      secondaryActions={[{ content: "AI Analysis", onAction: runAnalysis, loading: analyzing, disabled: posts.length === 0 }]}
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info" title="Advisory — read-only">
            <p>This section shows observed organic social data. No automated actions are taken here.</p>
          </Banner>
        </Layout.Section>
        {error && (
          <Layout.Section>
            <Card>
              <Text as="p" tone="critical">{error}</Text>
              {error.includes("META_PAGE_ID") || error.includes("META_ACCESS_TOKEN") || error.includes("not configured") ? (
                <Text as="p" tone="subdued">Set META_PAGE_ID in the server environment to specify your Facebook Page.</Text>
              ) : null}
            </Card>
          </Layout.Section>
        )}

        {!error && (
          <>
            <Layout.Section>
              <InlineStack gap="400" wrap={false}>
                <Card>
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h3" tone="subdued">Posts Fetched</Text>
                    <Text variant="heading2xl" as="p">{loading ? "—" : posts.length}</Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h3" tone="subdued">Total Likes</Text>
                    <Text variant="heading2xl" as="p">{loading ? "—" : totalLikes.toLocaleString()}</Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h3" tone="subdued">Total Comments</Text>
                    <Text variant="heading2xl" as="p">{loading ? "—" : totalComments.toLocaleString()}</Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h3" tone="subdued">Avg Engagement</Text>
                    <Text variant="heading2xl" as="p">{loading ? "—" : avgEngagement}</Text>
                  </BlockStack>
                </Card>
              </InlineStack>
            </Layout.Section>

            {analysisError && (
          <Layout.Section>
            <Banner tone="critical" title="Analysis failed" onDismiss={() => setAnalysisError(null)}>
              <p>{analysisError}</p>
            </Banner>
          </Layout.Section>
        )}
        {analysis && (
              <Layout.Section>
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h2">AI Insights</Text>
                    {analysis.summary && <Text as="p">{analysis.summary}</Text>}
                    {analysis.bestContentType && (
                      <Text as="p"><strong>Best content type:</strong> {analysis.bestContentType}</Text>
                    )}
                    {analysis.bestTime && (
                      <Text as="p"><strong>Best posting time:</strong> {analysis.bestTime}</Text>
                    )}
                    {(analysis.recommendations ?? []).map((r, i) => (
                      <Text key={i} as="p">• {r}</Text>
                    ))}
                  </BlockStack>
                </Card>
              </Layout.Section>
            )}

            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Recent Posts (by engagement)</Text>
                  {loading ? (
                    <InlineStack align="center"><Spinner size="small" /></InlineStack>
                  ) : rows.length === 0 ? (
                    <Text as="p" tone="subdued">No posts found. Ensure META_PAGE_ID is set in the server environment.</Text>
                  ) : (
                    <DataTable
                      columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric", "text"]}
                      headings={["", "Caption", "Posted", "Likes", "Comments", "Shares", "Total"]}
                      rows={rows}
                    />
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          </>
        )}
      </Layout>
    </Page>
  );
}
