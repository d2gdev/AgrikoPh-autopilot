import { Badge, BlockStack, InlineStack, Text } from "@shopify/polaris";
import type { MapLoadState } from "../map-types";
import { normalizeTopicalMapPriority } from "@/lib/topical-map/priority";
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
  const coveredUrls = new Set(map.clusters.flatMap(cluster => cluster.memberUrls)).size;
  const decisions = Object.entries(map.pages.reduce<Record<string, number>>((counts, page) => { const key = page.decision ?? "unspecified"; counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}));
  const work = [...map.work.internalLinks, ...map.work.redirects, ...map.work.canonicalization, ...map.work.indexation];
  const priorityActions = work.filter(row => normalizeTopicalMapPriority(row.priority) === "high").length;
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
      <Text as="p">{map.blockers.evidence.length} evidence gates</Text><Text as="p">{map.blockers.reviews.length} high-stakes review requirements</Text>
    </InlineStack>
    <section aria-labelledby="map-progress"><BlockStack gap="200"><Text id="map-progress" as="h3" variant="headingMd">Coverage and action families</Text><Text as="p">{map.clusters.length} clusters cover {coveredUrls} distinct URLs. {work.length} technical and link actions are declared, including {priorityActions} high-priority actions.</Text><InlineStack gap="300" wrap>{decisions.map(([decision, count]) => <Badge key={decision}>{`${decision}: ${count}`}</Badge>)}</InlineStack><InlineStack gap="300" wrap><Text as="p">Links {map.work.internalLinks.length}</Text><Text as="p">Redirects {map.work.redirects.length}</Text><Text as="p">Canonical {map.work.canonicalization.length}</Text><Text as="p">Indexation {map.work.indexation.length}</Text></InlineStack></BlockStack></section>
  </BlockStack></div>;
}
