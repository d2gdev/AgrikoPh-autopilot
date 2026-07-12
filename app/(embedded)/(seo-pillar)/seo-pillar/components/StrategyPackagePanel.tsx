import { Banner, Badge, BlockStack, Card, Divider, InlineStack, List, Text } from "@shopify/polaris";
import type { StrategyPackageOverview } from "./types";

export type { StrategyPackageOverview } from "./types";

const lifecycleTone = (lifecycle: string): "success" | "warning" | "critical" | undefined => {
  if (lifecycle === "active") return "success";
  if (lifecycle === "rejected") return "critical";
  if (lifecycle === "validated" || lifecycle === "superseded" || lifecycle === "rolled_back") return "warning";
  return undefined;
};

function lifecycleLabel(lifecycle: string) {
  return lifecycle.replaceAll("_", " ");
}

export function StrategyPackagePanel({ strategy }: { strategy: StrategyPackageOverview }) {
  if (strategy.state === "loading") return <InlineStack gap="200"><Text as="span">Loading strategy governance…</Text></InlineStack>;
  if (strategy.state === "unavailable") return <Banner tone="warning" title="Strategy governance unavailable"><p>{strategy.message ?? "Strategy governance data is unavailable."}</p></Banner>;
  if (strategy.state === "empty") return <Banner tone="info" title="No imported strategy package"><p>No topical-map strategy package is available for inspection.</p></Banner>;

  const partial = strategy.state === "partial";
  return (
    <BlockStack gap="400">
      {partial && <Banner tone="warning" title="Strategy governance partially loaded"><p>{strategy.message ?? "Some strategy governance data could not be loaded."} Displayed package details are retained and must not be treated as complete.</p></Banner>}
      <InlineStack align="space-between" blockAlign="center" wrap>
        <Text variant="headingMd" as="h2">Topical-map strategy governance</Text>
        <Text as="span" tone="subdued" variant="bodySm">Read-only observability</Text>
      </InlineStack>
      {(strategy.packages ?? []).map((pkg) => {
        const active = strategy.activeVersionId === pkg.id || pkg.lifecycle === "active";
        const stale = pkg.evidenceGates.some((gate) => gate.status === "stale");
        return <Card key={pkg.id}>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <BlockStack gap="050">
                <Text variant="headingSm" as="h3">{active ? "Active strategy package" : "Inactive strategy package"}</Text>
                <Text as="p">{pkg.packageId} · version {pkg.strategyVersion}</Text>
              </BlockStack>
              <InlineStack gap="100" wrap>
                <Badge tone={lifecycleTone(pkg.lifecycle)}>{lifecycleLabel(pkg.lifecycle)}</Badge>
                <Badge tone={pkg.validationStatus === "valid" ? "success" : "warning"}>{pkg.validationStatus.replaceAll("_", " ")}</Badge>
              </InlineStack>
            </InlineStack>
            {stale && <Banner tone="warning" title="Stale mandatory evidence"><p>Mandatory evidence freshness blocks activation eligibility until the listed gates are current.</p></Banner>}
            <InlineStack gap="400" wrap>
              <Text as="span" variant="bodySm">Identity: <Text as="span" fontWeight="semibold">{pkg.packageSha256.slice(0, 12)}</Text></Text>
              <Text as="span" variant="bodySm">Evidence date: {new Date(pkg.evidenceDate).toISOString().slice(0, 10)}</Text>
              <Text as="span" variant="bodySm">Compiled rules: {pkg.compiledRuleCount}</Text>
            </InlineStack>
            <Divider />
            <BlockStack gap="150">
              <Text variant="headingSm" as="h4">Mandatory freshness gates</Text>
              {pkg.evidenceGates.length ? <List>{pkg.evidenceGates.map((gate) => <List.Item key={gate.gateId}>{gate.gateId} · {gate.status} · {gate.maxAgeDays}-day limit{gate.ageDays === null ? "" : ` · ${gate.ageDays} days old`}{gate.blockingReason ? ` · ${gate.blockingReason}` : ""}</List.Item>)}</List> : <Text as="p" tone="subdued">No persisted mandatory freshness gates.</Text>}
            </BlockStack>
            <BlockStack gap="150">
              <Text variant="headingSm" as="h4">Validation issues</Text>
              {pkg.validationIssues.length ? <List>{pkg.validationIssues.map((issue, index) => <List.Item key={`${issue.code}-${index}`}>{issue.code}{issue.ruleId ? ` · ${issue.ruleId}` : ""}{issue.sourceArtifactId ? ` · ${issue.sourceArtifactId}` : ""}{issue.blocking ? " · blocking" : ""}</List.Item>)}</List> : <Text as="p" tone="subdued">No persisted validation issues.</Text>}
            </BlockStack>
            <BlockStack gap="150">
              <Text variant="headingSm" as="h4">Bounded compliance evidence</Text>
              <InlineStack gap="200" wrap>{Object.entries(pkg.compliance.counts).map(([result, count]) => <Badge key={result}>{`${result}: ${count}`}</Badge>)}</InlineStack>
              {pkg.compliance.recent.length ? <List>{pkg.compliance.recent.map((entry, index) => <List.Item key={`${entry.result}-${index}`}>{entry.result} · rules: {entry.matchedRuleIds.join(", ") || "none"} · gates: {entry.evidenceGates.join(", ") || "none"} · sources: {entry.sourceArtifactIds.join(", ") || "none"}</List.Item>)}</List> : <Text as="p" tone="subdued">No bounded compliance records.</Text>}
            </BlockStack>
            <BlockStack gap="150">
              <Text variant="headingSm" as="h4">Lifecycle controls</Text>
              <Banner tone="warning" title="Activation unavailable"><p>{pkg.lifecycleControls.reason}</p></Banner>
            </BlockStack>
            <BlockStack gap="150">
              <Text variant="headingSm" as="h4">Activation and rollback audit history</Text>
              {pkg.auditTimeline.length ? <List>{pkg.auditTimeline.map((event, index) => <List.Item key={`${event.action}-${index}`}>{event.action} · {new Date(event.occurredAt).toISOString().slice(0, 10)}{event.actor ? ` · ${event.actor}` : ""}{event.reason ? ` · ${event.reason}` : ""}</List.Item>)}</List> : <Text as="p" tone="subdued">No activation or rollback audit entries.</Text>}
            </BlockStack>
          </BlockStack>
        </Card>;
      })}
    </BlockStack>
  );
}
