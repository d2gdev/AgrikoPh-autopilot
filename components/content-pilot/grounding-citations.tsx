import { Card, BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";
import type { DraftCitation } from "@/lib/content-pilot/generate-draft";

export function citationLabel(c: DraftCitation): string {
  return `${c.title} · ${c.sourceType} · ${c.score.toFixed(2)}`;
}

// "Grounded by" panel for a draft's KB citations. Renders nothing when there
// are no citations, so it is safe to drop into any draft view unconditionally.
export function GroundingCitations({ citations }: { citations?: DraftCitation[] | null }): JSX.Element | null {
  if (!citations || citations.length === 0) return null;
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h3" variant="headingSm">Grounded by Agriko’s own content</Text>
        <BlockStack gap="100">
          {citations.map((c, i) => (
            <InlineStack key={`${c.sourceType}-${i}`} gap="200" align="start" blockAlign="center">
              <Badge tone="info">{c.sourceType}</Badge>
              <Text as="span" variant="bodySm">{c.title}</Text>
              <Text as="span" variant="bodySm" tone="subdued">{c.score.toFixed(2)}</Text>
            </InlineStack>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
