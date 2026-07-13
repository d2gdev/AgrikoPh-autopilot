import { Badge, BlockStack, Button, InlineStack, Text } from "@shopify/polaris";
import type { MapAwareSeoGap } from "@/lib/seo/analysis";
import type { MapAnalysisState, MapLoadState } from "../map-types";
import { Provenance } from "./MapPagesPanel";
import styles from "../seo-pilot-responsive.module.css";

export function ContentGapsPanel({ mapState, analysisState, busy, done, onPropose }: { mapState: MapLoadState; analysisState: MapAnalysisState; busy: Set<string>; done: Set<string>; onPropose: (gap: MapAwareSeoGap) => void }) {
  if (mapState.state === "loading" || analysisState.state === "loading") return <Text as="p">Loading the active topical map…</Text>;
  if (mapState.state === "no_active_strategy" || analysisState.state === "no_active_strategy") return <Text as="p">No active topical map. Activate a validated strategy before creating governed work.</Text>;
  if (mapState.state === "error" || analysisState.state === "error") return <Text as="p" tone="critical">Strategy command center unavailable. No proposal actions are enabled.</Text>;
  if (analysisState.state === "stale") return <Text as="p" tone="caution">Analysis belongs to an earlier strategy. Refresh analysis before creating proposals.</Text>;
  if (analysisState.state === "empty") return <Text as="p" tone="subdued">No map-bound analysis yet. Run AI Analysis to compare current evidence with the active map.</Text>;
  if (mapState.state !== "ready") return null;
  const gaps = analysisState.analysis.gaps.filter(g => g.kind === "content");
  return <div className={styles.commandCenter}><BlockStack gap="400"><BlockStack gap="100"><Text as="h2" variant="headingLg">Content gaps</Text><Text as="p" tone="subdued">Only active-map requirements can become proposals. Each proposal retains strategy identity and rule provenance.</Text></BlockStack>
    {gaps.length === 0 ? <Text as="p" tone="subdued">No governed content gaps remain for the active strategy.</Text> : <div className={styles.compactList}>{gaps.map(gap => { const key = gap.ruleIds.join("|"); return <section className={styles.listRow} key={key}><BlockStack gap="200"><InlineStack align="space-between" wrap><Text as="h3" variant="headingSm">{gap.suggestedTitle}</Text><Badge tone="info">{gap.action === "create" ? "New content" : "Refresh content"}</Badge></InlineStack><Text as="p"><b>Map requirement:</b> {gap.page ?? gap.query}</Text><Text as="p"><b>Priority:</b> {gap.priority}</Text><Text as="p" tone="subdued"><b>Observed evidence:</b> {gap.observedEvidence.length ? gap.observedEvidence.map(item => `${item.query}: ${item.impressions.toLocaleString()} impressions${item.position === null ? "" : `, position ${item.position}`}`).join("; ") : "No matching GSC observation; this candidate is required by the active map."}</Text><InlineStack align="space-between" blockAlign="center" wrap><Provenance ruleIds={gap.ruleIds} map={mapState.commandCenter}/>{done.has(key) ? <Badge tone="success">Proposal created</Badge> : <Button variant="primary" size="slim" loading={busy.has(key)} onClick={() => onPropose(gap)}>Create proposal</Button>}</InlineStack></BlockStack></section>; })}</div>}
  </BlockStack></div>;
}
