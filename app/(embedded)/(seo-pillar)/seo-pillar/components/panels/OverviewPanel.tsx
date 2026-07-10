import { Card, Text, InlineStack, BlockStack, Layout } from "@shopify/polaris";
import { ResponsiveDataTable } from "@/app/(embedded)/components/ResponsiveDataTable";
import type { ReactNode } from "react";
import { timeAgo } from "@/lib/format";
import type { Totals, SnapshotTrendPoint, GscPage, QueryPagePair } from "../types";
import { BriefRenderer } from "../brief";
import { Delta, Sparkline } from "../widgets";

type Row = ReactNode[];

export function OverviewPanel({
  brief,
  cur,
  prev,
  gscFetchedAt,
  ga4FetchedAt,
  ga4Freshness,
  previousFetchedAt,
  trend,
  trendFirst,
  trendLast,
  moverRows,
  pageRows,
  queryRows,
  gscPages,
  queryPagePairs,
}: {
  brief: string | null;
  cur: Totals | undefined;
  prev: Totals | null | undefined;
  gscFetchedAt: string | null | undefined;
  ga4FetchedAt?: string | null;
  ga4Freshness?: { selectedSource: string; fallbackReason?: string | null };
  previousFetchedAt: string | null | undefined;
  trend: SnapshotTrendPoint[];
  trendFirst: SnapshotTrendPoint | undefined;
  trendLast: SnapshotTrendPoint | undefined;
  moverRows: Row[];
  pageRows: Row[];
  queryRows: Row[];
  gscPages: GscPage[];
  queryPagePairs: QueryPagePair[];
}) {
  return (
    <BlockStack gap="400">
      {brief && (
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">AI SEO Brief</Text>
            <BriefRenderer text={brief} />
          </BlockStack>
        </Card>
      )}
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
      {gscFetchedAt && (
        <Text as="p" tone="subdued" variant="bodySm">
          GSC updated {timeAgo(gscFetchedAt)}{previousFetchedAt ? ` · compared to ${timeAgo(previousFetchedAt)}` : " · no prior period to compare yet"}
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
                {/* Tokenized to the Polaris "info" (blue) role fill — exact visual match for the prior literal blue. */}
                <Sparkline points={trend.map((p) => p.clicks)} color="var(--p-color-bg-fill-info)" />
                <Text as="span" variant="bodySm" tone="subdued">{trendFirst.clicks.toLocaleString()} → {trendLast.clicks.toLocaleString()}</Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">Impressions</Text>
                {/* Tokenized to the Polaris "magic" (purple) role fill — exact visual match for the prior literal purple. */}
                <Sparkline points={trend.map((p) => p.impressions)} color="var(--p-color-bg-fill-magic)" />
                <Text as="span" variant="bodySm" tone="subdued">{trendFirst.impressions.toLocaleString()} → {trendLast.impressions.toLocaleString()}</Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">Avg position</Text>
                {/* Tokenized: Polaris has no teal role token, so this uses the closest muted
                    blue-teal fill (info-secondary), which stays visually distinct from the two
                    blue/purple sparklines above — the best available parity for the prior teal. */}
                <Sparkline points={trend.map((p) => -p.avgPosition)} color="var(--p-color-bg-fill-info-secondary)" />
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
                <ResponsiveDataTable columnContentTypes={["text", "text", "text", "numeric"]} headings={["Query", "Δ Clicks", "Δ Pos", "Clicks"]} rows={moverRows} />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Top Pages (GA4)</Text>
              {ga4FetchedAt && <Text as="p" tone="subdued" variant="bodySm">GA4 updated {timeAgo(ga4FetchedAt)}{ga4Freshness?.selectedSource === "rawSnapshot" ? " · fallback snapshot" : ""}</Text>}
              {pageRows.length === 0 ? <Text as="p" tone="subdued">No GA4 page data available yet.</Text> : (
                <ResponsiveDataTable columnContentTypes={["text", "numeric"]} headings={["Page", "Sessions"]} rows={pageRows} />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h2">Top Search Queries</Text>
          {queryRows.length === 0 ? <Text as="p" tone="subdued">No GSC data yet.</Text> : (
            <ResponsiveDataTable columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]} headings={["Query", "Clicks", "Impr.", "CTR", "Position"]} rows={queryRows} />
          )}
        </BlockStack>
      </Card>

      <Layout>
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Landing Pages (GSC)</Text>
              {gscPages.length === 0 ? (
                <Text as="p" tone="subdued">No GSC page data yet — appears after the next data fetch.</Text>
              ) : (
                <ResponsiveDataTable
                  columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                  headings={["Page", "Clicks", "Impr.", "Position"]}
                  rows={gscPages.slice(0, 15).map((p) => [p.page, String(p.clicks), String(p.impressions), p.position])}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Which Query → Which Page</Text>
              {queryPagePairs.length === 0 ? (
                <Text as="p" tone="subdued">No query×page data yet — appears after the next data fetch.</Text>
              ) : (
                <ResponsiveDataTable
                  columnContentTypes={["text", "text", "numeric"]}
                  headings={["Query", "Page", "Clicks"]}
                  rows={queryPagePairs.slice(0, 15).map((qp) => [qp.query, qp.page, String(qp.clicks)])}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </BlockStack>
  );
}
