import { Button, InlineStack, Select, TextField } from "@shopify/polaris";

type StageFilter = "all" | "pending" | "approved" | "generating" | "ready" | "scheduled" | "published" | "failed" | "rejected";

export function QueueFilters({
  loading,
  stageFilter,
  stagePills,
  onSelectStage,

  searchQuery,
  onSearchQueryChange,
  onClearSearch,

  typeFilter,
  onTypeFilterChange,
  typeOptions,

  priorityFilter,
  onPriorityFilterChange,
  priorityOptions,

  sortKey,
  onSortKeyChange,
}: {
  loading: boolean;
  stageFilter: StageFilter;
  stagePills: { key: StageFilter; label: string; count: number }[];
  onSelectStage: (key: StageFilter) => void;

  searchQuery: string;
  onSearchQueryChange: (v: string) => void;
  onClearSearch: () => void;

  typeFilter: string;
  onTypeFilterChange: (v: string) => void;
  typeOptions: { label: string; value: string }[];

  priorityFilter: string;
  onPriorityFilterChange: (v: string) => void;
  priorityOptions: { label: string; value: string }[];

  sortKey: "priority" | "createdAt" | "impact";
  onSortKeyChange: (v: string) => void;
}) {
  return (
    <>
      {/* Stage filter pills */}
      <InlineStack gap="200">
        {stagePills.filter((s) => s.count > 0 || s.key === "all").map(({ key, label, count }) => (
          <Button
            key={key}
            variant={stageFilter === key ? "primary" : "secondary"}
            size="slim"
            onClick={() => onSelectStage(key)}
          >
            {`${label}${key !== "all" ? ` (${loading ? "…" : count})` : ""}`}
          </Button>
        ))}
      </InlineStack>

      {/* Search & filters */}
      <InlineStack gap="200" blockAlign="end" wrap>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <TextField label="Search proposals" labelHidden placeholder="Search…" value={searchQuery} onChange={onSearchQueryChange}
            autoComplete="off" clearButton onClearButtonClick={onClearSearch} />
        </div>
        <div style={{ minWidth: 140 }}>
          <Select label="Filter by type" labelHidden options={typeOptions} value={typeFilter} onChange={onTypeFilterChange} />
        </div>
        <div style={{ minWidth: 130 }}>
          <Select label="Filter by priority" labelHidden options={priorityOptions} value={priorityFilter} onChange={onPriorityFilterChange} />
        </div>
        <div style={{ minWidth: 130 }}>
          <Select
            label="Sort by"
            labelHidden
            options={[
              { label: "Priority", value: "priority" },
              { label: "Newest", value: "createdAt" },
              { label: "Impact", value: "impact" },
            ]}
            value={sortKey}
            onChange={onSortKeyChange}
          />
        </div>
      </InlineStack>
    </>
  );
}
