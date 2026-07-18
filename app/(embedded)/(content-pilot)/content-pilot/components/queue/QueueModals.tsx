import { Badge, BlockStack, Checkbox, Divider, InlineStack, Modal, Text } from "@shopify/polaris";

import type { ContentProposal } from "../types";
import { countWordsFromHtml } from "../helpers";

export function QueueModals({
  showPublishModal,
  publishCandidates,
  publishReviewChecked,
  bulkActing,
  onClosePublishModal,
  onConfirmPublishAll,
  onPublishReviewCheckedChange,
}: {
  showPublishModal: boolean;
  publishCandidates: ContentProposal[];
  publishReviewChecked: boolean;
  bulkActing: boolean;
  onClosePublishModal: () => void;
  onConfirmPublishAll: () => void;
  onPublishReviewCheckedChange: (v: boolean) => void;
}) {
  return (
    <>
      <Modal
        open={showPublishModal}
        onClose={onClosePublishModal}
        title={`Publish ${publishCandidates.length} article${publishCandidates.length === 1 ? "" : "s"}`}
        primaryAction={{
          content: "Publish All",
          disabled: !publishReviewChecked,
          loading: bulkActing,
          onAction: onConfirmPublishAll,
        }}
        secondaryActions={[{ content: "Cancel", onAction: onClosePublishModal }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" tone="subdued">Review each article before publishing:</Text>
            {publishCandidates.map((p) => {
              const wc = countWordsFromHtml(p.bodyHtml ?? "");
              return (
                <InlineStack key={p.id} align="space-between" blockAlign="center">
                  <Text as="p">{p.title}</Text>
                  <Badge tone={wc >= 300 ? "success" : wc >= 100 ? "warning" : "critical"}>
                    {`${wc} words`}
                  </Badge>
                </InlineStack>
              );
            })}
            <Divider />
            <Checkbox
              label="I have reviewed these drafts and they are ready to publish"
              checked={publishReviewChecked}
              onChange={onPublishReviewCheckedChange}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
