import { Badge, BlockStack, Box, Button, Collapsible, Divider, InlineStack, Text } from "@shopify/polaris";
import { useState } from "react";

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
  redirect_conflict: "An exact-source redirect already points elsewhere. This conflict is advisory and will not be updated automatically.",
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

function boundedLinks(value: unknown): Array<{ toUrl: string; anchor: string; currentBodyState?: string; linkPurpose?: string; requiredAction?: string; verification?: string; priority?: string; resolutionStatus?: string }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item) => {
    const link = record(item);
    const toUrl = typeof link.toUrl === "string" ? link.toUrl.slice(0, 500) : "";
    const anchor = typeof link.anchor === "string" ? link.anchor.slice(0, 500) : "";
    const optional = (key: string) => typeof link[key] === "string" ? String(link[key]).slice(0, 500) : undefined;
    return toUrl && anchor ? [{ toUrl, anchor, currentBodyState: optional("currentBodyState"), linkPurpose: optional("linkPurpose"), requiredAction: optional("requiredAction"), verification: optional("verification"), priority: optional("priority"), resolutionStatus: optional("resolutionStatus") }] : [];
  });
}

const PREVIEW_LENGTH = 400;

function ValuePreview({ value, kind }: { value: string; kind: "current" | "proposed" }) {
  const [expanded, setExpanded] = useState(false);
  const long = value.length > PREVIEW_LENGTH;
  const shown = long && !expanded ? `${value.slice(0, PREVIEW_LENGTH)}…` : value;
  return (
    <BlockStack gap="100">
      <Text as="p">{shown}</Text>
      {long ? (
        <Button variant="plain" textAlign="left" onClick={() => setExpanded((current) => !current)} ariaExpanded={expanded}>
          {expanded ? `Show preview of ${kind} value` : `Show full ${kind} value`}
        </Button>
      ) : null}
    </BlockStack>
  );
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
  const [rawHtmlOpen, setRawHtmlOpen] = useState(false);
  const executable = task.sourceData.executable === true;
  const rules = Array.isArray(task.sourceData.ruleIds) ? task.sourceData.ruleIds.filter((rule): rule is string => typeof rule === "string") : [];
  const ruleCount = typeof task.sourceData.ruleCount === "number" ? task.sourceData.ruleCount : rules.length;
  const observedAt = typeof task.sourceData.observedAt === "string" ? task.sourceData.observedAt : null;
  const reason = typeof task.sourceData.advisoryReason === "string" ? advisoryReasons[task.sourceData.advisoryReason] ?? task.sourceData.advisoryReason : null;
  const mapPriority = typeof task.sourceData.mapPriority === "string" ? task.sourceData.mapPriority : null;
  const proposedCanonicalUrl = typeof task.sourceData.proposedCanonicalUrl === "string" ? task.sourceData.proposedCanonicalUrl : null;
  const mapDecision = typeof task.sourceData.mapDecision === "string" ? task.sourceData.mapDecision : null;
  const mapEvidence = typeof task.sourceData.mapEvidence === "string" ? task.sourceData.mapEvidence : null;
  const mapPublishingState = typeof task.sourceData.mapPublishingState === "string" ? task.sourceData.mapPublishingState : null;
  const mapProposedRedirectTarget = typeof task.sourceData.mapProposedRedirectTarget === "string" ? task.sourceData.mapProposedRedirectTarget : null;
  const observedRedirectTarget = typeof task.sourceData.observedRedirectTarget === "string" ? task.sourceData.observedRedirectTarget : null;
  const observedRedirectId = typeof task.sourceData.observedRedirectId === "string" ? task.sourceData.observedRedirectId : null;
  const observedStateHash = typeof task.sourceData.observedStateHash === "string" ? task.sourceData.observedStateHash : null;
  const internalLinkTask = task.proposedState.action === "internal_link";
  const redirectTask = task.proposedState.action === "redirect_create";
  const redirectTarget = redirectTask && typeof record(task.proposedState.after).target === "string" ? String(record(task.proposedState.after).target) : null;
  const links = internalLinkTask ? boundedLinks(task.sourceData.links) : [];
  const allFields = changedFields(task);
  const fields = redirectTask ? [] : internalLinkTask ? allFields.filter((field) => field.key !== "bodyHtml") : allFields;
  const rawHtmlFields = internalLinkTask ? allFields.filter((field) => field.key === "bodyHtml") : [];

  return (
    <BlockStack gap={compact ? "200" : "300"}>
      <InlineStack gap="200" wrap>
        <Badge tone={executable ? "success" : "attention"}>{executable ? "Executable" : "Advisory only"}</Badge>
      </InlineStack>
      <InlineStack gap="300" wrap>
        {typeof task.sourceData.strategyVersionId === "string" ? <Text as="p" variant="bodySm"><strong>Strategy version:</strong> {task.sourceData.strategyVersionId}</Text> : null}
        {typeof task.sourceData.packageSha256 === "string" ? <Text as="p" variant="bodySm"><strong>Package:</strong> {task.sourceData.packageSha256.slice(0, 12)}</Text> : null}
        {typeof task.sourceData.resolutionStatus === "string" ? <Text as="p" variant="bodySm"><strong>Rule status:</strong> {task.sourceData.resolutionStatus}</Text> : null}
      </InlineStack>
      {redirectTask ? <InlineStack gap="600" wrap><BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Redirect source</Text><Text as="p">{task.targetUrl ?? "No source provided"}</Text></BlockStack><BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Proposed target</Text><Text as="p">{redirectTarget ?? "No target provided"}</Text></BlockStack></InlineStack> : <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Target</Text><Text as="p">{task.targetUrl ?? "No target provided"}</Text></BlockStack>}
      {rules.length ? (
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" tone="subdued">Governing rules{ruleCount > rules.length ? ` (showing ${rules.length} of ${ruleCount})` : ""}</Text>
          <Text as="p">{rules.join(", ")}</Text>
        </BlockStack>
      ) : null}
      {observedAt ? <Text as="p" variant="bodySm" tone="subdued">Evidence observed {new Date(observedAt).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</Text> : <Text as="p" variant="bodySm" tone="subdued">Observation time unavailable or not required for this advisory task.</Text>}
      {reason ? <Text as="p" tone="subdued">{reason}</Text> : null}
      {mapProposedRedirectTarget || observedRedirectTarget || observedRedirectId || observedStateHash ? (
        <BlockStack gap="100">
          {mapProposedRedirectTarget ? <Text as="p"><strong>Map-proposed target:</strong> {mapProposedRedirectTarget}</Text> : null}
          {observedRedirectTarget ? <Text as="p"><strong>Observed conflicting target:</strong> {observedRedirectTarget}</Text> : null}
          {observedRedirectId ? <Text as="p"><strong>Observed redirect ID:</strong> {observedRedirectId}</Text> : null}
          {observedStateHash ? <Text as="p"><strong>Observed state hash:</strong> {observedStateHash}</Text> : null}
        </BlockStack>
      ) : null}
      {mapPriority || proposedCanonicalUrl || mapDecision || mapEvidence || mapPublishingState ? (
        <BlockStack gap="100">
          {mapPriority ? <Text as="p"><strong>Original priority:</strong> {mapPriority}</Text> : null}
          {proposedCanonicalUrl ? <Text as="p"><strong>Proposed canonical URL:</strong> {proposedCanonicalUrl}</Text> : null}
          {mapDecision ? <Text as="p"><strong>Decision:</strong> {mapDecision}</Text> : null}
          {mapEvidence ? <Text as="p"><strong>Evidence:</strong> {mapEvidence}</Text> : null}
          {mapPublishingState ? <Text as="p"><strong>Publishing state:</strong> {mapPublishingState}</Text> : null}
        </BlockStack>
      ) : null}
      {links.length ? (
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">Links to add ({links.length})</Text>
          {links.map((link) => (
            <BlockStack key={`${link.toUrl}:${link.anchor}`} gap="050">
              <Text as="p" fontWeight="semibold">{link.anchor}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{link.toUrl}</Text>
              {link.currentBodyState ? <Text as="p" variant="bodySm"><strong>Map-recorded state:</strong> {link.currentBodyState}</Text> : null}
              {link.linkPurpose ? <Text as="p" variant="bodySm"><strong>Purpose:</strong> {link.linkPurpose}</Text> : null}
              {link.requiredAction ? <Text as="p" variant="bodySm"><strong>Required action:</strong> {link.requiredAction}</Text> : null}
              {link.verification ? <Text as="p" variant="bodySm"><strong>Verification:</strong> {link.verification}</Text> : null}
              {link.priority ? <Text as="p" variant="bodySm"><strong>Original priority:</strong> {link.priority}</Text> : null}
              {link.resolutionStatus ? <Text as="p" variant="bodySm"><strong>Rule status:</strong> {link.resolutionStatus}</Text> : null}
            </BlockStack>
          ))}
        </BlockStack>
      ) : null}
      {fields.length || rawHtmlFields.length ? <Divider /> : null}
      {fields.map((field) => (
        <BlockStack key={field.key} gap="100">
          <Text as="p" fontWeight="semibold">{field.label}</Text>
          <InlineStack gap="300" wrap>
            <Box minWidth="200px"><Text as="p" variant="bodySm" tone="subdued">Before</Text><ValuePreview value={field.before} kind="current" /></Box>
            <Box minWidth="200px"><Text as="p" variant="bodySm" tone="subdued">After</Text><ValuePreview value={field.after} kind="proposed" /></Box>
          </InlineStack>
        </BlockStack>
      ))}
      {rawHtmlFields.length ? (
        <BlockStack gap="200">
          <Button variant="plain" textAlign="left" onClick={() => setRawHtmlOpen((open) => !open)} ariaExpanded={rawHtmlOpen}>
            {rawHtmlOpen ? "Hide raw HTML diagnostic" : "Show raw HTML diagnostic"}
          </Button>
          <Collapsible open={rawHtmlOpen} id={`raw-html-${compact ? "compact" : "detail"}-${task.id}`} transition={{ duration: "200ms", timingFunction: "ease-in-out" }}>
            <BlockStack gap="300">
              {rawHtmlFields.map((field) => (
                <BlockStack key={field.key} gap="100">
                  <Text as="p" fontWeight="semibold">{field.label}</Text>
                  <InlineStack gap="300" wrap>
                    <Box minWidth="200px"><Text as="p" variant="bodySm" tone="subdued">Before</Text><ValuePreview value={field.before} kind="current" /></Box>
                    <Box minWidth="200px"><Text as="p" variant="bodySm" tone="subdued">After</Text><ValuePreview value={field.after} kind="proposed" /></Box>
                  </InlineStack>
                </BlockStack>
              ))}
            </BlockStack>
          </Collapsible>
        </BlockStack>
      ) : null}
    </BlockStack>
  );
}
