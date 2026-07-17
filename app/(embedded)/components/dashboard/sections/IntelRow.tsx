import { Badge, BlockStack, Card, InlineStack, Layout, Text } from "@shopify/polaris";
import Link from "next/link";
import { StatGrid } from "@/components/ui/stat-grid";
import type { DashboardData } from "../types";
import { StatCardSkeleton } from "../helpers";

export function IntelRow({ loading, data }: { loading: boolean; data: DashboardData | null }) {
  return (
    <Layout.Section>
      <BlockStack gap="300">
        <Text variant="headingMd" as="h2">Intel</Text>
        <StatGrid>
          {loading ? (
            <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
          ) : (
            <>
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Opportunities</Text>
                  {(() => {
                    const o = data?.openOpportunities ?? { high: 0, medium: 0, low: 0 };
                    const total = o.high + o.medium + o.low;
                    if (total === 0) return <Text as="p" tone="subdued">None open</Text>;
                    return (
                      <InlineStack gap="300">
                        {o.high > 0 && <Badge tone="critical">{`${o.high} high`}</Badge>}
                        {o.medium > 0 && <Badge tone="warning">{`${o.medium} medium`}</Badge>}
                        {o.low > 0 && <Badge>{`${o.low} low`}</Badge>}
                      </InlineStack>
                    );
                  })()}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Market Insights</Text>
                  {(() => {
                    const mi = data?.openMarketInsights ?? { critical: 0, warning: 0, info: 0 };
                    const total = mi.critical + mi.warning + mi.info;
                    if (total === 0) return <Text as="p" tone="subdued">No open insights</Text>;
                    return (
                      <InlineStack gap="300">
                        {mi.critical > 0 && <Badge tone="critical">{`${mi.critical} critical`}</Badge>}
                        {mi.warning > 0 && <Badge tone="warning">{`${mi.warning} warning`}</Badge>}
                        {mi.info > 0 && <Badge>{`${mi.info} info`}</Badge>}
                      </InlineStack>
                    );
                  })()}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Store Tasks</Text>
                  <Text variant="heading2xl" as="p">{data?.pendingStoreTasks ?? "—"}</Text>
                  <Text as="p" tone="subdued">pending</Text>
                  {data?.dbLatencyMs != null && (
                    <Text
                      as="p"
                      tone={data.dbLatencyMs < 100 ? "success" : data.dbLatencyMs < 500 ? undefined : "critical"}
                    >
                      DB {data.dbLatencyMs}ms
                    </Text>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">SEO Tasks</Text>
                  <Link href="/seo-tasks" style={{ textDecoration: "none", color: "inherit" }}>
                    <InlineStack gap="500">
                      <BlockStack gap="100">
                        <Text variant="headingLg" as="p">{data?.seoTaskSummary?.ready ?? "—"}</Text>
                        <Text as="p" tone="subdued">ready now</Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="headingLg" as="p">{data?.seoTaskSummary?.waiting ?? "—"}</Text>
                        <Text as="p" tone="subdued">waiting</Text>
                      </BlockStack>
                    </InlineStack>
                  </Link>
                  <Text as="p" tone="subdued">
                    {data?.seoTaskSummary?.nextScheduledReviewAt
                      ? `Next review ${new Intl.DateTimeFormat("en-PH", {
                        dateStyle: "medium",
                        timeZone: "Asia/Manila",
                      }).format(new Date(data.seoTaskSummary.nextScheduledReviewAt))}`
                      : "No scheduled review"}
                  </Text>
                </BlockStack>
              </Card>
            </>
          )}
        </StatGrid>
      </BlockStack>
    </Layout.Section>
  );
}
