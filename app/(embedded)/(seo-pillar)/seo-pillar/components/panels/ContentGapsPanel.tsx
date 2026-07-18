import {
  Badge,
  BlockStack,
  Button,
  Checkbox,
  InlineStack,
  Text,
} from "@shopify/polaris";
import type { MapAnalysisState, MapLoadState } from "../map-types";
import { priorityTone } from "@/lib/ui/tones";
import { Provenance } from "./MapPagesPanel";
import { topicalMapActionEligibility } from "@/lib/topical-map/action-eligibility";
import { groupContentGateSuppressions } from "@/lib/seo/group-content-gates";
import styles from "../seo-pilot-responsive.module.css";

export function ContentGapsPanel({
  mapState,
  analysisState,
  selected,
  done,
  onToggle,
  onSelectVisible,
}: {
  mapState: MapLoadState;
  analysisState: MapAnalysisState;
  selected: Set<string>;
  done: Set<string>;
  onToggle: (candidateId: string) => void;
  onSelectVisible: (candidateIds: string[], select: boolean) => void;
}) {
  if (mapState.state === "loading" || analysisState.state === "loading")
    return <Text as="p">Loading the active topical map…</Text>;
  if (
    mapState.state === "no_active_strategy" ||
    analysisState.state === "no_active_strategy"
  )
    return (
      <Text as="p">
        No active topical map. Activate a validated strategy before creating
        governed work.
      </Text>
    );
  if (mapState.state === "error" || analysisState.state === "error")
    return (
      <Text as="p" tone="critical">
        Strategy command center unavailable. No proposal actions are enabled.
      </Text>
    );
  if (analysisState.state === "strategy_identity_stale")
    return (
      <Text as="p" tone="caution">
        Analysis belongs to an earlier strategy. Refresh analysis before
        creating proposals.
      </Text>
    );
  if (analysisState.state === "stale")
    return (
      <Text as="p" tone="caution">
        Analysis belongs to an earlier strategy. Refresh analysis before
        creating proposals.
      </Text>
    );
  if (analysisState.state === "evidence_stale")
    return (
      <Text as="p" tone="caution">
        Analysis evidence is stale. Refresh analysis before creating proposals.
      </Text>
    );
  if (analysisState.state === "observation_unavailable")
    return (
      <Text as="p" tone="caution">
        Required store or search observations are unavailable. Refresh source
        data before creating proposals.
      </Text>
    );
  if (analysisState.state === "empty")
    return (
      <Text as="p" tone="subdued">
        No map-bound analysis yet. Run AI Analysis to compare current evidence
        with the active map.
      </Text>
    );
  if (mapState.state !== "ready") return null;
  if (!analysisState.analysis) return null;
  const gaps = analysisState.analysis.gaps.filter(
    (g) => g.kind === "content" && g.action === "create",
  );
  const governedPage = (url?: string) =>
    mapState.commandCenter.pages.find((page) => page.url === url);
  const actionable = (url?: string) => {
    const policy = governedPage(url)?.contentDecisionPolicy;
    return Boolean(policy && topicalMapActionEligibility(policy).actionable);
  };
  const visibleIds = gaps
    .filter((gap) => actionable(gap.page) && !done.has(gap.candidateId))
    .map((gap) => gap.candidateId);
  const gatedPages = groupContentGateSuppressions(analysisState.analysis.suppressed)
    .filter((suppression) =>
      suppression.observation?.provenance.startsWith("ArticleRecord:absence:"),
    )
    .flatMap((suppression) => {
      const page = governedPage(suppression.page);
      return page?.contentDecisionPolicy ? [{ page, suppression }] : [];
    });
  const gateLabel = (reason: string) =>
    reason === "manual_gate"
      ? "Manual gate"
      : reason === "activation_blocking"
        ? "Activation blocking"
        : "Condition evidence required";
  return (
    <div className={styles.commandCenter}>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingLg">
            Content gaps
          </Text>
          <Text as="p" tone="subdued">
            Select active-map requirements, then confirm one bounded proposal
            request. Each proposal retains strategy identity and rule
            provenance.
          </Text>
        </BlockStack>
        {visibleIds.length > 0 && (
          <InlineStack gap="200">
            <Button
              size="slim"
              onClick={() => onSelectVisible(visibleIds, true)}
            >
              Select all visible
            </Button>
            <Button
              size="slim"
              variant="plain"
              onClick={() => onSelectVisible(visibleIds, false)}
            >
              Clear visible
            </Button>
          </InlineStack>
        )}
        {gaps.length === 0 && gatedPages.length === 0 ? (
          <Text as="p" tone="subdued">
            No governed content gaps remain for the active strategy.
          </Text>
        ) : (
          <div className={styles.compactList}>
            {gaps.map((gap) => {
              const page = governedPage(gap.page);
              const eligible = actionable(gap.page);
              return (
                <section className={styles.listRow} key={gap.candidateId}>
                  <BlockStack gap="200">
                    <InlineStack align="space-between" wrap>
                      <Text as="h3" variant="headingSm">
                        {page?.title ?? gap.suggestedTitle}
                      </Text>
                      <InlineStack gap="100">
                        <Badge tone={priorityTone(gap.priority)}>
                          {gap.priority}
                        </Badge>
                        <Badge tone="info">
                          {gap.action === "create"
                            ? "New content"
                            : "Refresh content"}
                        </Badge>
                        <Badge tone={eligible ? "info" : "attention"}>
                          {eligible
                            ? "Policy resolved · work pending"
                            : page?.contentDecisionPolicy?.resolutionStatus ?? "Policy unavailable"}
                        </Badge>
                      </InlineStack>
                    </InlineStack>
                    <Text as="p">
                      <b>Target keyword:</b>{" "}
                      {page?.primaryKeywordOrTheme ?? gap.query}
                    </Text>
                    <Text as="p">
                      <b>Governed target URL:</b> {gap.page ?? "Unavailable"}
                    </Text>
                    {gap.currentArticleTitle ? (
                      <Text as="p">
                        <b>Current Shopify title:</b> {gap.currentArticleTitle}
                      </Text>
                    ) : null}
                    <Text as="p">
                      <b>Decision:</b> {page?.decision ?? "Unavailable"}
                    </Text>
                    {gap.mapEvidence && (
                      <Text as="p">
                        <b>Map evidence:</b> {gap.mapEvidence}
                      </Text>
                    )}
                    <Text as="p" tone="subdued">
                      <b>Observation evidence:</b>{" "}
                      {gap.observedEvidence.length
                        ? gap.observedEvidence
                            .map(
                              (item) =>
                                `${item.query}: ${item.impressions.toLocaleString()} impressions${item.position === null ? "" : `, position ${item.position}`}`,
                            )
                            .join("; ")
                        : `${gap.observation.provenance} captured ${gap.observation.capturedAt}`}
                    </Text>
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <Provenance
                        ruleIds={gap.ruleIds}
                        map={mapState.commandCenter}
                      />
                      {done.has(gap.candidateId) ? (
                        <Badge tone="success">Proposal created</Badge>
                      ) : eligible ? (
                        <Checkbox
                          label="Select for proposal"
                          checked={selected.has(gap.candidateId)}
                          onChange={() => onToggle(gap.candidateId)}
                        />
                      ) : (
                        <Badge tone="attention">
                          Gate or manual review required
                        </Badge>
                      )}
                    </InlineStack>
                  </BlockStack>
                </section>
              );
            })}
            {gatedPages.map(({ page, suppression }) => (
              <section
                className={styles.listRow}
                key={`gate:${suppression.page}`}
              >
                <BlockStack gap="200">
                  <InlineStack align="space-between" wrap>
                    <Text as="h3" variant="headingSm">
                      {page.title ?? page.url}
                    </Text>
                    <InlineStack gap="100">
                      {page.priority ? (
                        <Badge tone={priorityTone(page.priority)}>
                          {page.priority}
                        </Badge>
                      ) : null}
                      {suppression.reasons.map((reason) => <Badge key={reason} tone="attention">{gateLabel(reason)}</Badge>)}
                    </InlineStack>
                  </InlineStack>
                  <Text as="p">
                    <b>Target keyword:</b>{" "}
                    {page.primaryKeywordOrTheme ?? "Not specified"}
                  </Text>
                  <Text as="p">
                    <b>Governed target URL:</b> {page.url}
                  </Text>
                  {suppression.currentArticleTitle ? (
                    <Text as="p">
                      <b>Current Shopify title:</b>{" "}
                      {suppression.currentArticleTitle}
                    </Text>
                  ) : null}
                  <Text as="p">
                    <b>Decision:</b> {page.decision ?? "Not specified"}
                  </Text>
                  <Text as="p">
                    <b>Map evidence:</b> {page.evidence ?? "Not specified"}
                  </Text>
                  <Text as="p" tone="subdued">
                    <b>Observation evidence:</b>{" "}
                    {suppression.observation
                      ? `${suppression.observation.provenance} captured ${suppression.observation.capturedAt}`
                      : "Unavailable"}
                  </Text>
                  <Text as="p" tone="caution">
                    <b>Action unavailable:</b> {suppression.reasons.map(gateLabel).join("; ")};
                    no proposal or mutation is permitted.
                  </Text>
                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <Provenance
                      ruleIds={suppression.ruleIds}
                      map={mapState.commandCenter}
                    />
                    <Badge tone="attention">
                      Gate or manual review required
                    </Badge>
                  </InlineStack>
                </BlockStack>
              </section>
            ))}
          </div>
        )}
      </BlockStack>
    </div>
  );
}
