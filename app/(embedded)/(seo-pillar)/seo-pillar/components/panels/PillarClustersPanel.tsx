import { Text, BlockStack, DataTable, Badge } from "@shopify/polaris";
import type { Cluster } from "../types";

export function PillarClustersPanel({ clusters }: { clusters: Cluster[] }) {
  return (
    <BlockStack gap="400">
      <Text variant="headingMd" as="h2">Pillar / topic-cluster gaps</Text>
      <Text as="p" tone="subdued">Clusters with high gap scores have the least supporting content — strong candidates for new articles and pillar pages.</Text>
      {clusters.length === 0 ? <Text as="p" tone="subdued">No cluster data. Index blog content in Content Pilot.</Text> : (
        <DataTable
          columnContentTypes={["text", "numeric", "numeric", "text"]}
          headings={["Topic", "Articles", "Keywords", "Gap score"]}
          rows={clusters.map((c, i) => [
            c.topic,
            String(c.articleCount ?? 0),
            String(c.keywordCount ?? 0),
            <Badge key={`${c.topic}-${i}`} tone={c.gapScore >= 80 ? "critical" : c.gapScore >= 40 ? "warning" : "success"}>{String(c.gapScore)}</Badge>,
          ])}
        />
      )}
    </BlockStack>
  );
}
