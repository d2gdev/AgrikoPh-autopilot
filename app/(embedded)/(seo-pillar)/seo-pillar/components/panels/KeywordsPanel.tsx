import { Text, InlineStack, BlockStack, TextField, Button, Badge } from "@shopify/polaris";
import { ResponsiveDataTable } from "@/app/(embedded)/components/ResponsiveDataTable";
import type { Dispatch, SetStateAction } from "react";
import type { KeywordRow } from "../types";

type KwSort = { index: number; dir: "ascending" | "descending" } | null;

export function KeywordsPanel({
  keywords,
  newKeyword,
  setNewKeyword,
  addKeyword,
  kwSearch,
  setKwSearch,
  kwSort,
  setKwSort,
}: {
  keywords: KeywordRow[];
  newKeyword: string;
  setNewKeyword: Dispatch<SetStateAction<string>>;
  addKeyword: () => void;
  kwSearch: string;
  setKwSearch: Dispatch<SetStateAction<string>>;
  kwSort: KwSort;
  setKwSort: Dispatch<SetStateAction<KwSort>>;
}) {
  return (
    <BlockStack gap="400">
      <Text variant="headingMd" as="h2">Tracked keyword positions</Text>
      <Text as="p" tone="subdued">Positions are derived from your GSC snapshots. Add target keywords to monitor rank movement and get drop alerts.</Text>
      <InlineStack gap="200" blockAlign="end" wrap>
        <div style={{ minWidth: 280 }}>
          <TextField label="Add keyword" labelHidden autoComplete="off" value={newKeyword} onChange={setNewKeyword} placeholder="e.g. organic black rice philippines" />
        </div>
        <Button onClick={addKeyword}>Track</Button>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <TextField label="Search keywords" labelHidden placeholder="Search…" value={kwSearch} onChange={setKwSearch}
            autoComplete="off" clearButton onClearButtonClick={() => setKwSearch("")} />
        </div>
      </InlineStack>
      {keywords.length === 0 ? <Text as="p" tone="subdued">No keywords tracked yet.</Text> : (
        <ResponsiveDataTable
          columnContentTypes={["text", "numeric", "text", "numeric", "numeric", "text"]}
          headings={["Keyword", "Position", "Δ Pos", "Clicks", "Impr.", "Status"]}
          sortable={[true, true, true, true, true, false]}
          onSort={(index, direction) => {
            if (direction === "none") setKwSort(null);
            else setKwSort({ index, dir: direction });
          }}
          rows={keywords
            .filter((k) => !kwSearch || k.keyword.toLowerCase().includes(kwSearch.toLowerCase()))
            .sort((a, b) => {
              if (!kwSort) return 0;
              const dir = kwSort.dir === "ascending" ? 1 : -1;
              switch (kwSort.index) {
                case 0: return dir * a.keyword.localeCompare(b.keyword);
                case 1: return dir * ((a.position ?? Number.MAX_VALUE) - (b.position ?? Number.MAX_VALUE));
                case 2: return dir * ((a.positionDelta ?? 0) - (b.positionDelta ?? 0));
                case 3: return dir * (a.clicks - b.clicks);
                case 4: return dir * (a.impressions - b.impressions);
                default: return 0;
              }
            })
            .map((k) => [
            k.keyword,
            k.position === null ? "—" : k.position.toFixed(1),
            k.positionDelta === null ? "—" : `${k.positionDelta < 0 ? "▲" : "▼"} ${Math.abs(k.positionDelta).toFixed(1)}`,
            String(k.clicks),
            String(k.impressions),
            <Badge key={k.keyword} tone={k.alert ? "critical" : k.status === "improved" ? "success" : k.status === "declined" ? "warning" : undefined}>
              {k.alert ? "Drop alert" : k.status}
            </Badge>,
          ])}
        />
      )}
    </BlockStack>
  );
}
