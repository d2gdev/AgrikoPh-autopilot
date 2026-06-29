# Price Comparison Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Price comparison" section to the Market Intelligence page that shows each of our Shopify products alongside fuzzy-matched competitor shopping results, with a market-average badge.

**Architecture:** A new API route fetches our Shopify products (title + price). Client-side Jaccard similarity matching pairs each of our products against the existing `shoppingResults` already returned by `/api/market-intelligence`. A new `PriceComparisonCard` component renders each matched set. The comparison section is added as a new `Layout.Section` at the bottom of the Market Intelligence page.

**Tech Stack:** Next.js App Router, Polaris (`@shopify/polaris`), TypeScript, Shopify Admin GraphQL via `shopifyFetch` in `lib/shopify-admin.ts`.

## Global Constraints

- All Polaris imports come from `@shopify/polaris` — no custom CSS unless unavoidable
- Auth on API routes via `requireAppAuth` from `@/lib/auth` — same pattern as existing market-intelligence routes
- `shopifyFetch` from `@/lib/shopify-admin` handles Shopify Admin GraphQL — do not call Shopify directly
- TypeScript strict — no `any`, no `@ts-ignore`
- `rtk tsc --noEmit` must pass before each commit

---

### Task 1: API route — fetch our Shopify products

**Files:**
- Create: `app/api/market-intelligence/our-products/route.ts`

**Interfaces:**
- Produces: `GET /api/market-intelligence/our-products` → `{ products: OurProduct[] }`
  ```ts
  interface OurProduct {
    id: string;        // Shopify GID e.g. "gid://shopify/Product/123"
    title: string;
    price: number;     // cheapest variant price as float
    currency: string;  // e.g. "PHP"
  }
  ```

- [ ] **Step 1: Create the route file**

```ts
// app/api/market-intelligence/our-products/route.ts
import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { shopifyFetch } from "@/lib/shopify-admin";

interface VariantNode {
  price: string;
}

interface ProductNode {
  id: string;
  title: string;
  variants: { edges: { node: VariantNode }[] };
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
}

interface ProductsResponse {
  products: {
    edges: { node: ProductNode }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

const QUERY = `
  query OurProducts($after: String) {
    products(first: 100, after: $after) {
      edges {
        node {
          id
          title
          priceRangeV2 {
            minVariantPrice { amount currencyCode }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function GET() {
  const auth = await requireAppAuth();
  if (!auth.ok) return auth.response;

  const products: { id: string; title: string; price: number; currency: string }[] = [];
  let after: string | null = null;

  for (let page = 0; page < 10; page++) {
    const data = await shopifyFetch<ProductsResponse>(QUERY, after ? { after } : {});
    for (const { node } of data.products.edges) {
      const min = node.priceRangeV2.minVariantPrice;
      products.push({
        id: node.id,
        title: node.title,
        price: parseFloat(min.amount),
        currency: min.currencyCode,
      });
    }
    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
  }

  return NextResponse.json({ products });
}
```

- [ ] **Step 2: Type-check**

```bash
rtk tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Smoke-test the route manually**

Start dev server and open the embedded app. In browser devtools console run:
```js
fetch('/api/market-intelligence/our-products').then(r=>r.json()).then(console.log)
```
Expected: `{ products: [ { id, title, price, currency }, ... ] }` with real Shopify products.

- [ ] **Step 4: Commit**

```bash
git add app/api/market-intelligence/our-products/route.ts
git commit -m "feat(market-intel): add our-products API route from Shopify"
```

---

### Task 2: Fuzzy-matching utility + PriceComparisonCard component

**Files:**
- Modify: `app/(embedded)/(market-intelligence)/market-intelligence/components.tsx`

**Interfaces:**
- Consumes:
  ```ts
  // OurProduct from Task 1
  interface OurProduct { id: string; title: string; price: number; currency: string }
  // ShoppingResult already typed in page.tsx as:
  interface ShoppingResult {
    id: string; title: string; titleEn?: string | null;
    price?: number | null; currency?: string | null; store?: string | null;
    capturedAt: string;
  }
  ```
- Produces (exported from components.tsx):
  ```ts
  export function scoreMatch(ourTitle: string, competitorTitle: string): number
  export function findMatches(
    product: OurProduct,
    results: ShoppingResult[],
    opts?: { threshold?: number; limit?: number }
  ): ShoppingResult[]
  export function PriceComparisonCard(props: {
    product: OurProduct;
    matches: ShoppingResult[];
  }): JSX.Element
  ```

- [ ] **Step 1: Add the ShoppingResult type import guard**

At the top of `components.tsx`, the `ShoppingResult` interface is already defined in `page.tsx`. Rather than duplicating it, add a local minimal interface to `components.tsx` for the types we need:

Append after the existing imports in `components.tsx`:

```ts
export interface OurProduct {
  id: string;
  title: string;
  price: number;
  currency: string;
}

interface CompetitorResult {
  id: string;
  title: string;
  titleEn?: string | null;
  price?: number | null;
  currency?: string | null;
  store?: string | null;
}
```

- [ ] **Step 2: Add the scoring utility**

Append to `components.tsx`:

```ts
const STOP_WORDS = new Set([
  "the","a","an","and","of","for","with","in","on","at","to","by",
  "kg","g","ml","l","pack","set","pcs","pc","piece","pieces","box",
]);

function tokenise(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1 && !STOP_WORDS.has(t))
  );
}

export function scoreMatch(ourTitle: string, competitorTitle: string): number {
  const a = tokenise(ourTitle);
  const b = tokenise(competitorTitle);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared); // Jaccard
}

export function findMatches(
  product: OurProduct,
  results: CompetitorResult[],
  { threshold = 0.25, limit = 5 }: { threshold?: number; limit?: number } = {},
): CompetitorResult[] {
  return results
    .map(r => ({ r, score: scoreMatch(product.title, r.titleEn ?? r.title) }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r }) => r)
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)); // cheapest first
}
```

- [ ] **Step 3: Add the PriceComparisonCard component**

Append to `components.tsx`:

```ts
function marketBadge(ourPrice: number, matches: CompetitorResult[]): {
  label: string; tone: "success" | "warning" | "info";
} | null {
  const prices = matches.map(m => m.price).filter((p): p is number => p != null);
  if (prices.length === 0) return null;
  const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
  if (ourPrice < avg * 0.97) return { label: "Below avg ↓", tone: "success" };
  if (ourPrice > avg * 1.03) return { label: "Above avg ↑", tone: "warning" };
  return { label: "At market", tone: "info" };
}

export function PriceComparisonCard({
  product,
  matches,
}: {
  product: OurProduct;
  matches: CompetitorResult[];
}) {
  const badge = marketBadge(product.price, matches);
  const fmt = (price: number | null | undefined, currency: string | null | undefined) =>
    price == null ? "-" : `${currency ?? ""} ${price.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="050">
            <Text variant="headingSm" as="h3">{product.title}</Text>
            <Text as="p" tone="subdued">Our price: {fmt(product.price, product.currency)}</Text>
          </BlockStack>
          {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
        </InlineStack>
        {matches.length === 0 ? (
          <Text as="p" tone="subdued" variant="bodySm">No comparable products found in current data range.</Text>
        ) : (
          <BlockStack gap="100">
            {matches.map(m => (
              <InlineStack key={m.id} align="space-between" blockAlign="center">
                <Text as="span" variant="bodySm">{m.store ?? "Unknown store"} — {m.titleEn ?? m.title}</Text>
                <Text as="span" variant="bodySm">{fmt(m.price, m.currency)}</Text>
              </InlineStack>
            ))}
            <Text as="p" tone="subdued" variant="bodySm">Matched by title similarity</Text>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
```

- [ ] **Step 4: Type-check**

```bash
rtk tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add app/\(embedded\)/\(market-intelligence\)/market-intelligence/components.tsx
git commit -m "feat(market-intel): add fuzzy matching util and PriceComparisonCard"
```

---

### Task 3: Wire price comparison into the Market Intelligence page

**Files:**
- Modify: `app/(embedded)/(market-intelligence)/market-intelligence/page.tsx`

**Interfaces:**
- Consumes from Task 1: `GET /api/market-intelligence/our-products` → `{ products: OurProduct[] }`
- Consumes from Task 2: `findMatches`, `PriceComparisonCard`, `OurProduct` from `components.tsx`
- Consumes existing: `ShoppingResult` type and `data?.shoppingResults` already in scope

- [ ] **Step 1: Add OurProduct import and our-products state**

In `page.tsx`, update the import from `components.tsx` to include the new exports:

```ts
import {
  AdCreativeCard,
  InsightCard,
  OurProduct,           // add
  PriceComparisonCard,  // add
  findMatches,          // add
  SEVERITY_RANK,
  adRunningDays,
  relativeTime,
  severityTone,
  shortDate,
} from "./components";
```

Then inside the component body, after the existing `useState` calls, add:

```ts
const [ourProducts, setOurProducts] = useState<OurProduct[]>([]);
const [ourProductsLoading, setOurProductsLoading] = useState(false);
```

- [ ] **Step 2: Fetch our products on mount**

After the existing `load` callback, add a new `loadOurProducts` effect:

```ts
useEffect(() => {
  setOurProductsLoading(true);
  authFetch("/api/market-intelligence/our-products")
    .then(r => r.json())
    .then((d: { products: OurProduct[] }) => setOurProducts(d.products ?? []))
    .catch(() => setOurProducts([]))
    .finally(() => setOurProductsLoading(false));
}, [authFetch]);
```

- [ ] **Step 3: Compute price comparison data**

After the existing `adCards` useMemo, add:

```ts
const priceComparisons = useMemo(() =>
  ourProducts.map(product => ({
    product,
    matches: findMatches(product, data?.shoppingResults ?? []),
  })),
  [ourProducts, data?.shoppingResults],
);
```

- [ ] **Step 4: Add the Price Comparison Layout.Section**

Find the closing `</Layout>` tag at the bottom of the JSX return. Just before it, add a new section:

```tsx
{/* Price comparison */}
<Layout.Section>
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
    ) : (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {priceComparisons.map(({ product, matches }) => (
          <PriceComparisonCard key={product.id} product={product} matches={matches} />
        ))}
      </div>
    )}
  </BlockStack>
</Layout.Section>
```

- [ ] **Step 5: Type-check**

```bash
rtk tsc --noEmit
```
Expected: no errors

- [ ] **Step 6: Manual smoke-test**

Open the Market Intelligence page in the embedded app.
- Confirm the "Price comparison" section renders below the competitor ads section
- Confirm each of your Shopify products appears as a card
- Confirm competitor prices appear under products with matches
- Confirm the badge (Below avg / At market / Above avg) shows on each card
- Confirm cards with no matches show "No comparable products found in current data range"
- Toggle the date range filter and confirm shopping results (and therefore matches) update

- [ ] **Step 7: Commit**

```bash
git add app/\(embedded\)/\(market-intelligence\)/market-intelligence/page.tsx
git commit -m "feat(market-intel): add price comparison section to market intelligence page"
```
