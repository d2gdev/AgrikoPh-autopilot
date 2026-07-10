import { Text, BlockStack, Badge, Button, InlineStack } from "@shopify/polaris";
import { ResponsiveDataTable } from "@/app/(embedded)/components/ResponsiveDataTable";
import type { PageHealthRow } from "../types";
import { fmtPct } from "../types";

export function PageHealthPanel({
  pageHealth,
  flaggedPageHealth,
  pageHealthFlag,
}: {
  pageHealth: PageHealthRow[];
  flaggedPageHealth: PageHealthRow[];
  pageHealthFlag: Record<string, { tone: "warning" | "critical"; label: string }>;
}) {
  return (
    <BlockStack gap="400">
      <Text variant="headingMd" as="h2">Page health (GSC × GA4)</Text>
      <Text as="p" tone="subdued">High-impression landing pages whose engagement signals (bounce, conversion) suggest the page is underperforming its search demand. Flagged pages lead.</Text>
      {flaggedPageHealth.length === 0 ? (
        <Text as="p" tone="subdued">
          {pageHealth.length === 0
            ? "No page health data yet — appears after the next GSC + GA4 data fetch."
            : "No flagged pages. All high-impression pages are engaging well."}
        </Text>
      ) : (
        <ResponsiveDataTable
          columnContentTypes={["text", "numeric", "numeric", "numeric", "text"]}
          headings={["URL", "Impr.", "Bounce", "Conversion", "Flag"]}
          rows={flaggedPageHealth.map((p, i) => [
            <Button key={`ph-${p.rawUrl}-${i}`} variant="plain" url={p.rawUrl} external>{p.url}</Button>,
            p.impressions.toLocaleString(),
            fmtPct(p.bounceRate),
            fmtPct(p.conversionRate),
            p.flags.length
              ? <InlineStack key={`phf-${p.rawUrl}-${i}`} gap="100" wrap>{p.flags.map((flag) => <Badge key={flag} tone={pageHealthFlag[flag]?.tone}>{pageHealthFlag[flag]?.label ?? flag}</Badge>)}</InlineStack>
              : <Text key={`phf-${p.rawUrl}-${i}`} as="span" tone="subdued">—</Text>,
          ])}
        />
      )}
    </BlockStack>
  );
}
