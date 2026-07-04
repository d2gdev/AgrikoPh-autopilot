import { Badge, BlockStack, Card, InlineStack, Layout, Text } from "@shopify/polaris";
import Link from "next/link";
import { StatGrid } from "@/components/ui/stat-grid";
import { timeAgo, formatPhp } from "@/lib/format";
import type { DashboardData } from "../types";
import { StatCardSkeleton } from "../helpers";

export function OperationsRow({ loading, data }: { loading: boolean; data: DashboardData | null }) {
  return (
    <Layout.Section>
      <BlockStack gap="300">
        <Text variant="headingMd" as="h2">Operations</Text>
        <StatGrid>
          {loading ? (
            <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
          ) : (
            <>
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Pending</Text>
                  <Link href="/recommendations" style={{ textDecoration: "none", color: "inherit" }}>
                    <Text variant="heading2xl" as="p">{data?.pendingCount ?? "—"}</Text>
                  </Link>
                  {(data?.hardBlockedCount ?? 0) > 0 && (
                    <Badge tone="critical">{`${data!.hardBlockedCount} hard blocked`}</Badge>
                  )}
                  {(data?.recsPendingOver7Days ?? 0) > 0 && (
                    <Badge tone="warning">{`${data!.recsPendingOver7Days} stale >7d`}</Badge>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Executed This Month</Text>
                  <Link href="/ad-pilot" style={{ textDecoration: "none", color: "inherit" }}>
                    <Text variant="heading2xl" as="p">{data?.executedThisMonth ?? "—"}</Text>
                  </Link>
                  {data?.estimatedValueExecuted != null && (
                    <Text as="p" tone="subdued">
                      est. {formatPhp(data.estimatedValueExecuted, 0)} impact
                    </Text>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Failed / Override</Text>
                  <Link href="/recommendations" style={{ textDecoration: "none", color: "inherit" }}>
                    <InlineStack gap="200" blockAlign="end">
                      <Text variant="heading2xl" as="p">{data?.failedCount ?? "—"}</Text>
                      <Text as="p" tone="subdued">/ {data?.overrideCount ?? "—"}</Text>
                    </InlineStack>
                  </Link>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Last Job Run</Text>
                  {data?.lastJobRun ? (
                    <BlockStack gap="100">
                      <Text as="p">{data.lastJobRun.jobName.replace(/-/g, " ")}</Text>
                      <Badge tone={["success", "partial"].includes(data.lastJobRun.status) ? "success" : "critical"}>
                        {data.lastJobRun.status}
                      </Badge>
                      <Text as="p" tone="subdued">{timeAgo(data.lastJobRun.startedAt)}</Text>
                    </BlockStack>
                  ) : (
                    <Text as="p" tone="subdued">Never run</Text>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Outcome Win Rate (90d)</Text>
                  {data?.outcomeWinRate ? (
                    <BlockStack gap="100">
                      <Text variant="heading2xl" as="p">
                        {Math.round((data.outcomeWinRate.improved / data.outcomeWinRate.total) * 100)}%
                      </Text>
                      <Text as="p" tone="subdued">
                        {data.outcomeWinRate.improved} improved · {data.outcomeWinRate.worsened} worsened · {Math.max(0, data.outcomeWinRate.total - data.outcomeWinRate.improved - data.outcomeWinRate.worsened)} neutral/insufficient · {data.outcomeWinRate.total} checked
                      </Text>
                    </BlockStack>
                  ) : (
                    <Text as="p" tone="subdued">No outcomes checked yet</Text>
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
