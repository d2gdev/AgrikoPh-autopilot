import { Badge, BlockStack, InlineStack, Select, Text } from "@shopify/polaris";
import { useMemo, useState } from "react";
import type { TopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import styles from "../seo-pilot-responsive.module.css";

function Provenance({ ruleIds, map }: { ruleIds: string[]; map: TopicalMapCommandCenter }) {
  return <details className={styles.disclosure}><summary>Rule provenance ({ruleIds.length})</summary><BlockStack gap="100">
    {ruleIds.map(id => <div key={id} className={styles.breakText}><Text as="p" variant="bodySm"><b>{id}</b> · {map.provenance[id]?.sourceArtifactId ?? "Source unavailable"}</Text><Text as="p" variant="bodySm" tone="subdued">sourceReferences: {map.provenance[id]?.sourceReferences.map(ref => ref.coverageUnitId).join(", ") || "none"}</Text></div>)}
  </BlockStack></details>;
}
export { Provenance };
export function pageMatchesBlockerFilter(pageUrl: string, prohibitedUrls: string[], blocker: string) { const blocked = prohibitedUrls.includes(pageUrl); return blocker === "all" || (blocker === "blocked" ? blocked : !blocked); }

export function MapPagesPanel({ map }: { map: TopicalMapCommandCenter }) {
  const [cluster, setCluster] = useState("all"), [priority, setPriority] = useState("all"), [family, setFamily] = useState("all"), [state, setState] = useState("all"), [blocker, setBlocker] = useState("all");
  const options = (label: string, values: Array<string | undefined>) => [{ label, value: "all" }, ...Array.from(new Set(values.filter(Boolean) as string[])).map(v => ({ label: v, value: v }))];
  const prohibitedUrls = useMemo(() => map.prohibited.map(item => item.url), [map.prohibited]);
  const pages = useMemo(() => map.pages.filter(p => (cluster === "all" || p.cluster === cluster) && (priority === "all" || p.priority === priority) && (family === "all" || Boolean(p.ruleDomains[family as keyof typeof p.ruleDomains]?.length)) && (state === "all" || p.decision === state) && pageMatchesBlockerFilter(p.url, prohibitedUrls, blocker)), [map.pages, prohibitedUrls, cluster, priority, family, state, blocker]);
  return <div className={styles.commandCenter}><BlockStack gap="400">
    <BlockStack gap="100"><Text as="h2" variant="headingLg">Pages &amp; ownership</Text><Text as="p" tone="subdued">Every URL has an explicit role, intent owner, content decision, and traceable rule source.</Text></BlockStack>
    <div className={styles.filterGrid}>
      <Select label="Filter by cluster" options={options("All clusters", map.pages.map(p => p.cluster))} value={cluster} onChange={setCluster}/>
      <Select label="Filter by priority" options={options("All priorities", map.pages.map(p => p.priority))} value={priority} onChange={setPriority}/>
      <Select label="Filter by rule family" options={[{label:"All rule families",value:"all"},{label:"Page role",value:"page_roles"},{label:"Intent owner",value:"url_intent_ownership"},{label:"Content decision",value:"content_decisions"}]} value={family} onChange={setFamily}/>
      <Select label="Filter by state" options={options("All states", map.pages.map(p => p.decision))} value={state} onChange={setState}/>
      <Select label="Filter by blocker" options={[{label:"All blocker states",value:"all"},{label:"Blocked",value:"blocked"},{label:"Clear",value:"clear"}]} value={blocker} onChange={setBlocker}/>
    </div>
    <Text as="p" variant="bodySm" tone="subdued">Showing {pages.length} of {map.pages.length} pages</Text>
    <div className={styles.compactList}>{pages.map(page => <section className={styles.listRow} key={page.url} aria-label={page.url}><BlockStack gap="200">
      <InlineStack align="space-between" wrap><Text as="h3" variant="headingSm">{page.url}</Text><InlineStack gap="100">{map.prohibited.some(item => item.url === page.url) && <Badge tone="critical">Blocked: prohibited content</Badge>}{page.priority && <Badge>{page.priority}</Badge>}</InlineStack></InlineStack>
      <InlineStack gap="300" wrap><Text as="p"><b>Cluster:</b> {page.cluster ?? "Unassigned"}</Text><Text as="p"><b>Role:</b> {page.role ?? "Unspecified"}</Text><Text as="p"><b>State:</b> {page.decision ?? "Unspecified"}</Text></InlineStack>
      <Text as="p" tone="subdued">Intent: {page.dominantIntent ?? page.exclusiveIntentScope ?? "Not specified"}</Text><Provenance ruleIds={page.ruleIds} map={map}/>
    </BlockStack></section>)}</div>
    {pages.length === 0 && <Text as="p" tone="subdued">No governed pages match these filters.</Text>}
  </BlockStack></div>;
}
