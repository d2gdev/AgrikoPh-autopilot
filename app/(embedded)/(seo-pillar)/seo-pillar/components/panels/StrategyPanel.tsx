import { Text, Card, Badge, InlineStack, BlockStack, Button } from "@shopify/polaris";
import { ResponsiveDataTable } from "@/app/(embedded)/components/ResponsiveDataTable";
import { KEYWORD_CLUSTERS, PRIMARY_TARGETS, SECONDARY_BANK, ROADMAP, ALL_PRIMARY_KEYWORDS, type PrimaryTarget } from "@/lib/seo/keyword-strategy";

export function StrategyPanel({
  trackingAll,
  trackAllPrimary,
  trackedKw,
  trackingKw,
  trackKeyword,
  plannedKw,
  planningKw,
  planTarget,
}: {
  trackingAll: boolean;
  trackAllPrimary: () => void;
  trackedKw: Set<string>;
  trackingKw: Set<string>;
  trackKeyword: (keyword: string) => void;
  plannedKw: Set<string>;
  planningKw: Set<string>;
  planTarget: (key: string, topic: string, brief: string) => void;
}) {
  return (
    <BlockStack gap="500">
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <Text variant="headingMd" as="h2">Keyword strategy</Text>
          <Button
            variant="primary"
            size="slim"
            loading={trackingAll}
            onClick={trackAllPrimary}
          >
            {`Track all ${ALL_PRIMARY_KEYWORDS.length} primary`}
          </Button>
        </InlineStack>
        <Text as="p" tone="subdued">
          From the June 2026 keyword research report. Volume/difficulty are analyst proxy bands — Track a keyword to replace them with real GSC data, or Plan it to create the right Content Pilot proposal.
        </Text>
      </BlockStack>

      {/* Clusters */}
      <BlockStack gap="300">
        <Text variant="headingSm" as="h3">Clusters</Text>
        {KEYWORD_CLUSTERS.map((c) => (
          <Card key={c.id}>
            <BlockStack gap="150">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <Text variant="headingSm" as="h4">{c.name}</Text>
                <Text as="span" tone="subdued" variant="bodySm">{c.intent}</Text>
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">{c.why}</Text>
              <InlineStack gap="150" wrap>
                {c.coreKeywords.map((k) => <Badge key={k}>{k}</Badge>)}
              </InlineStack>
            </BlockStack>
          </Card>
        ))}
      </BlockStack>

      {/* Primary targets */}
      <BlockStack gap="200">
        <Text variant="headingSm" as="h3">Primary targets</Text>
        <ResponsiveDataTable
          columnContentTypes={["text", "text", "text", "text", "text", "text"]}
          headings={["Keyword", "Volume", "Difficulty", "Recommended page", "Priority", "Actions"]}
          rows={PRIMARY_TARGETS.map((t: PrimaryTarget) => {
            const rec = `Build a ${t.pageType} targeting the keyword "${t.keyword}" (${t.intent.toLowerCase()} intent, ${KEYWORD_CLUSTERS.find((c) => c.id === t.cluster)?.name ?? t.cluster} cluster).`;
            return [
              <Text key={`k-${t.keyword}`} as="span" fontWeight="semibold">{t.keyword}</Text>,
              t.volumeBand,
              t.difficulty,
              t.pageType,
              <Badge key={`p-${t.keyword}`} tone={t.priority === "Very high" ? "success" : t.priority === "High" ? "info" : undefined}>{t.priority}</Badge>,
              <InlineStack key={`a-${t.keyword}`} gap="200" wrap>
                {trackedKw.has(t.keyword)
                  ? <Badge tone="success">Tracking</Badge>
                  : <Button size="slim" loading={trackingKw.has(t.keyword)} onClick={() => trackKeyword(t.keyword)}>Track</Button>}
                {plannedKw.has(t.keyword)
                  ? <Badge tone="success">Planned</Badge>
                  : <Button size="slim" loading={planningKw.has(t.keyword)} onClick={() => planTarget(t.keyword, t.keyword, rec)}>Plan it</Button>}
              </InlineStack>,
            ];
          })}
        />
      </BlockStack>

      {/* Six-month roadmap */}
      <BlockStack gap="200">
        <Text variant="headingSm" as="h3">Six-month roadmap</Text>
        <ResponsiveDataTable
          columnContentTypes={["text", "text", "text", "text", "text"]}
          headings={["Month", "Title", "Target keyword", "Format", "Action"]}
          rows={ROADMAP.map((r) => {
            const key = `rm:${r.title}`;
            const rec = `${r.format}: "${r.title}" targeting "${r.targetKeyword}" (${r.intent.toLowerCase()} intent). Internally link to ${r.primaryLinkTarget}.`;
            return [
              r.month,
              r.title,
              r.targetKeyword,
              r.format,
              plannedKw.has(key)
                ? <Badge key={`rb-${key}`} tone="success">Planned</Badge>
                : <Button key={`ra-${key}`} size="slim" loading={planningKw.has(key)} onClick={() => planTarget(key, r.targetKeyword, rec)}>Plan it</Button>,
            ];
          })}
        />
      </BlockStack>

      {/* Secondary bank */}
      <BlockStack gap="200">
        <Text variant="headingSm" as="h3">{`Secondary bank (${SECONDARY_BANK.length})`}</Text>
        <ResponsiveDataTable
          columnContentTypes={["text", "text", "text", "text", "text"]}
          headings={["Keyword", "Intent", "Volume", "Suggested page", "Action"]}
          rows={SECONDARY_BANK.map((s) => [
            s.keyword,
            s.intent,
            s.volumeBand,
            s.targetPage,
            trackedKw.has(s.keyword)
              ? <Badge key={`sb-${s.keyword}`} tone="success">Tracking</Badge>
              : <Button key={`sa-${s.keyword}`} size="slim" loading={trackingKw.has(s.keyword)} onClick={() => trackKeyword(s.keyword)}>Track</Button>,
          ])}
        />
      </BlockStack>
    </BlockStack>
  );
}
