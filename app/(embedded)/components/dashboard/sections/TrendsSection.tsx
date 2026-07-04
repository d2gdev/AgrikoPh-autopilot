import { BlockStack, Card, Layout, SkeletonBodyText, Text } from "@shopify/polaris";
import { StatGrid } from "@/components/ui/stat-grid";
import type { PanelState } from "@/lib/dashboard/client-state";
import type { DashboardData, ActivityPayload, AdTrendPayload, SparklineDay, AdTrendPoint } from "../types";
import { PanelNotice, hasActivityData } from "../helpers";
import { Sparkline } from "../Sparkline";

export function TrendsSection({
  activityPanel,
  adTrendPanel,
  activityDays,
  adTrend,
  contentLift,
  contentLiftValue,
  contentLiftSign,
  onRetryActivity,
  onRetryAdTrend,
}: {
  activityPanel: PanelState<ActivityPayload>;
  adTrendPanel: PanelState<AdTrendPayload>;
  activityDays: SparklineDay[];
  adTrend: AdTrendPoint[];
  contentLift: DashboardData["contentLift"] | undefined;
  contentLiftValue: number;
  contentLiftSign: string;
  onRetryActivity: () => void;
  onRetryAdTrend: () => void;
}) {
  return (
    <Layout.Section>
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Trends</Text>
          <PanelNotice
            panel={activityPanel}
            label="Activity trend"
            staleLabel="Activity trend"
            onRetry={onRetryActivity}
          />
          <PanelNotice
            panel={adTrendPanel}
            label="Ad spend trend"
            staleLabel="Ad spend trend"
            onRetry={onRetryAdTrend}
          />
          <StatGrid>
            <BlockStack gap="150">
              <Text as="p" fontWeight="semibold">Activity (30d)</Text>
              {activityPanel.status === "loading" && activityDays.length === 0 ? (
                <SkeletonBodyText lines={2} />
              ) : activityDays.length > 0 && hasActivityData({ days: activityDays }) ? (
                <>
                  <Sparkline data={activityDays.map((d) => d.count)} color="var(--p-color-bg-fill-info)" label="Activity events over the last 30 days" />
                  <Text as="p" tone="subdued">
                    {activityDays.reduce((s, d) => s + d.count, 0)} events
                  </Text>
                </>
              ) : (
                <Text as="p" tone="subdued">No audit events in the activity window.</Text>
              )}
            </BlockStack>

            <BlockStack gap="150">
              <Text as="p" fontWeight="semibold">Ad Spend trend</Text>
              {adTrendPanel.status === "loading" && adTrend.length === 0 ? (
                <SkeletonBodyText lines={2} />
              ) : adTrend.length > 0 ? (
                <>
                  <Sparkline data={adTrend.map((t) => t.spend)} color="var(--p-color-bg-fill-success)" label="Ad spend snapshots" />
                  <Text as="p" tone="subdued">
                    {`${adTrend.length} snapshots · latest ROAS ${adTrend[adTrend.length - 1]?.roas?.toFixed(2) ?? "—"}x`}
                  </Text>
                </>
              ) : (
                <Text as="p" tone="subdued">No ad snapshots available yet.</Text>
              )}
            </BlockStack>

            {contentLift && (
              <BlockStack gap="150">
                <Text as="p" fontWeight="semibold">Content SEO lift</Text>
                <Text variant="headingLg" as="p">
                  {`${contentLiftSign}${contentLiftValue.toFixed(1)} pts`}
                </Text>
                <Text as="p" tone="subdued">
                  avg across {contentLift.count} re-scored article{contentLift.count !== 1 ? "s" : ""}
                </Text>
              </BlockStack>
            )}
          </StatGrid>
        </BlockStack>
      </Card>
    </Layout.Section>
  );
}
