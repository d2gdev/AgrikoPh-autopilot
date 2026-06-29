"use client";

import { Card, Text, BlockStack, InlineStack, Badge, Icon } from "@shopify/polaris";
import type { IconSource } from "@shopify/polaris";
import { TrendChart, type TrendPoint } from "@/components/trend-chart";

type Tone = "success" | "warning" | "critical" | "info" | "new" | "attention";

export interface StatCardProps {
  /** Small uppercase-ish label above the value. */
  label: string;
  /** The headline metric. Pass "—" while loading. */
  value: React.ReactNode;
  /** Optional supporting line under the value. */
  subtitle?: React.ReactNode;
  /** Optional status badge (e.g. last-run state). */
  badge?: { label: string; tone?: Tone };
  /** Optional leading icon for the label row. */
  icon?: IconSource;
  /** Optional sparkline; renders only when 2+ points are supplied. */
  trend?: TrendPoint[];
  trendColor?: string;
}

/**
 * Consistent KPI card built on Polaris primitives. Standardises the
 * label → value → (badge/subtitle/trend) rhythm across every screen.
 */
export function StatCard({
  label,
  value,
  subtitle,
  badge,
  icon,
  trend,
  trendColor = "#5c6ac4",
}: StatCardProps) {
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack gap="150" blockAlign="center">
          {icon && <Icon source={icon} tone="subdued" />}
          <Text variant="bodySm" as="span" tone="subdued" fontWeight="medium">
            {label}
          </Text>
        </InlineStack>

        <Text variant="heading2xl" as="p">
          {value}
        </Text>

        {badge && (
          <InlineStack>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </InlineStack>
        )}

        {subtitle && (
          <Text variant="bodySm" as="p" tone="subdued">
            {subtitle}
          </Text>
        )}

        {trend && trend.length >= 2 && (
          <TrendChart points={trend} color={trendColor} height={48} />
        )}
      </BlockStack>
    </Card>
  );
}
