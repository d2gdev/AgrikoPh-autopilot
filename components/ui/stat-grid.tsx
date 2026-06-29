"use client";

import { InlineGrid } from "@shopify/polaris";

/**
 * Responsive grid for stat/KPI cards. Replaces hand-rolled
 * `InlineStack wrap={false}` rows that overflow at embedded widths.
 * Collapses 4→2→1 columns as the embedded frame narrows.
 */
export function StatGrid({
  children,
  minColumns = 1,
}: {
  children: React.ReactNode;
  /** Lower bound for the smallest breakpoint (default 1). */
  minColumns?: 1 | 2;
}) {
  return (
    <InlineGrid
      gap="400"
      columns={{
        xs: "1fr",
        sm: minColumns === 2 ? "1fr 1fr" : "1fr",
        md: "1fr 1fr",
        lg: "repeat(4, minmax(0, 1fr))",
        xl: "repeat(4, minmax(0, 1fr))",
      }}
    >
      {children}
    </InlineGrid>
  );
}
