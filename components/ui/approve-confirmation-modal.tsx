"use client";

import { Modal, Text, BlockStack, InlineStack, Badge, Box } from "@shopify/polaris";

export interface ApprovableRecommendation {
  id: string;
  actionType: string;
  targetEntityName: string;
  currentValue?: string | null;
  proposedValue?: string | null;
  changePercent?: number | null;
  guardStatus?: string;
  guardReason?: string | null;
  estimatedImpact?: string | null;
}

function actionLabel(t: string) {
  const map: Record<string, string> = {
    pause_campaign: "Pause Campaign",
    pause_ad: "Pause Ad",
    adjust_budget: "Adjust Budget",
    enable_campaign: "Enable Campaign",
  };
  return map[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Confirmation dialog shown before approving a recommendation. Approval queues the
 * change for live execution by the execute-approved cron, so the operator must see
 * the concrete current → proposed change before committing.
 */
export function ApproveConfirmationModal({
  rec,
  open,
  loading,
  onConfirm,
  onCancel,
}: {
  rec: ApprovableRecommendation | null;
  open: boolean;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open && rec !== null}
      onClose={onCancel}
      title="Approve this change?"
      primaryAction={{ content: "Approve", loading, onAction: onConfirm }}
      secondaryActions={[{ content: "Cancel", disabled: loading, onAction: onCancel }]}
    >
      {rec && (
        <Modal.Section>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center" wrap>
              <Badge tone={rec.actionType.startsWith("pause") ? "critical" : "attention"}>
                {actionLabel(rec.actionType)}
              </Badge>
              <Text as="span" variant="bodyMd" fontWeight="semibold">{rec.targetEntityName}</Text>
            </InlineStack>

            {rec.currentValue && rec.proposedValue ? (
              <Box background="bg-surface-secondary" borderRadius="200" padding="300">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" tone="subdued">{rec.currentValue}</Text>
                  <Text as="span">→</Text>
                  <Text as="span" fontWeight="semibold">
                    {rec.proposedValue}
                    {rec.changePercent != null && ` (${rec.changePercent > 0 ? "+" : ""}${rec.changePercent.toFixed(1)}%)`}
                  </Text>
                </InlineStack>
              </Box>
            ) : (
              <Box background="bg-surface-secondary" borderRadius="200" padding="300">
                <Text as="p">{actionLabel(rec.actionType)} — {rec.targetEntityName}</Text>
              </Box>
            )}

            {rec.estimatedImpact && (
              <Text as="p" tone="subdued">Estimated impact: {rec.estimatedImpact}</Text>
            )}

            {rec.guardStatus === "soft_flag" && rec.guardReason && (
              <Box background="bg-surface-caution" borderRadius="100" padding="200">
                <Text as="p" variant="bodySm">⚠ {rec.guardReason}</Text>
              </Box>
            )}

            <Text as="p" variant="bodySm" tone="subdued">
              Approving queues this change for live execution on the next automated run.
              You can undo from the confirmation toast until execution starts.
            </Text>
          </BlockStack>
        </Modal.Section>
      )}
    </Modal>
  );
}
