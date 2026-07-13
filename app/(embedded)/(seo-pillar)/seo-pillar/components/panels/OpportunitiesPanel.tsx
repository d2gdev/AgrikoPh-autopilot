import { Text, BlockStack, TextField, Select } from "@shopify/polaris";
import { ResponsiveDataTable } from "@/app/(embedded)/components/ResponsiveDataTable";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import styles from "../seo-pilot-responsive.module.css";

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
  oppSort,
  setOppSort,
}: {
  oppCount: number;
  oppSearch: string;
  setOppSearch: Dispatch<SetStateAction<string>>;
  oppType: string;
  setOppType: Dispatch<SetStateAction<string>>;
  oppTypeOptions: { label: string; value: string }[];
  oppRows: Row[];
  oppSort: OppSort;
  setOppSort: Dispatch<SetStateAction<OppSort>>;
}) {
  return (
    <BlockStack gap="300">
      <Text variant="headingMd" as="h2">Search evidence observations</Text>
      <Text as="p" tone="subdued">Raw GSC evidence is kept separate from the active strategy. It can inform a future map revision, but cannot silently become strategy. No map rule association means proposal actions stay unavailable.</Text>
      {oppCount > 0 && (
        <div className={styles.controlRow}>
          <div className={styles.control}>
            <TextField label="Search opportunities" labelHidden placeholder="Search query or page…" value={oppSearch} onChange={setOppSearch}
              autoComplete="off" clearButton onClearButtonClick={() => setOppSearch("")} />
          </div>
          <div className={styles.controlCompact}>
            <Select label="Filter by type" labelHidden options={oppTypeOptions} value={oppType} onChange={setOppType} />
          </div>
        </div>
      )}
      {oppRows.length === 0 ? (
        <Text as="p" tone="subdued">
          {oppCount > 0
            ? "No opportunities match the current search/filter."
            : "No actionable opportunities are open. Refresh data or run SEO analysis when you need a new pass; handled and dismissed items stay out of this queue."}
        </Text>
      ) : (
        <ResponsiveDataTable
          columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric", "numeric", "text", "numeric", "text"]}
          headings={["Query", "Type", "Landing page", "Impr.", "CTR", "Position", "Volume", "Difficulty", "Potential", "Action"]}
          rows={oppRows}
          sortable={[false, false, false, true, false, false, true, false, true, false]}
          compactSortIndex={oppSort?.index ?? -1}
          compactSortDirection={oppSort?.dir ?? "ascending"}
          onSort={(index, direction) => {
            if (direction === "none") setOppSort(null);
            else setOppSort({ index, dir: direction });
          }}
        />
      )}
    </BlockStack>
  );
}
