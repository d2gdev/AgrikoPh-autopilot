import { Badge, BlockStack, Button, Card, Divider, InlineStack, Layout, Text } from "@shopify/polaris";
import { actionLabel } from "@/lib/format";
import type { DashboardData } from "../types";

export function PendingRecInbox({
  pendingCount,
  topPendingRecs,
  recAction,
  onApprove,
  onReject,
}: {
  pendingCount: number;
  topPendingRecs: NonNullable<DashboardData["topPendingRecs"]>;
  recAction: Record<string, "approving" | "rejecting" | "done">;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <>
      <Layout.Section>
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">
              Pending Review ({pendingCount})
            </Text>
            <BlockStack gap="300">
              {topPendingRecs.map((rec) => {
                const state = recAction[rec.id];
                const busy = state === "approving" || state === "rejecting";
                if (state === "done") return null;
                return (
                  <BlockStack key={rec.id} gap="150">
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Text as="p" fontWeight="semibold">{actionLabel(rec.actionType)}</Text>
                          <Text as="p" tone="subdued">—</Text>
                          <Text as="p">{rec.targetEntityName}</Text>
                          {rec.guardStatus !== "clear" && (
                            <Badge tone={rec.guardStatus === "hard_block" ? "critical" : "warning"}>
                              {rec.guardStatus.replace(/_/g, " ")}
                            </Badge>
                          )}
                        </InlineStack>
                        <Text as="p" tone="subdued">{rec.rationale}</Text>
                        {rec.estimatedImpact && (
                          <Text as="p" tone="subdued">{rec.estimatedImpact}</Text>
                        )}
                      </BlockStack>
                      <InlineStack gap="200">
                        <Button
                          size="slim"
                          variant="primary"
                          loading={state === "approving"}
                          disabled={busy || rec.guardStatus === "hard_block"}
                          onClick={() => onApprove(rec.id)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="slim"
                          loading={state === "rejecting"}
                          disabled={busy}
                          onClick={() => onReject(rec.id)}
                        >
                          Reject
                        </Button>
                      </InlineStack>
                    </InlineStack>
                    <Divider />
                  </BlockStack>
                );
              })}
            </BlockStack>
          </BlockStack>
        </Card>
      </Layout.Section>
      <Layout.Section><Divider /></Layout.Section>
    </>
  );
}
