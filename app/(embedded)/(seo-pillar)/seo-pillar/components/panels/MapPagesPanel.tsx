import { Badge, BlockStack, InlineStack, Select, Text } from "@shopify/polaris";
import { useMemo, useState } from "react";
import type { TopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { normalizeTopicalMapPriority } from "@/lib/topical-map/priority";
import { priorityTone } from "@/lib/ui/tones";
import styles from "../seo-pilot-responsive.module.css";

function Provenance({ ruleIds, map }: { ruleIds: string[]; map: TopicalMapCommandCenter }) {
  return <details className={styles.disclosure}><summary>Rule provenance ({ruleIds.length})</summary><BlockStack gap="100">
    {ruleIds.map(id => <div key={id} className={styles.breakText}><Text as="p" variant="bodySm"><b>{id}</b> · {map.provenance[id]?.sourceArtifactId ?? "Source unavailable"}</Text><Text as="p" variant="bodySm" tone="subdued">sourceReferences: {map.provenance[id]?.sourceReferences.map(ref => ref.coverageUnitId).join(", ") || "none"}</Text></div>)}
  </BlockStack></details>;
}
export { Provenance };
export function pageMatchesBlockerFilter(pageUrl: string, prohibitedUrls: string[], blocker: string) { const blocked = prohibitedUrls.includes(pageUrl); return blocker === "all" || (blocker === "blocked" ? blocked : !blocked); }
export function pageMatchesPriorityFilter(pagePriority: string | undefined, filter: string) { return filter === "all" || normalizeTopicalMapPriority(pagePriority) === filter; }
export const priorityBadgeTone = priorityTone;

export function MapPagesPanel({ map }: { map: TopicalMapCommandCenter }) {
  const [cluster, setCluster] = useState("all"), [priority, setPriority] = useState("all"), [family, setFamily] = useState("all"), [state, setState] = useState("all"), [blocker, setBlocker] = useState("all");
  const options = (label: string, values: Array<string | undefined>) => [{ label, value: "all" }, ...Array.from(new Set(values.filter(Boolean) as string[])).map(v => ({ label: v, value: v }))];
  const prohibitedUrls = useMemo(() => map.prohibited.map(item => item.url), [map.prohibited]);
  const pages = useMemo(() => map.pages.filter(p => (cluster === "all" || p.cluster === cluster) && pageMatchesPriorityFilter(p.priority, priority) && (family === "all" || Boolean(p.ruleDomains[family as keyof typeof p.ruleDomains]?.length)) && (state === "all" || p.decision === state) && pageMatchesBlockerFilter(p.url, prohibitedUrls, blocker)), [map.pages, prohibitedUrls, cluster, priority, family, state, blocker]);
  return <div className={styles.commandCenter}><BlockStack gap="400">
    <BlockStack gap="100"><Text as="h2" variant="headingLg">Pages &amp; ownership</Text><Text as="p" tone="subdued">Every URL has an explicit role, intent owner, content decision, and traceable rule source.</Text></BlockStack>
    <div className={styles.filterGrid}>
      <Select label="Filter by cluster" options={options("All clusters", map.pages.map(p => p.cluster))} value={cluster} onChange={setCluster}/>
      <Select label="Filter by priority" options={[{label:"All priorities",value:"all"},{label:"High",value:"high"},{label:"Medium",value:"medium"},{label:"Low",value:"low"}]} value={priority} onChange={setPriority}/>
      <Select label="Filter by rule family" options={[{label:"All rule families",value:"all"},{label:"Page role",value:"page_roles"},{label:"Intent owner",value:"url_intent_ownership"},{label:"Content decision",value:"content_decisions"}]} value={family} onChange={setFamily}/>
      <Select label="Filter by state" options={options("All states", map.pages.map(p => p.decision))} value={state} onChange={setState}/>
      <Select label="Filter by blocker" options={[{label:"All blocker states",value:"all"},{label:"Blocked",value:"blocked"},{label:"Clear",value:"clear"}]} value={blocker} onChange={setBlocker}/>
    </div>
    <Text as="p" variant="bodySm" tone="subdued">Showing {pages.length} of {map.pages.length} pages</Text>
    <div className={styles.compactList}>{pages.map(page => <section className={styles.listRow} key={page.url} aria-label={page.url}><BlockStack gap="200">
      <InlineStack align="space-between" wrap><Text as="h3" variant="headingSm">{page.url}</Text><InlineStack gap="100">{map.prohibited.some(item => item.url === page.url) && <Badge tone="critical">Blocked: prohibited content</Badge>}{page.priority && <Badge tone={priorityBadgeTone(page.priority)}>{page.priority}</Badge>}</InlineStack></InlineStack>
      <Text as="p"><b>Map title:</b> {page.title ?? "Not specified"}</Text>
      <Text as="p"><b>Target keyword:</b> {page.primaryKeywordOrTheme ?? "Not specified"}</Text>
      <InlineStack gap="300" wrap><Text as="p"><b>Cluster:</b> {page.cluster ?? "Unassigned"}</Text><Text as="p"><b>Role:</b> {page.role ?? "Unspecified"}</Text><Text as="p"><b>Content kind:</b> {page.contentKind ?? "Unspecified"}</Text><Text as="p"><b>Publishing state:</b> {page.publishingState ?? "Unspecified"}</Text><Text as="p"><b>Rule status:</b> {page.contentDecisionPolicy?.resolutionStatus ?? "Unspecified"}</Text></InlineStack>
      <Text as="p"><b>Decision:</b> {page.decision ?? "Unspecified"}</Text>
      <Text as="p"><b>Evidence:</b> {page.evidence ?? "Not specified"}</Text>
      <Text as="p" tone="subdued">Intent: {page.dominantIntent ?? page.exclusiveIntentScope ?? "Not specified"}</Text>
      {page.contentDecisionPolicy && (page.contentDecisionPolicy.resolutionStatus !== "resolved" || page.contentDecisionPolicy.conditions.length > 0 || page.contentDecisionPolicy.evidenceRequirements.length > 0 || page.contentDecisionPolicy.reviewRequirements.length > 0) ? <details className={styles.disclosure}><summary>Gate requirements</summary><BlockStack gap="100">{[...page.contentDecisionPolicy.conditions, ...page.contentDecisionPolicy.evidenceRequirements, ...page.contentDecisionPolicy.reviewRequirements].map((requirement, index) => <Text as="p" variant="bodySm" key={`${requirement.kind}:${index}`}><b>{requirement.kind.replaceAll("_", " ")}:</b> {requirement.text}</Text>)}{page.contentDecisionPolicy.conditions.length + page.contentDecisionPolicy.evidenceRequirements.length + page.contentDecisionPolicy.reviewRequirements.length === 0 ? <Text as="p" variant="bodySm">The active contract requires a manual gate; use the decision and evidence above for review context.</Text> : null}</BlockStack></details> : null}
      {(page.secondaryVariants || page.exactTargetIfAny) ? <details className={styles.disclosure}><summary>Additional map context</summary><BlockStack gap="100">{page.secondaryVariants ? <Text as="p"><b>Secondary variants:</b> {page.secondaryVariants}</Text> : null}{page.exactTargetIfAny ? <Text as="p"><b>Exact target:</b> {page.exactTargetIfAny}</Text> : null}</BlockStack></details> : null}<Provenance ruleIds={page.ruleIds} map={map}/>
    </BlockStack></section>)}</div>
    {pages.length === 0 && <Text as="p" tone="subdued">No governed pages match these filters.</Text>}
  </BlockStack></div>;
}
