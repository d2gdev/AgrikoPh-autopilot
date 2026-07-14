import { BlockStack, Modal, Text } from "@shopify/polaris";
import { MapTaskDetails, type StoreTaskView } from "./MapTaskDetails";

export function ApplyMapTaskModal({ open, task, stage, loading, disabled = false, onClose, onApprove, onExecute }: {
  open: boolean;
  task: StoreTaskView | null;
  stage: "review" | "approved";
  loading: boolean;
  disabled?: boolean;
  onClose: () => void;
  onApprove: () => void;
  onExecute: () => void;
}) {
  const action = stage === "review"
    ? { title: "Approve topical-map change", primary: "Approve and queue" }
    : { title: "Execute approved topical-map change", primary: "Execute approved change" };
  return (
    <Modal
      open={open && Boolean(task)}
      onClose={onClose}
      title={action.title}
      primaryAction={{ content: action.primary, onAction: stage === "review" ? onApprove : onExecute, loading, disabled: disabled || loading }}
      secondaryActions={[{ content: "Cancel", onAction: onClose, disabled: disabled || loading }]}
    >
      <Modal.Section>
        {task ? (
          <BlockStack gap="300">
            <Text as="p">{stage === "review"
              ? "Confirm the exact target and changed fields. Approval does not change Shopify; it queues the linked recommendation for guarded execution."
              : "Execution is limited to this target and still requires the server live execution gate."}</Text>
            <MapTaskDetails task={task} />
          </BlockStack>
        ) : null}
      </Modal.Section>
    </Modal>
  );
}
