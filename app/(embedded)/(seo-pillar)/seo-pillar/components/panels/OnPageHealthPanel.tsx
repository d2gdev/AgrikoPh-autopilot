import { Button, Card, Text, Badge, InlineStack, BlockStack } from "@shopify/polaris";
import { ResponsiveDataTable } from "@/app/(embedded)/components/ResponsiveDataTable";
import type { Health } from "../types";
import { onPageHealthActions } from "../on-page-health-actions";

type OffenderFlags = {
  isPromotedMeta: boolean;
  isPromotingMeta: boolean;
  isPromotedH1: boolean;
  isPromotingH1: boolean;
  isPromotedThin: boolean;
  isPromotingThin: boolean;
};

export function OnPageHealthPanel({
  health,
  offenderFlags,
  onPromote,
  onOpenContentPilot,
}: {
  health: Health | null;
  offenderFlags: Record<string, OffenderFlags>;
  onPromote: (handle: string, title: string, issue: "missing-meta" | "thin-content" | "missing-h1", wordCount?: number) => void;
  onOpenContentPilot: () => void;
}) {
  return (
    <BlockStack gap="400">
      <Text variant="headingMd" as="h2">On-page SEO health (blog articles)</Text>
      {!health ? <Text as="p" tone="subdued">No indexed articles yet. Run blog indexing in Content Pilot.</Text> : (
        <>
          {health.limits?.articlesTruncated && (
            <Text as="p" tone="caution">
              Health checks inspected {health.limits.articlesAnalyzed} of at least {health.limits.articlesTotalLowerBound} articles. A clean subset does not confirm the full corpus is clean.
            </Text>
          )}
          <InlineStack gap="300" wrap>
            {[
              { label: "Articles", val: health.totals.total, tone: undefined as "critical" | "caution" | undefined },
              { label: "Missing meta", val: health.totals.missingMeta, tone: "critical" as const },
              { label: "Thin (<300w)", val: health.totals.thinContent, tone: "caution" as const },
              { label: "No internal links", val: health.totals.noInternalLinks, tone: "caution" as const },
              { label: "Orphans", val: health.totals.orphan, tone: "caution" as const },
              { label: "Missing desc", val: health.totals.missingDesc ?? 0, tone: "critical" as const },
              { label: "Missing H1", val: health.totals.missingH1 ?? 0, tone: "critical" as const },
              { label: "Title length off", val: health.totals.titleLengthOff ?? 0, tone: "caution" as const },
              { label: "Desc length off", val: health.totals.descLengthOff ?? 0, tone: "caution" as const },
              { label: "Duplicate title", val: health.totals.duplicateTitle ?? 0, tone: "caution" as const },
            ].map((c) => (
              <Card key={c.label}>
                <BlockStack gap="100">
                  <Text variant="headingSm" as="h3" tone="subdued">{c.label}</Text>
                  <Text variant="headingXl" as="p" tone={c.tone}>{String(c.val)}</Text>
                </BlockStack>
              </Card>
            ))}
          </InlineStack>
          {health.worstOffenders.length > 0 && (
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm" as="h3">Needs attention</Text>
                <ResponsiveDataTable
                  columnContentTypes={["text", "numeric", "text", "text"]}
                  headings={["Article", "Words", "Issues", "Actions"]}
                  rows={health.worstOffenders.map((a) => {
                    const issueTone = (iss: string): "critical" | "warning" | "info" => {
                      if (["Missing meta title", "Missing meta description", "Missing H1"].includes(iss)) return "critical";
                      if (["Thin content", "Title length off", "Description length off", "Duplicate title"].includes(iss)) return "warning";
                      return "info";
                    };
                    const actions = onPageHealthActions(a.issues);
                    const flags = offenderFlags[a.handle];
                    return [
                      <Button key={a.handle} variant="plain" onClick={onOpenContentPilot}>{a.title}</Button>,
                      String(a.wordCount),
                      <InlineStack key={`issues-${a.handle}`} gap="100" wrap>
                        {a.issues.map((iss) => (
                          <Badge key={iss} tone={issueTone(iss)}>{iss}</Badge>
                        ))}
                      </InlineStack>,
                      <InlineStack key={`actions-${a.handle}`} gap="100" wrap>
                        {actions.meta && (
                          flags?.isPromotedMeta
                            ? <Badge key={`${a.handle}:missing-meta`} tone="success">Meta queued</Badge>
                            : <Button key={`fix-meta-${a.handle}`} size="slim" loading={flags?.isPromotingMeta} onClick={() => onPromote(a.handle, a.title, "missing-meta", a.wordCount)}>Fix Meta</Button>
                        )}
                        {actions.h1 && (
                          flags?.isPromotedH1
                            ? <Badge key={`${a.handle}:missing-h1`} tone="success">H1 queued</Badge>
                            : <Button key={`fix-h1-${a.handle}`} size="slim" loading={flags?.isPromotingH1} onClick={() => onPromote(a.handle, a.title, "missing-h1", a.wordCount)}>Fix H1</Button>
                        )}
                        {actions.thin && (
                          flags?.isPromotedThin
                            ? <Badge key={`${a.handle}:thin-content`} tone="success">Expand queued</Badge>
                            : <Button key={`expand-${a.handle}`} size="slim" loading={flags?.isPromotingThin} onClick={() => onPromote(a.handle, a.title, "thin-content", a.wordCount)}>Expand</Button>
                        )}
                        {actions.manual && <Badge key={`manual-${a.handle}`} tone="info">Manual review</Badge>}
                      </InlineStack>,
                    ];
                  })}
                />
              </BlockStack>
            </Card>
          )}
        </>
      )}
    </BlockStack>
  );
}
