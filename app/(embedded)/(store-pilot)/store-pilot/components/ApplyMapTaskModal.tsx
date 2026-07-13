import { BlockStack, Modal, Text } from "@shopify/polaris";
import { MapTaskDetails, type StoreTaskView } from "./MapTaskDetails";

export function ApplyMapTaskModal({ open, task, loading, onClose, onConfirm }: {
  open: boolean;
  task: StoreTaskView | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open && Boolean(task)}
      onClose={onClose}
      title="Apply topical-map change"
      primaryAction={{ content: "Apply change", onAction: onConfirm, loading, disabled: loading }}
      secondaryActions={[{ content: "Cancel", onAction: onClose, disabled: loading }]}
    >
      <Modal.Section>
        {task ? (
          <BlockStack gap="300">
            <Text as="p">Confirm the exact target and changed fields before applying this update to Shopify.</Text>
            <MapTaskDetails task={task} compact />
          </BlockStack>
        ) : null}
      </Modal.Section>
    </Modal>
  );
}
