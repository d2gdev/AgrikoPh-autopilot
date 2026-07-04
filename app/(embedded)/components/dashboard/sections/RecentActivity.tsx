import { Badge, BlockStack, Card, InlineStack, Layout, SkeletonBodyText, Text } from "@shopify/polaris";
import type { PanelState } from "@/lib/dashboard/client-state";
import { timeAgo, actionLabel } from "@/lib/format";
import type { AuditEntry } from "../types";
import { PanelNotice } from "../helpers";

export function RecentActivity({
  auditPanel,
  logs,
  onRetry,
}: {
  auditPanel: PanelState<AuditEntry[]>;
  logs: AuditEntry[];
  onRetry: () => void;
}) {
  return (
    <Layout.Section>
      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h2">Recent Activity</Text>
          <PanelNotice
            panel={auditPanel}
            label="Recent activity"
            staleLabel="Recent activity"
            onRetry={onRetry}
          />
          {auditPanel.status === "loading" && logs.length === 0 ? (
            <SkeletonBodyText lines={4} />
          ) : logs.length === 0 ? (
            <Text as="p" tone="subdued">No audit events yet. Run a job or review a recommendation to create activity.</Text>
          ) : (
            <BlockStack gap="200">
              {logs.slice(0, 10).map((log) => (
                <InlineStack key={log.id} align="space-between">
                  <InlineStack gap="200">
                    <Badge tone={log.actor === "user" ? "info" : "new"}>{log.actor}</Badge>
                    <Text as="p">{actionLabel(log.action)}</Text>
                    <Text as="p" tone="subdued">{log.entityType}</Text>
                  </InlineStack>
                  <Text as="p" tone="subdued">{timeAgo(log.createdAt)}</Text>
                </InlineStack>
              ))}
            </BlockStack>
          )}
        </BlockStack>
      </Card>
    </Layout.Section>
  );
}
