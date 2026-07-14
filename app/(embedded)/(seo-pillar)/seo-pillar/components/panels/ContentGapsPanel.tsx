import { Badge, BlockStack, Button, Checkbox, InlineStack, Text } from "@shopify/polaris";
import type { MapAnalysisState, MapLoadState } from "../map-types";
import { Provenance } from "./MapPagesPanel";
import styles from "../seo-pilot-responsive.module.css";

export function ContentGapsPanel({ mapState, analysisState, selected, done, onToggle, onSelectVisible }: { mapState: MapLoadState; analysisState: MapAnalysisState; selected: Set<string>; done: Set<string>; onToggle: (candidateId: string) => void; onSelectVisible: (candidateIds: string[], select: boolean) => void }) {
  if (mapState.state === "loading" || analysisState.state === "loading") return <Text as="p">Loading the active topical map…</Text>;
  if (mapState.state === "no_active_strategy" || analysisState.state === "no_active_strategy") return <Text as="p">No active topical map. Activate a validated strategy before creating governed work.</Text>;
  if (mapState.state === "error" || analysisState.state === "error") return <Text as="p" tone="critical">Strategy command center unavailable. No proposal actions are enabled.</Text>;
  if (analysisState.state === "strategy_identity_stale") return <Text as="p" tone="caution">Analysis belongs to an earlier strategy. Refresh analysis before creating proposals.</Text>;
  if (analysisState.state === "stale") return <Text as="p" tone="caution">Analysis belongs to an earlier strategy. Refresh analysis before creating proposals.</Text>;
  if (analysisState.state === "evidence_stale") return <Text as="p" tone="caution">Analysis evidence is stale. Refresh analysis before creating proposals.</Text>;
  if (analysisState.state === "observation_unavailable") return <Text as="p" tone="caution">Required store or search observations are unavailable. Refresh source data before creating proposals.</Text>;
  if (analysisState.state === "empty") return <Text as="p" tone="subdued">No map-bound analysis yet. Run AI Analysis to compare current evidence with the active map.</Text>;
  if (mapState.state !== "ready") return null;
  if (!analysisState.analysis) return null;
  const gaps = analysisState.analysis.gaps.filter(g => g.kind === "content");
  const visibleIds = gaps.filter(gap => !done.has(gap.candidateId)).map(gap => gap.candidateId);
  return <div className={styles.commandCenter}><BlockStack gap="400"><BlockStack gap="100"><Text as="h2" variant="headingLg">Content gaps</Text><Text as="p" tone="subdued">Select active-map requirements, then confirm one bounded proposal request. Each proposal retains strategy identity and rule provenance.</Text></BlockStack>
    {visibleIds.length > 0 && <InlineStack gap="200"><Button size="slim" onClick={() => onSelectVisible(visibleIds, true)}>Select all visible</Button><Button size="slim" variant="plain" onClick={() => onSelectVisible(visibleIds, false)}>Clear visible</Button></InlineStack>}
    {gaps.length === 0 ? <Text as="p" tone="subdued">No governed content gaps remain for the active strategy.</Text> : <div className={styles.compactList}>{gaps.map(gap => <section className={styles.listRow} key={gap.candidateId}><BlockStack gap="200"><InlineStack align="space-between" wrap><Text as="h3" variant="headingSm">{gap.suggestedTitle}</Text><Badge tone="info">{gap.action === "create" ? "New content" : "Refresh content"}</Badge></InlineStack><Text as="p"><b>Map requirement:</b> {gap.page ?? gap.query}</Text><Text as="p"><b>Priority:</b> {gap.priority}</Text>{gap.mapEvidence && <Text as="p"><b>Map evidence:</b> {gap.mapEvidence}</Text>}<Text as="p" tone="subdued"><b>Observed evidence:</b> {gap.observedEvidence.length ? gap.observedEvidence.map(item => `${item.query}: ${item.impressions.toLocaleString()} impressions${item.position === null ? "" : `, position ${item.position}`}`).join("; ") : "No matching GSC observation; this candidate is required by the active map."}</Text><InlineStack align="space-between" blockAlign="center" wrap><Provenance ruleIds={gap.ruleIds} map={mapState.commandCenter}/>{done.has(gap.candidateId) ? <Badge tone="success">Proposal created</Badge> : <Checkbox label="Select for proposal" checked={selected.has(gap.candidateId)} onChange={() => onToggle(gap.candidateId)}/>}</InlineStack></BlockStack></section>)}</div>}
  </BlockStack></div>;
}
