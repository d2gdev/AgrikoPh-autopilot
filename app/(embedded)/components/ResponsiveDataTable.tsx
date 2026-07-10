"use client";

import { BlockStack, DataTable, Divider, InlineStack, Text, useBreakpoints } from "@shopify/polaris";
import type { ReactNode } from "react";

type Cell = string | number | ReactNode;

/** Renders labelled rows on compact screens, avoiding horizontal table scrolling. */
export function ResponsiveDataTable({ headings, rows, columnContentTypes }: {
  headings: ReactNode[];
  rows: Cell[][];
  columnContentTypes: ("text" | "numeric")[];
}) {
  const { mdUp } = useBreakpoints({ defaults: { mdUp: true } });
  if (mdUp) return <DataTable headings={headings} rows={rows} columnContentTypes={columnContentTypes} />;
  return (
    <BlockStack gap="200">
      {rows.map((row, rowIndex) => (
        <BlockStack gap="100" key={rowIndex}>
          {row.map((cell, index) => (
            <InlineStack key={index} align="space-between" gap="200" wrap={false} blockAlign="start">
              <Text as="span" tone="subdued" variant="bodySm">{headings[index]}</Text>
              <Text as="span" alignment={columnContentTypes[index] === "numeric" ? "end" : "start"}>{cell}</Text>
            </InlineStack>
          ))}
          {rowIndex < rows.length - 1 && <Divider />}
        </BlockStack>
      ))}
    </BlockStack>
  );
}
