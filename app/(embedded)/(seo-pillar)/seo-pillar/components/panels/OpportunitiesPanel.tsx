import { Text, InlineStack, BlockStack, TextField, Select, DataTable } from "@shopify/polaris";
import type { Dispatch, ReactNode, SetStateAction } from "react";

type Row = ReactNode[];
type OppSort = { index: number; dir: "ascending" | "descending" } | null;

export function OpportunitiesPanel({
  oppCount,
  oppSearch,
  setOppSearch,
  oppType,
  setOppType,
  oppTypeOptions,
  oppRows,
  setOppSort,
}: {
  oppCount: number;
  oppSearch: string;
  setOppSearch: Dispatch<SetStateAction<string>>;
  oppType: string;
  setOppType: Dispatch<SetStateAction<string>>;
  oppTypeOptions: { label: string; value: string }[];
  oppRows: Row[];
  setOppSort: Dispatch<SetStateAction<OppSort>>;
}) {
  return (
    <BlockStack gap="300">
      <Text variant="headingMd" as="h2">CTR & ranking opportunities</Text>
      <Text as="p" tone="subdued">Queries where a title/meta rewrite or a small ranking push could win clicks you&apos;re already close to. &ldquo;Potential&rdquo; estimates extra monthly clicks at benchmark CTR.</Text>
      {oppCount > 0 && (
        <InlineStack gap="200" blockAlign="end" wrap>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <TextField label="Search opportunities" labelHidden placeholder="Search query or page…" value={oppSearch} onChange={setOppSearch}
              autoComplete="off" clearButton onClearButtonClick={() => setOppSearch("")} />
          </div>
          <div style={{ minWidth: 170 }}>
            <Select label="Filter by type" labelHidden options={oppTypeOptions} value={oppType} onChange={setOppType} />
          </div>
        </InlineStack>
      )}
      {oppRows.length === 0 ? (
        <Text as="p" tone="subdued">
          {oppCount > 0
            ? "No opportunities match the current search/filter."
            : "No actionable opportunities are open. Refresh data or run SEO analysis when you need a new pass; handled and dismissed items stay out of this queue."}
        </Text>
      ) : (
        <DataTable
          columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric", "numeric", "text", "numeric", "text"]}
          headings={["Query", "Type", "Landing page", "Impr.", "CTR", "Position", "Volume", "Difficulty", "Potential", "Action"]}
          rows={oppRows}
          sortable={[false, false, false, true, false, false, true, false, true, false]}
          onSort={(index, direction) => {
            if (direction === "none") setOppSort(null);
            else setOppSort({ index, dir: direction });
          }}
        />
      )}
    </BlockStack>
  );
}
