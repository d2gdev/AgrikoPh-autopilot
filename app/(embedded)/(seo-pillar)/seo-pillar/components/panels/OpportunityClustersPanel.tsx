import { Text, Card, Badge, InlineStack, BlockStack, DataTable, Button } from "@shopify/polaris";
import type { OpportunityCluster } from "../types";

export function OpportunityClustersPanel({
  clusters,
  pagePath,
}: {
  clusters: OpportunityCluster[];
  pagePath: (p: string | null | undefined) => string;
}) {
  return (
    <BlockStack gap="400">
      <Text variant="headingMd" as="h2">Opportunity clusters</Text>
      <Text as="p" tone="subdued">Near-duplicate queries grouped into a single action. Tackle the highest-scoring cluster first — one title/meta rewrite can lift the whole group.</Text>
      {clusters.length === 0 ? (
        <Text as="p" tone="subdued">No opportunity clusters yet. Fetch fresh GSC data first.</Text>
      ) : (
        clusters.map((c) => (
          <Card key={c.id}>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <Text variant="headingSm" as="h3">{c.label}</Text>
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="info">{`${c.opportunities.length} quer${c.opportunities.length === 1 ? "y" : "ies"}`}</Badge>
                  <Badge tone="success">{`+${c.totalPotentialClicks} potential`}</Badge>
                </InlineStack>
              </InlineStack>
              {c.page
                ? <Button variant="plain" url={c.page} external>{pagePath(c.page)}</Button>
                : <Text as="span" tone="subdued" variant="bodySm">No mapped landing page</Text>}
              <details>
                <summary style={{ cursor: "pointer" }}>
                  <Text as="span" tone="subdued" variant="bodySm">Show member queries</Text>
                </summary>
                <div style={{ marginTop: "var(--p-space-200)" }}>
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                    headings={["Query", "Impr.", "Position", "Potential"]}
                    rows={c.opportunities.map((o, i) => [
                      o.query,
                      o.impressions.toLocaleString(),
                      o.position.toFixed(1),
                      <Text key={`oc-${c.id}-${o.query}-${i}`} as="span" fontWeight="semibold">+{o.potentialClicks}</Text>,
                    ])}
                  />
                </div>
              </details>
            </BlockStack>
          </Card>
        ))
      )}
    </BlockStack>
  );
}
