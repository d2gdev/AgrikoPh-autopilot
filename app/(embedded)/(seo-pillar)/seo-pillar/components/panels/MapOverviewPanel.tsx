import { Badge, BlockStack, InlineStack, Text } from "@shopify/polaris";
import type { MapLoadState } from "../map-types";
import styles from "../seo-pilot-responsive.module.css";

const DOMAIN_LABELS = {
  clusters: "Clusters", page_roles: "Page roles", url_intent_ownership: "URL intent ownership",
  content_decisions: "Content decisions", prohibited_content: "Prohibited content", internal_links: "Internal links",
  redirects: "Redirects", canonicalization: "Canonicalization", indexation: "Indexation",
  evidence_gates: "Evidence gates", high_stakes_reviews: "High-stakes reviews",
} as const;

export function MapOverviewPanel({ mapState }: { mapState: MapLoadState }) {
  if (mapState.state !== "ready") return null;
  const map = mapState.commandCenter;
  const total = Object.values(map.domainCounts).reduce((sum, count) => sum + count, 0);
  return <div className={styles.commandCenter}><BlockStack gap="500">
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="center" wrap>
        <Text as="h2" variant="headingLg">Active package</Text><Badge tone="success">Active</Badge>
      </InlineStack>
      <Text as="p" fontWeight="semibold">{map.identity.strategyVersion}</Text>
      <Text as="p" tone="subdued">Package {map.identity.packageSha256.slice(0, 12)} · contract {map.identity.contractRevision} · {total.toLocaleString()} compiled rules</Text>
    </BlockStack>
    <section aria-labelledby="domain-coverage"><BlockStack gap="300">
      <Text id="domain-coverage" as="h3" variant="headingMd">Governance coverage</Text>
      <div className={styles.domainGrid}>{Object.entries(DOMAIN_LABELS).map(([domain, label]) =>
        <div className={styles.domainMetric} key={domain}><Text as="p" variant="bodySm" tone="subdued">{label}</Text><Text as="p" variant="headingMd">{map.domainCounts[domain as keyof typeof map.domainCounts]}</Text><span className={styles.srOnly}>{domain}</span></div>)}</div>
    </BlockStack></section>
    <InlineStack gap="400" wrap>
      <Text as="p">{map.pages.length} governed pages</Text><Text as="p">{map.work.internalLinks.length} internal-link rules</Text>
      <Text as="p">{map.blockers.evidence.length} evidence blockers</Text><Text as="p">{map.blockers.reviews.length} review blockers</Text>
    </InlineStack>
  </BlockStack></div>;
}
