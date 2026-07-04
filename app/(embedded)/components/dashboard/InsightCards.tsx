"use client";

import { Card, Text, Badge, InlineStack, BlockStack } from "@shopify/polaris";
import { timeAgo } from "@/lib/format";
import type { FatigueItem, SearchTermItem, CompetitorItem } from "./types";

// ── Skill Insight cards ───────────────────────────────────────────────────────

const FATIGUE_TONE: Record<string, "critical" | "warning" | "success" | "subdued"> = {
  urgent: "critical",
  warning: "warning",
  healthy: "success",
  dead: "subdued",
};

export function FatigueCard({ items, updatedAt }: { items: FatigueItem[]; updatedAt: string | null }) {
  const counts = { urgent: 0, warning: 0, healthy: 0, dead: 0 };
  for (const item of items) {
    if (item.status in counts) counts[item.status as keyof typeof counts]++;
  }
  return (
    <Card>
      <BlockStack gap="200">
        <BlockStack gap="050">
          <Text variant="headingMd" as="h2">Creative Fatigue</Text>
          {updatedAt && <Text as="p" tone="subdued">{timeAgo(updatedAt)}</Text>}
        </BlockStack>
        {items.length === 0 ? (
          <Text as="p" tone="subdued">No data yet</Text>
        ) : (
          <BlockStack gap="150">
            {(["urgent", "warning", "healthy", "dead"] as const).map((s) =>
              counts[s] > 0 ? (
                <InlineStack key={s} align="space-between">
                  <Text as="p">{s}</Text>
                  <Badge tone={FATIGUE_TONE[s] as "critical" | "warning" | "success"}>{String(counts[s])}</Badge>
                </InlineStack>
              ) : null
            )}
            <Text as="p" tone="subdued">{items.length} ad{items.length !== 1 ? "s" : ""} analysed</Text>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

export function SearchTermCard({ items, updatedAt }: { items: SearchTermItem[]; updatedAt: string | null }) {
  const opportunities = items.filter((i) => !i.isNegativeKeyword);
  const negatives = items.filter((i) => i.isNegativeKeyword);
  const themes = Array.from(
    opportunities.reduce((m, i) => {
      m.set(i.theme, (m.get(i.theme) ?? 0) + 1);
      return m;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);

  return (
    <Card>
      <BlockStack gap="200">
        <BlockStack gap="050">
          <Text variant="headingMd" as="h2">Search Opportunities</Text>
          {updatedAt && <Text as="p" tone="subdued">{timeAgo(updatedAt)}</Text>}
        </BlockStack>
        {items.length === 0 ? (
          <Text as="p" tone="subdued">No data yet</Text>
        ) : (
          <BlockStack gap="150">
            <InlineStack align="space-between">
              <Text as="p">New keywords</Text>
              <Badge tone="success">{String(opportunities.length)}</Badge>
            </InlineStack>
            {negatives.length > 0 && (
              <InlineStack align="space-between">
                <Text as="p">Negatives to add</Text>
                <Badge tone="warning">{String(negatives.length)}</Badge>
              </InlineStack>
            )}
            {themes.slice(0, 3).map(([theme, count]) => (
              <InlineStack key={theme} align="space-between">
                <Text as="p" tone="subdued">{theme}</Text>
                <Text as="p" tone="subdued">{String(count)}</Text>
              </InlineStack>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

export function CompetitorCard({ items, updatedAt }: { items: CompetitorItem[]; updatedAt: string | null }) {
  const totalGaps = items.reduce((n, c) => n + (c.gaps?.length ?? 0), 0);
  const recentActivity = items.filter((c) => c.recentLaunches7d > 0);

  return (
    <Card>
      <BlockStack gap="200">
        <BlockStack gap="050">
          <Text variant="headingMd" as="h2">Competitor Pulse</Text>
          {updatedAt && <Text as="p" tone="subdued">{timeAgo(updatedAt)}</Text>}
        </BlockStack>
        {items.length === 0 ? (
          <Text as="p" tone="subdued">No data yet</Text>
        ) : (
          <BlockStack gap="150">
            {items.map((c) => (
              <InlineStack key={c.competitor} align="space-between">
                <Text as="p">{c.competitor}</Text>
                <InlineStack gap="200">
                  <Text as="p" tone="subdued">{c.activeAdCount} ads</Text>
                  {c.recentLaunches7d > 0 && (
                    <Badge tone="warning">{`+${c.recentLaunches7d} this week`}</Badge>
                  )}
                </InlineStack>
              </InlineStack>
            ))}
            {totalGaps > 0 && (
              <Text as="p" tone="subdued">{totalGaps} whitespace gap{totalGaps !== 1 ? "s" : ""} identified</Text>
            )}
            {recentActivity.length === 0 && (
              <Text as="p" tone="subdued">No competitor activity this week</Text>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
