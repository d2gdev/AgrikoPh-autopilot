"use client";

import {
  Page, Layout, Card, Text, Badge, InlineStack, BlockStack, DataTable, Button, Banner,
} from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthFetch, withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { getCache, setCache } from "@/lib/client-cache";
import { campaignStatusTone } from "@/lib/ui/tones";
import { StatGridSkeleton, ListSkeleton } from "@/components/ui/states";

interface Campaign {
  id: string;
  name: string;
  status: string;
  budget: string;
  spend7d: string;
  impressions: number;
  clicks: number;
  ctr: string;
  conversions: number;
  cpa: string;
  roas: string;
  pendingRecs: number;
}

interface JobStatus {
  pendingCount: number;
  executedThisMonth: number;
  lastJobRun: { status: string; startedAt: string } | null;
}

export default function AdPilotReportPage() {
  const authFetch = useAuthFetch();
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>(() => getCache<Campaign[]>("/api/campaigns") ?? []);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(() => getCache<JobStatus>("/api/jobs/status"));
  const [loading, setLoading] = useState(() => !getCache("/api/campaigns") || !getCache("/api/jobs/status"));
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      authFetch("/api/campaigns").then((r) => { if (!r.ok) throw new Error(`Campaigns failed (${r.status})`); return r.json(); }),
      authFetch("/api/jobs/status").then((r) => { if (!r.ok) throw new Error(`Job status failed (${r.status})`); return r.json(); }),
    ]).then(([camData, jData]) => {
      setCache("/api/campaigns", camData.campaigns ?? []);
      setCache("/api/jobs/status", jData);
      setCampaigns(camData.campaigns ?? []);
      setJobStatus(jData);
    }).catch((err: Error) => {
      setLoadError(err.message || "Failed to load Ad Pilot data");
    }).finally(() => setLoading(false));
  }, [authFetch]); // authFetch from useCallback in hook — stable reference

  useEffect(() => { load(); }, [load]);

  const active = campaigns.filter((c) => c.status === "ACTIVE").length;
  const totalPendingRecs = campaigns.reduce((s, c) => s + c.pendingRecs, 0);

  const rows = campaigns.map((c) => [
    c.name,
    <Badge tone={campaignStatusTone(c.status)}>{c.status}</Badge>,
    c.budget,
    c.spend7d,
    c.roas,
    c.ctr,
    String(c.conversions),
    c.cpa,
    c.pendingRecs > 0 ? (
      <Badge tone="attention">{String(c.pendingRecs)}</Badge>
    ) : (
      <Text as="span" tone="subdued">—</Text>
    ),
  ]);

  return (
    <Page
      title="Ad Pilot"
      subtitle="Meta Ads performance overview"
      secondaryActions={[
        { content: "Campaigns", onAction: () => router.push(withShopifyContextUrl("/campaigns")) },
        { content: "Recommendations", onAction: () => router.push(withShopifyContextUrl("/recommendations")) },
      ]}
    >
      <Layout>
        {loadError && (
          <Layout.Section>
            <Banner
              tone="critical"
              title="Failed to load Ad Pilot data"
              action={{ content: "Retry", onAction: load }}
              onDismiss={() => setLoadError(null)}
            >
              <Text as="p">{loadError}</Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          {loading ? (
            <StatGridSkeleton count={4} />
          ) : (
            <InlineStack gap="400" wrap={false}>
              <Card>
                <BlockStack gap="100">
                  <Text variant="headingSm" as="h3" tone="subdued">Active Campaigns</Text>
                  <Text variant="heading2xl" as="p">{active}</Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text variant="headingSm" as="h3" tone="subdued">Total Campaigns</Text>
                  <Text variant="heading2xl" as="p">{campaigns.length}</Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text variant="headingSm" as="h3" tone="subdued">Pending Recs</Text>
                  <Text variant="heading2xl" as="p">{jobStatus?.pendingCount ?? "—"}</Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text variant="headingSm" as="h3" tone="subdued">Executed (Month)</Text>
                  <Text variant="heading2xl" as="p">{jobStatus?.executedThisMonth ?? "—"}</Text>
                </BlockStack>
              </Card>
            </InlineStack>
          )}
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Campaign Performance</Text>
              {loading ? (
                <ListSkeleton lines={5} />
              ) : rows.length === 0 ? (
                <Text as="p" tone="subdued">No data yet — run the analyzer from the Dashboard.</Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text", "numeric", "text", "text"]}
                  headings={["Campaign", "Status", "Budget", "Spend (7d)", "ROAS", "CTR", "Conv.", "CPA", "Pending Recs"]}
                  rows={rows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
