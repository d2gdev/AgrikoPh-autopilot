"use client";

import { BlockStack, Button, DataTable, Divider, InlineStack, Select, Text, useBreakpoints } from "@shopify/polaris";
import type { SortDirection } from "@shopify/polaris";
import { useState, type ReactNode } from "react";

type Cell = string | number | ReactNode;

/** Renders labelled rows on compact screens, avoiding horizontal table scrolling. */
export function ResponsiveDataTable({ headings, rows, columnContentTypes, sortable, onSort, compactSortIndex, compactSortDirection }: {
  headings: ReactNode[];
  rows: Cell[][];
  columnContentTypes: ("text" | "numeric")[];
  sortable?: boolean[];
  onSort?: (headingIndex: number, direction: SortDirection) => void;
  compactSortIndex?: number;
  compactSortDirection?: SortDirection;
}) {
  const { mdUp } = useBreakpoints({ defaults: { mdUp: true } });
  const [localSortIndex, setLocalSortIndex] = useState(-1);
  const [localSortDirection, setLocalSortDirection] = useState<SortDirection>("ascending");
  const sortIndex = compactSortIndex ?? localSortIndex;
  const sortDirection = compactSortDirection ?? localSortDirection;
  if (mdUp) return <DataTable headings={headings} rows={rows} columnContentTypes={columnContentTypes} sortable={sortable} onSort={onSort} />;
  return (
    <BlockStack gap="200">
      {onSort && sortable?.some(Boolean) && (
        <InlineStack gap="200" wrap>
          <Select label="Sort rows" labelHidden value={String(sortIndex)} options={[{ label: "Current order", value: "-1" }, ...headings.map((heading, index) => ({ label: String(heading), value: String(index), disabled: !sortable[index] }))]} onChange={(value) => { const index = Number(value); setLocalSortIndex(index); if (index < 0) onSort(sortable.findIndex(Boolean), "none"); else onSort(index, sortDirection); }} />
          <Button size="slim" disabled={sortIndex < 0} onClick={() => { const next = sortDirection === "ascending" ? "descending" : "ascending"; setLocalSortDirection(next); if (sortIndex >= 0) onSort(sortIndex, next); }}>{sortDirection === "ascending" ? "Ascending" : "Descending"}</Button>
        </InlineStack>
      )}
      {rows.map((row, rowIndex) => (
        <BlockStack gap="100" key={rowIndex}>
          {row.map((cell, index) => (
            <InlineStack key={index} align="space-between" gap="200" wrap={false} blockAlign="start">
              <Text as="span" tone="subdued" variant="bodySm">{headings[index]}</Text>
              {typeof cell === "string" || typeof cell === "number"
                ? <Text as="span" alignment={columnContentTypes[index] === "numeric" ? "end" : "start"}>{cell}</Text>
                : <div style={{ minWidth: 0 }}>{cell}</div>}
            </InlineStack>
          ))}
          {rowIndex < rows.length - 1 && <Divider />}
        </BlockStack>
      ))}
    </BlockStack>
  );
}
