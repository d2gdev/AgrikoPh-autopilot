# Market Intelligence Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Market Intelligence page from a single long scrolling page into a four-tab layout (Insights, Ads, Shopping, Keywords) using Polaris `Tabs`.

**Architecture:** Single file change to `page.tsx`. Add a `selectedTab` state, import Polaris `Tabs`, replace the stacked `Layout.Section` blocks with a tabbed layout. Global filter bar keeps only Date range; the two text filters relocate into their respective tab content areas. "Manage tracking" collapsible stays below the tabs.

**Tech Stack:** Next.js App Router, Polaris (`@shopify/polaris`), TypeScript.

## Global Constraints

- All Polaris imports from `@shopify/polaris` — no new dependencies
- No `any`, no `@ts-ignore`
- `rtk tsc --noEmit` must pass before committing
- No routing changes, no new files, no API changes
- "Manage tracking" collapsible must remain below the tab panel unchanged

---

### Task 1: Restructure Market Intelligence page into tabs

**Files:**
- Modify: `app/(embedded)/(market-intelligence)/market-intelligence/page.tsx`

**Interfaces:**
- No new interfaces. All existing state, memos, and callbacks remain unchanged.
- New state: `const [selectedTab, setSelectedTab] = useState(0);`

- [ ] **Step 1: Add `Tabs` to the Polaris import**

Find the existing import block at the top of `page.tsx`:

```ts
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Collapsible,
  DataTable,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Select,
  Badge,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
```

Replace with (add `Tabs`):

```ts
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Collapsible,
  DataTable,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Select,
  Badge,
  Spinner,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
```

- [ ] **Step 2: Add `selectedTab` state**

Find the block of `useState` calls near the top of the component body (after the `useAuthFetch` call). Add this alongside the existing state declarations:

```ts
const [selectedTab, setSelectedTab] = useState(0);
```

- [ ] **Step 3: Fix the stale `longRunCutoff` dependency**

Find the `adCards` useMemo dependency array. It currently reads:

```ts
}, [data?.competitorAds, cutoff, filterCompetitor, longRunCutoff]);
```

Replace with:

```ts
}, [data?.competitorAds, cutoff, filterCompetitor]);
```

- [ ] **Step 4: Strip the two text filters from the global filter bar**

Find the existing filter bar `Card` (the one with `InlineStack gap="400"`). It currently has three children: Date range `Select`, "Filter shopping by keyword" `TextField`, and "Filter ads by competitor" `TextField`.

Replace the entire filter bar card with just the date range:

```tsx
{/* Global filter — date range only; text filters live inside their tabs */}
<Layout.Section>
  <Card>
    <InlineStack gap="400" wrap blockAlign="end">
      <div style={{ minWidth: 150 }}>
        <Select
          label="Date range"
          options={[
            { label: "Last 7 days", value: "7" },
            { label: "Last 30 days", value: "30" },
            { label: "Last 90 days", value: "90" },
            { label: "All time", value: "all" },
          ]}
          value={filterDays}
          onChange={setFilterDays}
        />
      </div>
    </InlineStack>
  </Card>
</Layout.Section>
```

- [ ] **Step 5: Replace the stacked section blocks with a Tabs layout**

Remove ALL of the following existing `Layout.Section` blocks:
- `{/* Insights — what changed (the headline) */}`
- `{/* Shopping visibility & pricing */}`
- `{/* Competitor ad creative */}`
- `{/* Keyword research (collapsible reference data) */}`
- `{/* Price comparison */}`

Replace them with a single `Layout.Section` containing the `Tabs` component:

```tsx
{/* Tabbed content */}
<Layout.Section>
  <Tabs
    tabs={[
      { id: "insights", content: "Insights" },
      { id: "ads", content: "Ads" },
      { id: "shopping", content: "Shopping" },
      { id: "keywords", content: "Keywords" },
    ]}
    selected={selectedTab}
    onSelect={setSelectedTab}
  >
    <div style={{ paddingTop: 16 }}>

      {/* Tab 0 — Insights */}
      {selectedTab === 0 && (
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text variant="headingLg" as="h2">What changed</Text>
            <Text as="p" tone="subdued">Prioritised insights from the latest capture — most urgent first.</Text>
          </BlockStack>
          {loading ? (
            <InlineStack align="center"><Spinner size="small" /></InlineStack>
          ) : sortedInsights.length === 0 ? (
            <Card>
              <EmptyMessage title="No insights yet" description="Run a capture to analyze competitor moves." />
            </Card>
          ) : (
            <BlockStack gap="300">
              {sortedInsights.map((insight) => <InsightCard key={insight.id} insight={insight} />)}
            </BlockStack>
          )}
        </BlockStack>
      )}

      {/* Tab 1 — Ads */}
      {selectedTab === 1 && (
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="end">
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2">Competitor ad creative</Text>
              <Text as="p" tone="subdued">Competitor ads — longest-running first.</Text>
            </BlockStack>
            <div style={{ minWidth: 220 }}>
              <TextField
                label="Filter by competitor"
                value={filterCompetitor}
                onChange={setFilterCompetitor}
                placeholder="e.g. Harvest Gold"
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setFilterCompetitor("")}
              />
            </div>
          </InlineStack>
          {angleSummary.length > 0 && (
            <InlineStack gap="150" blockAlign="center" wrap>
              <Text as="span" variant="bodySm" tone="subdued">Angles:</Text>
              {angleSummary.map(([angle, n]) => (
                <Badge key={angle} tone="info">{`${angle.replace(/-/g, " ")} ×${n}`}</Badge>
              ))}
            </InlineStack>
          )}
          {loading ? (
            <InlineStack align="center"><Spinner size="small" /></InlineStack>
          ) : adCards.length === 0 ? (
            <Card>
              <EmptyMessage title="No competitor ads found" description="No ads match the current filters. Try a wider date range or add a competitor below to widen tracking." />
            </Card>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
              {adCards.map((g) => <AdCreativeCard key={g.ad.id} ad={g.ad} count={g.count} />)}
            </div>
          )}
        </BlockStack>
      )}

      {/* Tab 2 — Shopping */}
      {selectedTab === 2 && (
        <BlockStack gap="400">
          <InlineStack align="end">
            <div style={{ minWidth: 220 }}>
              <TextField
                label="Filter by keyword"
                value={filterKeyword}
                onChange={setFilterKeyword}
                placeholder="e.g. organic rice"
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setFilterKeyword("")}
              />
            </div>
          </InlineStack>
          <SectionCard title="Shopping visibility & pricing">
            <Text as="p" tone="subdued">Where products surface on Google Shopping and at what price.</Text>
            {loading ? (
              <InlineStack align="center"><Spinner size="small" /></InlineStack>
            ) : shoppingRows.length === 0 ? (
              <EmptyMessage title="No shopping results yet" description="Track a keyword below, then run a capture." />
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "numeric", "text"]}
                headings={["Keyword", "Product", "Store", "Price", "Position", "Captured"]}
                rows={shoppingRows}
              />
            )}
          </SectionCard>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2">Price comparison</Text>
              <Text as="p" tone="subdued">Your products vs. comparable competitor prices from current shopping data.</Text>
            </BlockStack>
            {ourProductsLoading || loading ? (
              <InlineStack align="center"><Spinner size="small" /></InlineStack>
            ) : ourProducts.length === 0 ? (
              <Card>
                <EmptyMessage
                  title="Could not load your products"
                  description="Check your Shopify credentials in Settings."
                />
              </Card>
            ) : (data?.shoppingResults ?? []).length === 0 ? (
              <Card>
                <EmptyMessage
                  title="No competitor pricing data"
                  description="No competitor pricing data for this date range. Try a wider date range or run a market capture."
                />
              </Card>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "12px" }}>
                {priceComparisons.map(({ product, matches }) => (
                  <PriceComparisonCard key={product.id} product={product} matches={matches} />
                ))}
              </div>
            )}
          </BlockStack>
        </BlockStack>
      )}

      {/* Tab 3 — Keywords */}
      {selectedTab === 3 && (
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text variant="headingMd" as="h2">Google Ads keyword research</Text>
            <Text as="p" tone="subdued">Search volume, competition, and bid estimates for tracked keywords.</Text>
          </BlockStack>
          {keywordResearchRows.length === 0 ? (
            <Card>
              <EmptyMessage title="No keyword research captured yet" description={'Use the "Keyword research" button above to run a capture.'} />
            </Card>
          ) : (
            <DataTable
              columnContentTypes={["text", "numeric", "text", "numeric", "numeric", "numeric", "text"]}
              headings={["Keyword", "Monthly Searches", "Competition", "Index", "Low Bid", "High Bid", "Captured"]}
              rows={keywordResearchRows}
            />
          )}
        </BlockStack>
      )}

    </div>
  </Tabs>
</Layout.Section>
```

- [ ] **Step 6: Verify the "Manage tracking" section is still in place below the tab Layout.Section**

The `{/* Manage tracking (collapsible setup) */}` `Layout.Section` must remain immediately after the tabs `Layout.Section`, unchanged. Confirm it is still present and untouched.

- [ ] **Step 7: Type-check**

```bash
rtk tsc --noEmit
```

Expected: same count of pre-existing errors (34), zero new errors in `market-intelligence/page.tsx`.

- [ ] **Step 8: Manual smoke-test**

Open the Market Intelligence page in the embedded app and verify:
- Four tabs render: Insights, Ads, Shopping, Keywords
- Clicking each tab shows the correct content
- Global filter bar shows only the Date range selector
- Ads tab has "Filter by competitor" field; changing it filters the ad cards
- Shopping tab has "Filter by keyword" field; changing it filters the shopping table
- Shopping tab shows both the shopping table and price comparison cards
- Keywords tab shows the keyword research table without a collapsible wrapper
- "Manage tracking" section is still visible below the tabs
- Stat cards and banners still render above the tabs

- [ ] **Step 9: Commit**

```bash
git add app/\(embedded\)/\(market-intelligence\)/market-intelligence/page.tsx
git commit -m "feat(market-intel): restructure page into Insights/Ads/Shopping/Keywords tabs"
```
