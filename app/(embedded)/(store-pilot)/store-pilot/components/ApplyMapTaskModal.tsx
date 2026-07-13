import { BlockStack, Modal, Text } from "@shopify/polaris";
import { MapTaskDetails, type StoreTaskView } from "./MapTaskDetails";

export function ApplyMapTaskModal({ open, task, loading, disabled = false, onClose, onConfirm }: {
  open: boolean;
  task: StoreTaskView | null;
  loading: boolean;
  disabled?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open && Boolean(task)}
      onClose={onClose}
      title="Approve topical-map change"
      primaryAction={{ content: "Approve and queue", onAction: onConfirm, loading, disabled: disabled || loading }}
      secondaryActions={[{ content: "Cancel", onAction: onClose, disabled: disabled || loading }]}
    >
      <Modal.Section>
        {task ? (
          <BlockStack gap="300">
            <Text as="p">Confirm the exact target and changed fields. This approves the linked recommendation and queues guarded execution; Shopify is not changed by this confirmation.</Text>
            <MapTaskDetails task={task} compact />
          </BlockStack>
        ) : null}
      </Modal.Section>
    </Modal>
  );
}
