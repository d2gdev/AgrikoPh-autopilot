import { Badge, BlockStack, Text } from "@shopify/polaris";

export function countWordsFromHtml(html: string): number {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;
}

export function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 80 ? "success" : score >= 50 ? "attention" : "critical";
  return <Badge tone={tone}>{String(score)}</Badge>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const tone = priority === "P1" ? "critical" : priority === "P2" ? "attention" : "info";
  return <Badge tone={tone}>{priority}</Badge>;
}

export function ImpactBadge({ level }: { level: string }) {
  const l = level?.toLowerCase();
  const tone = l === "high" ? "success" : l === "medium" ? "attention" : "info";
  return <Badge tone={tone}>{level}</Badge>;
}

export function SeoDeltaBadge({ before, after }: { before: number | null | undefined; after: number | null | undefined }) {
  if (before == null || after == null) return null;
  const delta = after - before;
  if (delta === 0) return <Badge tone="info">SEO ±0</Badge>;
  const tone = delta > 0 ? "success" : "critical";
  return <Badge tone={tone}>{delta > 0 ? `SEO +${delta}` : `SEO ${delta}`}</Badge>;
}

export function draftFailureMessage(data: Record<string, unknown>, fallback = "Draft generation failed") {
  const error = typeof data.error === "string" ? data.error : fallback;
  const detail = typeof data.detail === "string" ? data.detail : "";
  return detail && !error.includes(detail) ? `${error}: ${detail}` : error;
}

// Fix #6 — unknown types fall back to readable JSON rather than showing nothing
export function ProposedChangeSummary({
  proposalType,
  proposedState,
}: {
  proposalType: string;
  proposedState: Record<string, unknown>;
}) {
  const lines: string[] = [];

  if (proposalType === "missing-meta") {
    if (proposedState.field) lines.push(`Field: ${proposedState.field}`);
    if (proposedState.currentValue !== undefined) lines.push(`Current value: ${proposedState.currentValue ?? "none"}`);
    if (proposedState.issues) lines.push(`Issues: ${(proposedState.issues as string[]).join(", ")}`);
  } else if (proposalType === "seo-fix") {
    if (proposedState.targetQuery) lines.push(`Target query: ${proposedState.targetQuery}`);
    if (proposedState.action) lines.push(`Action: ${String(proposedState.action).replace(/-/g, " ")}`);
    if (proposedState.field) lines.push(`Field: ${proposedState.field}`);
    if (proposedState.suggestedTitleSuffix) lines.push(`Title suffix: ${proposedState.suggestedTitleSuffix}`);
  } else if (proposalType === "internal-link") {
    if (proposedState.fromArticle) lines.push(`Link from: ${proposedState.fromArticle}`);
    if (proposedState.toArticle) lines.push(`Link to: ${proposedState.toArticle}`);
    if (proposedState.suggestedAnchorText) lines.push(`Anchor text: "${proposedState.suggestedAnchorText}"`);
  } else if (proposalType === "content-refresh" || proposalType === "thin-content") {
    if (proposedState.action) lines.push(`Action: ${String(proposedState.action).replace(/-/g, " ")}`);
    if (proposedState.targetWordCount) lines.push(`Target word count: ${proposedState.targetWordCount}`);
    if (proposedState.currentWordCount) lines.push(`Current word count: ${proposedState.currentWordCount}`);
  } else if (proposalType === "new-content") {
    if (proposedState.targetKeyword) lines.push(`Target keyword: ${proposedState.targetKeyword}`);
    if (proposedState.suggestedTitle) lines.push(`Suggested title: ${proposedState.suggestedTitle}`);
    if (proposedState.idealWordCount) lines.push(`Target length: ${proposedState.idealWordCount} words`);
  } else {
    // Unknown type — show raw JSON so nothing is silently hidden
    return (
      <pre style={{ fontSize: "12px", overflowX: "auto", background: "var(--p-color-bg-surface-secondary)", padding: "8px", borderRadius: "4px" }}>
        {JSON.stringify(proposedState, null, 2)}
      </pre>
    );
  }

  if (lines.length === 0) return null;

  return (
    <BlockStack gap="100">
      {lines.map((l, i) => (
        <Text key={i} as="p" tone="subdued" variant="bodySm">
          {l}
        </Text>
      ))}
    </BlockStack>
  );
}
