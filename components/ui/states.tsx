"use client";

import {
  BlockStack,
  InlineStack,
  SkeletonBodyText,
  SkeletonDisplayText,
  Card,
  Text,
} from "@shopify/polaris";

/**
 * Compact inline empty state for use inside a Card body — lighter than
 * Polaris <EmptyState>, which is page-scale. Use for "no data yet" sections.
 */
export function EmptyMessage({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <BlockStack gap="200" inlineAlign="center">
      <Text variant="bodyMd" as="p" fontWeight="medium">
        {title}
      </Text>
      {description && (
        <Text variant="bodySm" as="p" tone="subdued" alignment="center">
          {description}
        </Text>
      )}
      {action}
    </BlockStack>
  );
}

/** Skeleton row of stat cards, matching the StatGrid layout while loading. */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <InlineStack gap="400" wrap>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ flex: "1 1 180px", minWidth: 180 }}>
          <Card>
            <BlockStack gap="200">
              <SkeletonBodyText lines={1} />
              <SkeletonDisplayText size="large" />
            </BlockStack>
          </Card>
        </div>
      ))}
    </InlineStack>
  );
}

/** Generic skeleton for a list/table section body. */
export function ListSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <BlockStack gap="300">
      <SkeletonBodyText lines={lines} />
    </BlockStack>
  );
}
