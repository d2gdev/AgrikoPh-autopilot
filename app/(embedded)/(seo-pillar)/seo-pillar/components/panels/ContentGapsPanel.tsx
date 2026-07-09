import { Button, Text, Badge, InlineStack, BlockStack, DataTable } from "@shopify/polaris";
import { timeAgo } from "@/lib/format";
import { contentGapReason } from "../content-gap-reason";
import { gapKey } from "../types";
import type { Analysis, ContentGap } from "../types";

type Flag = { isPromoted: boolean; isPromoting: boolean };
type PlanFlag = { isPlanned: boolean; isPlanning: boolean };

export function ContentGapsPanel({
  gaps,
  gapFlags,
  unpromotedCount,
  anyPromoting,
  onPromoteAll,
  onPromoteGap,
  analysis,
  analysisAt,
  quickWinFlags,
  onPlanQuickWin,
  recFlags,
  onPlanRecommendation,
  onOpenContentPilot,
}: {
  gaps: ContentGap[];
  gapFlags: Flag[];
  unpromotedCount: number;
  anyPromoting: boolean;
  onPromoteAll: () => void;
  onPromoteGap: (gap: ContentGap) => void;
  analysis: Analysis | null;
  analysisAt: string | null;
  quickWinFlags: PlanFlag[];
  onPlanQuickWin: (index: number, text: string) => void;
  recFlags: PlanFlag[];
  onPlanRecommendation: (index: number, text: string) => void;
  onOpenContentPilot: () => void;
}) {
  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <Text variant="headingMd" as="h2">AI content-gap analysis</Text>
        {gaps.length > 0 && (
          <Button variant="primary" loading={anyPromoting} disabled={unpromotedCount === 0}
            onClick={onPromoteAll}>
            {`Create ${unpromotedCount} draft${unpromotedCount === 1 ? "" : "s"}`}
          </Button>
        )}
      </InlineStack>
      {!analysis ? (
        <Text as="p" tone="subdued">No analysis yet. Click <b>AI Analysis</b> (top-right) to generate one from your latest GSC data.</Text>
      ) : (
        <>
          {analysisAt && <Text as="p" tone="subdued" variant="bodySm">Generated {timeAgo(analysisAt)}</Text>}
          {analysis.summary && <Text as="p">{analysis.summary}</Text>}
          {(analysis.quickWins ?? []).length > 0 && (
            <BlockStack gap="100">
              <Text variant="headingSm" as="h3">Quick wins</Text>
              {analysis.quickWins!.map((w, i) => (
                <InlineStack key={i} gap="200" align="space-between" blockAlign="start" wrap={false}>
                  <BlockStack gap="050">
                    <Text as="p">• {w}</Text>
                    {analysis.quickWinEvidence?.[i] && (
                      <Text as="p" tone="subdued" variant="bodySm">{analysis.quickWinEvidence[i]}</Text>
                    )}
                  </BlockStack>
                  {quickWinFlags[i]?.isPlanned
                    ? <Badge tone="success">Planned</Badge>
                    : <Button size="slim" loading={quickWinFlags[i]?.isPlanning} onClick={() => onPlanQuickWin(i, w)}>Plan it</Button>}
                </InlineStack>
              ))}
            </BlockStack>
          )}
          {gaps.length > 0 && (
            <BlockStack gap="200">
              <Text variant="headingSm" as="h3">Content gaps → draft proposals</Text>
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "text", "text", "text"]}
                headings={["Query", "Impr.", "Position", "Reason", "Suggested title", "Action"]}
                rows={gaps.map((g, i) => [
                  g.query,
                  Number(g.impressions ?? 0).toLocaleString(),
                  Number(g.position ?? 0).toFixed(1),
                  contentGapReason(g),
                  g.suggestedTitle,
                  gapFlags[i]?.isPromoted
                    ? <Badge key={`${gapKey(g)}-${i}`} tone="success">Created</Badge>
                    : <Button key={`${gapKey(g)}-${i}`} size="slim" loading={gapFlags[i]?.isPromoting} onClick={() => onPromoteGap(g)}>Create draft</Button>,
                ])}
              />
              <InlineStack>
                <Button variant="plain" onClick={onOpenContentPilot}>Open Content Pilot to review &amp; publish drafts →</Button>
              </InlineStack>
            </BlockStack>
          )}
          {gaps.length === 0 && (
            <Text as="p" tone="subdued">
              No actionable content gaps remain. Existing, rejected, published, and already handled ideas are filtered out of this queue.
            </Text>
          )}
          {(analysis.recommendations ?? []).length > 0 && (
            <BlockStack gap="100">
              <Text variant="headingSm" as="h3">Recommendations</Text>
              {analysis.recommendations!.map((r, i) => (
                <InlineStack key={i} gap="200" align="space-between" blockAlign="start" wrap={false}>
                  <BlockStack gap="050">
                    <Text as="p">• {r}</Text>
                    {analysis.recommendationEvidence?.[i] && (
                      <Text as="p" tone="subdued" variant="bodySm">{analysis.recommendationEvidence[i]}</Text>
                    )}
                  </BlockStack>
                  {recFlags[i]?.isPlanned
                    ? <Badge tone="success">Planned</Badge>
                    : <Button size="slim" loading={recFlags[i]?.isPlanning} onClick={() => onPlanRecommendation(i, r)}>Plan it</Button>}
                </InlineStack>
              ))}
            </BlockStack>
          )}
        </>
      )}
    </BlockStack>
  );
}
