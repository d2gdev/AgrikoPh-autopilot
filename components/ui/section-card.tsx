"use client";

import { Card, Text, BlockStack, InlineStack } from "@shopify/polaris";

/**
 * Card with a standard header row: title on the left, optional action on the
 * right, then body content. Gives every section the same heading rhythm.
 */
export function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h2">
            {title}
          </Text>
          {action}
        </InlineStack>
        {children}
      </BlockStack>
    </Card>
  );
}
