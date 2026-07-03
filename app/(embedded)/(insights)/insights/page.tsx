"use client";

import {
  Page, Layout, Card, Text, Badge, InlineStack, BlockStack, Button, Divider, Banner,
} from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthFetch, withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { getCache, setCache } from "@/lib/client-cache";

interface PilotCard {
  name: string;
  path: string;
  status: "active" | "planned";
  metrics: { label: string; value: string }[];
  loading: boolean;
}

interface JobStatus {
  pendingCount: number;
  executedThisMonth: number;
  lastJobRun: { status: string; startedAt: string } | null;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return "< 1h ago";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function InsightsPilotPage() {
  const authFetch = useAuthFetch();
  const router = useRouter();

  const [jobStatus, setJobStatus] = useState<JobStatus | null>(() => getCache<JobStatus>("/api/jobs/status"));

  const [adMetrics, setAdMetrics] = useState<{ label: string; value: string }[]>(() => getCache<{ label: string; value: string }[]>("/api/campaigns:insights-metrics") ?? []);
  const [adLoading, setAdLoading] = useState(() => !getCache("/api/campaigns:insights-metrics"));

  const [seoMetrics, setSeoMetrics] = useState<{ label: string; value: string }[]>(() => getCache<{ label: string; value: string }[]>("/api/seo:insights-metrics") ?? []);
  const [seoLoading, setSeoLoading] = useState(() => !getCache("/api/seo:insights-metrics"));

  const [storeMetrics, setStoreMetrics] = useState<{ label: string; value: string }[]>(() => getCache<{ label: string; value: string }[]>("/api/images:insights-metrics") ?? []);
  const [storeLoading, setStoreLoading] = useState(() => !getCache("/api/images:insights-metrics"));

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = useCallback(() => {
    setLoadError(null);
    const fail = () => setLoadError("Some data failed to load. Metrics showing “—” may be stale or missing.");

    authFetch("/api/jobs/status")
      .then((r) => { if (!r.ok) throw new Error(`jobs/status ${r.status}`); return r.json(); })
      .then((d) => { setCache("/api/jobs/status", d); setJobStatus(d); })
      .catch(fail);

    setAdLoading(true);
    authFetch("/api/campaigns")
      .then((r) => { if (!r.ok) throw new Error(`campaigns ${r.status}`); return r.json(); })
      .then((d) => {
        const cams = d.campaigns ?? [];
        const active = cams.filter((c: { status: string }) => c.status === "ACTIVE").length;
        const metrics = [
          { label: "Total Campaigns", value: String(cams.length) },
          { label: "Active", value: String(active) },
        ];
        setCache("/api/campaigns:insights-metrics", metrics);
        setAdMetrics(metrics);
      })
      .catch(fail)
      .finally(() => setAdLoading(false));

    setSeoLoading(true);
    authFetch("/api/seo")
      .then((r) => { if (!r.ok) throw new Error(`seo ${r.status}`); return r.json(); })
      .then((d) => {
        const clicks = (d.topQueries ?? []).reduce((s: number, q: { clicks: number }) => s + (q.clicks ?? 0), 0);
        const pages = (d.topPages ?? []).length;
        const metrics = [
          { label: "Total Clicks", value: clicks.toLocaleString() },
          { label: "Top Pages", value: String(pages) },
        ];
        setCache("/api/seo:insights-metrics", metrics);
        setSeoMetrics(metrics);
      })
      .catch(fail)
      .finally(() => setSeoLoading(false));

    setStoreLoading(true);
    authFetch("/api/images")
      .then((r) => { if (!r.ok) throw new Error(`images ${r.status}`); return r.json(); })
      .then((d) => {
        const pct = d.total > 0 ? Math.round(((d.total - d.missingAltText) / d.total) * 100) : 0;
        const metrics = [
          { label: "Total Images", value: String(d.total ?? 0) },
          { label: "Alt Text Coverage", value: `${pct}%` },
        ];
        setCache("/api/images:insights-metrics", metrics);
        setStoreMetrics(metrics);
      })
      .catch(fail)
      .finally(() => setStoreLoading(false));
  }, [authFetch]);

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pilots: PilotCard[] = [
    {
      name: "Ad Pilot",
      path: "/ad-pilot",
      status: "active",
      metrics: adMetrics,
      loading: adLoading,
    },
    {
      name: "SEO Pilot",
      path: "/seo-pillar",
      status: "active",
      metrics: seoMetrics,
      loading: seoLoading,
    },
    {
      name: "Store Pilot",
      path: "/store-pilot",
      status: "active",
      metrics: storeMetrics,
      loading: storeLoading,
    },
    {
      name: "Content Pilot",
      path: "/content-pilot",
      status: "active",
      metrics: [],
      loading: false,
    },
    {
      name: "Social Pilot",
      path: "/social-pilot",
      status: "active",
      metrics: [],
      loading: false,
    },
  ];

  return (
    <Page
      title="Insights Pilot"
      subtitle="Unified view across all pilots"
    >
      <Layout>
        {loadError && (
          <Layout.Section>
            <Banner
              tone="critical"
              title="Failed to load some metrics"
              action={{ content: "Retry", onAction: loadAll }}
              onDismiss={() => setLoadError(null)}
            >
              <Text as="p">{loadError}</Text>
            </Banner>
          </Layout.Section>
        )}

        {/* System health bar */}
        <Layout.Section>
          <Card>
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text variant="headingMd" as="h2">System Status</Text>
                {jobStatus?.lastJobRun ? (
                  <InlineStack gap="200">
                    <Badge tone={jobStatus.lastJobRun.status === "success" || jobStatus.lastJobRun.status === "partial" ? "success" : "critical"}>
                      {jobStatus.lastJobRun.status}
                    </Badge>
                    <Text as="p" tone="subdued">Last run {timeAgo(jobStatus.lastJobRun.startedAt)}</Text>
                  </InlineStack>
                ) : (
                  <Text as="p" tone="subdued">Never run</Text>
                )}
              </BlockStack>
              <InlineStack gap="600">
                <BlockStack gap="050">
                  <Text as="p" tone="subdued" variant="bodySm">Pending Recs</Text>
                  <Text variant="headingLg" as="p">{jobStatus?.pendingCount ?? "—"}</Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="p" tone="subdued" variant="bodySm">Executed (Month)</Text>
                  <Text variant="headingLg" as="p">{jobStatus?.executedThisMonth ?? "—"}</Text>
                </BlockStack>
              </InlineStack>
            </InlineStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Divider />
        </Layout.Section>

        {/* Pilot cards grid */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">Pilots</Text>
            <InlineStack gap="400" wrap>
              {pilots.map((pilot) => (
                <div key={pilot.name} style={{ minWidth: 260, flex: "1 1 260px" }}>
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="start">
                        <Text variant="headingMd" as="h3">{pilot.name}</Text>
                        <Badge tone={pilot.status === "active" ? "success" : "info"}>
                          {pilot.status === "active" ? "Live" : "Planned"}
                        </Badge>
                      </InlineStack>

                      {pilot.loading ? (
                        <Text as="p" tone="subdued">Loading…</Text>
                      ) : pilot.metrics.length > 0 ? (
                        <InlineStack gap="400">
                          {pilot.metrics.map((m) => (
                            <BlockStack key={m.label} gap="050">
                              <Text as="p" tone="subdued" variant="bodySm">{m.label}</Text>
                              <Text variant="headingMd" as="p">{m.value}</Text>
                            </BlockStack>
                          ))}
                        </InlineStack>
                      ) : pilot.status === "planned" ? (
                        <Text as="p" tone="subdued">Coming soon</Text>
                      ) : null}

                      {pilot.status === "active" && (
                        <Button size="slim" onClick={() => router.push(withShopifyContextUrl(pilot.path))}>
                          View Report
                        </Button>
                      )}
                    </BlockStack>
                  </Card>
                </div>
              ))}
            </InlineStack>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
