import { Badge, BlockStack, Box, Divider, InlineStack, Text } from "@shopify/polaris";

export interface StoreTaskView {
  id: string;
  targetUrl: string | null;
  sourceData: Record<string, unknown>;
  proposedState: Record<string, unknown>;
}

const advisoryReasons: Record<string, string> = {
  homepage_not_governed: "Homepage changes are not governed for execution from Store Pilot.",
  blog_index_not_governed: "Blog index changes are not governed for execution from Store Pilot.",
  redirect_execution_unsupported: "Redirect changes are not supported for execution from Store Pilot.",
  canonicalization_execution_prohibited: "Canonicalization changes cannot be executed from Store Pilot.",
  indexation_execution_prohibited: "Indexation changes cannot be executed from Store Pilot.",
  draft_unavailable: "A grounded draft is unavailable, so this task cannot be executed.",
};

const fieldLabels: Record<string, string> = {
  seoTitle: "SEO title",
  seoDescription: "SEO description",
  bodyHtml: "Body content",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not set";
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "Unavailable";
}

export function changedFields(task: StoreTaskView) {
  const before = record(task.proposedState.before);
  const after = record(task.proposedState.after);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].map((key) => ({
    key,
    label: fieldLabels[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()),
    before: displayValue(before[key]),
    after: displayValue(after[key]),
  }));
}

export function isTopicalMapTask(task: StoreTaskView): boolean {
  return task.sourceData.source === "topical-map";
}

export function MapTaskDetails({ task, compact = false }: { task: StoreTaskView; compact?: boolean }) {
  const executable = task.sourceData.executable === true;
  const rules = Array.isArray(task.sourceData.ruleIds) ? task.sourceData.ruleIds.filter((rule): rule is string => typeof rule === "string") : [];
  const observedAt = typeof task.sourceData.observedAt === "string" ? task.sourceData.observedAt : null;
  const reason = typeof task.sourceData.advisoryReason === "string" ? advisoryReasons[task.sourceData.advisoryReason] ?? task.sourceData.advisoryReason : null;
  const fields = changedFields(task);

  return (
    <BlockStack gap={compact ? "200" : "300"}>
      <InlineStack gap="200" wrap>
        <Badge tone={executable ? "success" : "attention"}>{executable ? "Executable" : "Advisory only"}</Badge>
        {typeof task.sourceData.strategyVersionId === "string" ? <Badge>{task.sourceData.strategyVersionId}</Badge> : null}
        {typeof task.sourceData.packageSha256 === "string" ? <Badge>{`Package ${task.sourceData.packageSha256.slice(0, 12)}`}</Badge> : null}
      </InlineStack>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">Target</Text>
        <Text as="p">{task.targetUrl ?? "No target provided"}</Text>
      </BlockStack>
      {rules.length ? (
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" tone="subdued">Governing rules</Text>
          <Text as="p">{rules.join(", ")}</Text>
        </BlockStack>
      ) : null}
      {observedAt ? <Text as="p" variant="bodySm" tone="subdued">Evidence observed {new Date(observedAt).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</Text> : null}
      {reason ? <Text as="p" tone="subdued">{reason}</Text> : null}
      {fields.length ? <Divider /> : null}
      {fields.map((field) => (
        <BlockStack key={field.key} gap="100">
          <Text as="p" fontWeight="semibold">{field.label}</Text>
          <InlineStack gap="300" wrap>
            <Box minWidth="200px"><Text as="p" variant="bodySm" tone="subdued">Before</Text><Text as="p">{field.before}</Text></Box>
            <Box minWidth="200px"><Text as="p" variant="bodySm" tone="subdued">After</Text><Text as="p">{field.after}</Text></Box>
          </InlineStack>
        </BlockStack>
      ))}
    </BlockStack>
  );
}
