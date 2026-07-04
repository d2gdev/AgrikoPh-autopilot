import { Badge, BlockStack, Card, InlineStack, Layout, SkeletonBodyText, Text } from "@shopify/polaris";
import Link from "next/link";
import type { PanelState } from "@/lib/dashboard/client-state";
import { StatGrid } from "@/components/ui/stat-grid";
import { actionLabel, formatPhp } from "@/lib/format";
import type { DashboardData, GscMoversPayload } from "../types";
import { StatCardSkeleton, PanelNotice } from "../helpers";

export function PerformanceRow({
  loading,
  data,
  spend,
  spendSign,
  totalActionsThisMonth,
  gscMoversPanel,
  gscMovers,
  onRetryGscMovers,
}: {
  loading: boolean;
  data: DashboardData | null;
  spend: DashboardData["adSpendSummary"] | undefined;
  spendSign: string;
  totalActionsThisMonth: number;
  gscMoversPanel: PanelState<GscMoversPayload>;
  gscMovers: GscMoversPayload | null;
  onRetryGscMovers: () => void;
}) {
  return (
    <Layout.Section>
      <BlockStack gap="300">
        <Text variant="headingMd" as="h2">Performance</Text>
        <StatGrid>
          {loading ? (
            <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
          ) : (
            <>
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Ad Spend (Latest)</Text>
                  <Link href="/ad-pilot" style={{ textDecoration: "none", color: "inherit" }}>
                    <Text variant="heading2xl" as="p">
                      {spend && spend.current > 0 ? formatPhp(spend.current, 0) : "—"}
                    </Text>
                  </Link>
                  {spend && spend.previous > 0 && (
                    <Text as="p" tone={spend.delta <= 0 ? "success" : "critical"}>
                      {spendSign}{formatPhp(spend.delta, 0)}
                      {spend.deltaPct != null && ` (${spendSign}${spend.deltaPct.toFixed(1)}%)`}
                      {" vs prior"}
                    </Text>
                  )}
                  {totalActionsThisMonth > 0 && (spend?.delta ?? 0) !== 0 && (
                    <Text as="p" tone="subdued">
                      {`${totalActionsThisMonth} action${totalActionsThisMonth !== 1 ? "s" : ""} taken this month`}
                    </Text>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Revenue vs Meta (period)</Text>
                  {data?.revenueVsMeta ? (
                    <BlockStack gap="100">
                      <Text variant="heading2xl" as="p">{formatPhp(data.revenueVsMeta.shopifyRevenue, 0)}</Text>
                      <Text as="p" tone="subdued">
                        Shopify ({data.revenueVsMeta.daysCovered}d) vs {data.revenueVsMeta.metaConversionValue != null ? formatPhp(data.revenueVsMeta.metaConversionValue, 0) : "—"} Meta-reported
                      </Text>
                    </BlockStack>
                  ) : (
                    <Text as="p" tone="subdued">No sales data yet — runs after the first fetch-orders cycle</Text>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Content Pilot</Text>
                  <Link href="/content-pilot" style={{ textDecoration: "none", color: "inherit" }}>
                    <InlineStack gap="500">
                      <BlockStack gap="100">
                        <Text variant="headingLg" as="p">{data?.contentPilotStats.pending ?? "—"}</Text>
                        <Text as="p" tone="subdued">pending</Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="headingLg" as="p">{data?.contentPilotStats.drafting ?? "—"}</Text>
                        <Text as="p" tone="subdued">drafting</Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="headingLg" as="p">{data?.contentPilotStats.publishedThisMonth ?? "—"}</Text>
                        <Text as="p" tone="subdued">published</Text>
                      </BlockStack>
                    </InlineStack>
                  </Link>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Actions This Month</Text>
                  {!data?.recsByActionType?.length ? (
                    <Text as="p" tone="subdued">None yet</Text>
                  ) : (
                    <BlockStack gap="100">
                      {data.recsByActionType.map((r) => (
                        <InlineStack key={r.actionType} align="space-between">
                          <Text as="p">{actionLabel(r.actionType)}</Text>
                          <Badge>{String(r.count)}</Badge>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">GSC Movers</Text>
                  <PanelNotice
                    panel={gscMoversPanel}
                    label="GSC movers"
                    staleLabel="GSC mover data"
                    onRetry={onRetryGscMovers}
                  />
                  {gscMoversPanel.status === "loading" && !gscMovers ? (
                    <SkeletonBodyText lines={3} />
                  ) : !gscMovers || (gscMovers.risers.length === 0 && gscMovers.fallers.length === 0) ? (
                    <Text as="p" tone="subdued">No GSC snapshots with movement yet.</Text>
                  ) : (
                    <BlockStack gap="150">
                      {gscMovers.risers.map((m) => (
                        <InlineStack key={`r-${m.query}`} align="space-between">
                          <Text as="p">{m.query}</Text>
                          <Badge tone="success">{`+${m.clicksDelta} clicks`}</Badge>
                        </InlineStack>
                      ))}
                      {gscMovers.fallers.map((m) => (
                        <InlineStack key={`f-${m.query}`} align="space-between">
                          <Text as="p">{m.query}</Text>
                          <Badge tone="critical">{`${m.clicksDelta} clicks`}</Badge>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </>
          )}
        </StatGrid>
      </BlockStack>
    </Layout.Section>
  );
}
