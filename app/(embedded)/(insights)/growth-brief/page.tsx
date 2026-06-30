"use client";

import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Spinner,
  Text,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthFetch, withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { getCache, setCache } from "@/lib/client-cache";

type BriefTone = "success" | "warning" | "critical" | "info";

interface BriefItem {
  id: string;
  title: string;
  description: string;
  source: string;
  priority: string;
  tone: BriefTone;
  href: string;
  meta: string[];
}

interface GrowthBriefPayload {
  generatedAt: string;
  summary: {
    status: "ok" | "needs_attention";
    needsAttentionCount: number;
    readyToApproveCount: number;
    quickWinCount: number;
    pendingStoreTasks: number;
    pendingContentProposals: number;
    pendingRecommendations: number;
    openMarketInsights: number;
    openOpportunities: number;
    imageMissingAltText: number;
  };
  dataQuality: {
    seoSnapshotFetchedAt: string | null;
    gscCapturedAt: string | null;
    ga4CapturedAt: string | null;
    imageSummary: {
      available: boolean;
      total: number;
      missingAltText: number;
      note: string;
    };
    caveats: string[];
  };
  sections: {
    needsAttention: BriefItem[];
    readyToApprove: BriefItem[];
    quickWins: BriefItem[];
  };
  nextAction: BriefItem | null;
}

const CACHE_KEY = "/api/growth-brief";

function toneForBadge(tone: BriefTone): "success" | "warning" | "critical" | "info" {
  return tone;
}

function timeAgo(iso: string | null) {
  if (!iso) return "unknown";
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "unknown";
  const diff = Date.now() - time;
  const mins = Math.floor(Math.abs(diff) / 60000);
  const suffix = diff < 0 ? " from now" : " ago";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m${suffix}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h${suffix}`;
  return `${Math.floor(hrs / 24)}d${suffix}`;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: BriefTone }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <InlineStack gap="200" blockAlign="center">
          <Text as="p" variant="heading2xl">
            {value}
          </Text>
          {tone ? <Badge tone={toneForBadge(tone)}>{tone.replace("_", " ")}</Badge> : null}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function ItemCard({ item }: { item: BriefItem }) {
  const router = useRouter();
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="start" gap="300">
          <InlineStack gap="200" wrap>
            <Badge tone={toneForBadge(item.tone)}>{item.priority}</Badge>
            <Badge>{item.source}</Badge>
          </InlineStack>
          <Button size="slim" onClick={() => router.push(withShopifyContextUrl(item.href))}>
            Open
          </Button>
        </InlineStack>
        <BlockStack gap="100">
          <Text as="h3" variant="headingSm">
            {item.title}
          </Text>
          <Text as="p" tone="subdued">
            {item.description}
          </Text>
        </BlockStack>
        {item.meta.length > 0 ? (
          <InlineStack gap="150" wrap>
            {item.meta.map((m) => (
              <Badge key={m} tone="info">
                {m}
              </Badge>
            ))}
          </InlineStack>
        ) : null}
      </BlockStack>
    </Card>
  );
}

function BriefSection({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: BriefItem[];
}) {
  return (
    <BlockStack gap="300">
      <Text as="h2" variant="headingMd">
        {title}
      </Text>
      {items.length === 0 ? (
        <Card>
          <Text as="p" tone="subdued">
            {empty}
          </Text>
        </Card>
      ) : (
        <BlockStack gap="300">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </BlockStack>
      )}
    </BlockStack>
  );
}

export default function GrowthBriefPage() {
  const authFetch = useAuthFetch();
  const router = useRouter();
  const [data, setData] = useState<GrowthBriefPayload | null>(() => getCache<GrowthBriefPayload>(CACHE_KEY));
  const [loading, setLoading] = useState(() => !getCache(CACHE_KEY));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(force = false) {
    force ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await authFetch(CACHE_KEY);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Growth Brief failed to load.");
      setCache(CACHE_KEY, payload);
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Growth Brief failed to load.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statusTone = data?.summary.status === "needs_attention" ? "warning" : "success";

  return (
    <Page
      title="Growth Brief"
      subtitle="Prioritized operator view across SEO, content, competitors, images, and ads"
      primaryAction={{
        content: "Refresh",
        onAction: () => load(true),
        loading: refreshing,
      }}
      secondaryActions={[
        { content: "Open Odysseus", onAction: () => router.push(withShopifyContextUrl("/odysseus")) },
      ]}
    >
      <Layout>
        {error ? (
          <Layout.Section>
            <Banner tone="critical" title="Couldn’t load Growth Brief" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          {loading && !data ? (
            <Card>
              <InlineStack align="center" gap="200">
                <Spinner size="small" />
                <Text as="p" tone="subdued">Loading Growth Brief…</Text>
              </InlineStack>
            </Card>
          ) : data ? (
            <BlockStack gap="500">
              <Card>
                <InlineStack align="space-between" blockAlign="start" gap="400">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingMd">Next Action</Text>
                      <Badge tone={statusTone}>{data.summary.status === "needs_attention" ? "Needs attention" : "OK"}</Badge>
                    </InlineStack>
                    {data.nextAction ? (
                      <BlockStack gap="100">
                        <Text as="p" fontWeight="semibold">{data.nextAction.title}</Text>
                        <Text as="p" tone="subdued">{data.nextAction.description}</Text>
                      </BlockStack>
                    ) : (
                      <Text as="p" tone="subdued">No immediate action required.</Text>
                    )}
                    <Text as="p" variant="bodySm" tone="subdued">
                      Generated {timeAgo(data.generatedAt)}
                    </Text>
                  </BlockStack>
                  {data.nextAction ? (
                    <Button onClick={() => router.push(withShopifyContextUrl(data.nextAction!.href))}>
                      Open action
                    </Button>
                  ) : null}
                </InlineStack>
              </Card>

              <InlineStack gap="400" wrap>
                <div style={{ flex: "1 1 180px", minWidth: 180 }}>
                  <Stat label="Needs Attention" value={data.summary.needsAttentionCount} tone={data.summary.needsAttentionCount ? "warning" : "success"} />
                </div>
                <div style={{ flex: "1 1 180px", minWidth: 180 }}>
                  <Stat label="Ready to Approve" value={data.summary.readyToApproveCount} />
                </div>
                <div style={{ flex: "1 1 180px", minWidth: 180 }}>
                  <Stat label="Quick Wins" value={data.summary.quickWinCount} />
                </div>
                <div style={{ flex: "1 1 180px", minWidth: 180 }}>
                  <Stat label="Missing Alt Text" value={data.summary.imageMissingAltText} tone={data.summary.imageMissingAltText ? "warning" : "success"} />
                </div>
              </InlineStack>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">Data Quality</Text>
                  <InlineStack gap="200" wrap>
                    <Badge tone="info">{`SEO snapshot: ${timeAgo(data.dataQuality.seoSnapshotFetchedAt)}`}</Badge>
                    <Badge tone="info">{`GSC rows: ${timeAgo(data.dataQuality.gscCapturedAt)}`}</Badge>
                    <Badge tone="info">{`GA4 rows: ${timeAgo(data.dataQuality.ga4CapturedAt)}`}</Badge>
                    <Badge tone={data.dataQuality.imageSummary.available ? "success" : "warning"}>
                      {`Images: ${data.dataQuality.imageSummary.available ? "available" : "unavailable"}`}
                    </Badge>
                  </InlineStack>
                  <BlockStack gap="050">
                    {data.dataQuality.caveats.map((caveat) => (
                      <Text key={caveat} as="p" tone="subdued" variant="bodySm">
                        {caveat}
                      </Text>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>

              <BriefSection
                title="Needs Attention"
                empty="No stale jobs, hard blocks, urgent store tasks, critical competitor signals, or image issues."
                items={data.sections.needsAttention}
              />

              <BriefSection
                title="Ready to Approve"
                empty="No pending content proposals or ad recommendations."
                items={data.sections.readyToApprove}
              />

              <BriefSection
                title="Low Risk / Quick Wins"
                empty="No open quick-win opportunities."
                items={data.sections.quickWins}
              />
            </BlockStack>
          ) : null}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
