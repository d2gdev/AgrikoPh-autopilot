# Phase 4 — Shopify Orders Ingestion + Real-Revenue ROAS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⚠️ Task 1 is a hard gate** — if `read_orders` is missing from the token's scopes, STOP the whole phase and surface to the operator. **⚠️ Task 7's deploy requires the operator's explicit go-ahead** — Sonnet stops before it.

**Goal:** The store's actual sales become ground truth: a daily `DailySales` series ingested from Shopify orders, a dashboard card comparing real Shopify revenue against Meta-reported conversion value over the same period, and advisory store-revenue context on recommendation outcomes.

**Architecture:** New connector `lib/connectors/shopify-orders.ts` (reuses `shopifyFetch` from `lib/shopify-admin.ts`, cursor pagination cloned from `fetchProductImages`), new sibling job `jobs/fetch-orders.ts` + cron route at 04:15 (before the 05:00 ads fetch), one additive migration (`DailySales`), plus `RawSnapshot` rows with `source: "shopify_orders"` per day-window (the model's `@@unique([source, dateRangeStart, dateRangeEnd])` makes per-day upserts natural). Consumers: `JobsStatusPayload.revenueVsMeta` + one Performance-row card, and an advisory `storeRevenue` field on `OutcomePayload`.

**Tech Stack:** Next.js 14 App Router, Prisma/PostgreSQL, Shopify Admin GraphQL **2025-01** (`shopifyFetch` pin), Vitest, `tsx` for one-shot scripts (existing precedent: `scripts/*.ts`, `db:seed`).

## Global Constraints

- **Keyword Planner is untouchable** (user directive, clarified 2026-07-03: the "no Google Ads" ban covers advertising only, never keyword research). Nothing here touches `lib/connectors/google-ads.ts`, `jobs/fetch-keyword-research.ts`, the `google_ads_keyword_research` connector-health entry, `GOOGLE_ADS_*` env vars, or skill 46. If any step appears to require it, stop and surface to the operator.
- Migration is **additive only** (one new model). `prisma migrate deploy` runs on prod via `.mex/patterns/deploy.md` (`npm run db:migrate` on the server) — deploy is Task 7 and gated on the operator.
- Read-only external access: this phase only READS Shopify orders. No write path of any kind is added.
- Query shapes verified via the shopify-plugin doc search (local validator broken, as in Phases 2–3): `currentAppInstallation { accessScopes { handle } }` is the doc-exact scope check; `orders(first:, after:, query:)` with `createdAt`, `cancelledAt`, `displayFinancialStatus`, `currentTotalPriceSet { shopMoney { amount currencyCode } }`, `lineItems { ... product { id } }` all exist (verified on 2025-10 docs; all are long-stable fields present at the 2025-01 pin — `LineItem.product` is nullable for deleted/custom items, handle it).
- **Money is `Float`, not the roadmap's `Decimal`** — documented deviation: the schema has zero `Decimal` usage and stores PHP amounts as `Float` (`estimatedValuePhp`); introducing Prisma `Decimal` would add Decimal.js objects to every consumer path for no accounting requirement we have. Follow house precedent.
- All DB access via `import { prisma } from "@/lib/db"`. Cron route clones the `run-skills` route shape (`requireCronAuth` → `acquireJobLock` → handler → `jobResponse`).
- Verify gate: `npx tsc --noEmit` clean, `npm test` green, `npm run build` clean. New job/connector logic gets Vitest coverage.
- After code tasks: update `.mex/ROUTER.md`, commit + push. 🚀 **Deploy checkpoint at Task 7** (Phases 2–3 ride along) — operator go-ahead required.

---

### Task 1 (GATE): Verify the token carries `read_orders`

**Files:**
- Create: `scripts/check-order-scopes.ts`

- [ ] **Step 1: Write the probe**

```typescript
// scripts/check-order-scopes.ts — Phase 4 gate: the client-credentials token must
// carry read_orders (or read_all_orders) before any orders work proceeds.
// Run: npx tsx scripts/check-order-scopes.ts
import { shopifyFetch } from "../lib/shopify-admin";

const data = await shopifyFetch<{
  currentAppInstallation: { accessScopes: Array<{ handle: string }> };
}>(`query AccessScopeList { currentAppInstallation { accessScopes { handle } } }`);

const scopes = data.currentAppInstallation.accessScopes.map((s) => s.handle);
console.log("Granted scopes:", scopes.join(", "));

if (scopes.includes("read_orders") || scopes.includes("read_all_orders")) {
  console.log("✓ read_orders present — Phase 4 may proceed");
} else {
  console.error("✗ read_orders MISSING. STOP Phase 4. Operator action needed:");
  console.error("  Shopify admin → Settings → Apps and sales channels → Develop apps →");
  console.error("  [this app] → Configuration → Admin API integration → add read_orders scope,");
  console.error("  save, then re-mint the token (next shopifyFetch 401-refresh picks it up).");
  process.exit(1);
}
```

(If the relative import fails under tsx because of the `@/` path config, use the same relative-import style as the existing `scripts/*.ts` files — read one first.)

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/check-order-scopes.ts`
Expected: `✓ read_orders present`. **If it exits 1: STOP the entire phase, commit only this script, and report the missing scope to the operator — do not proceed to Task 2.** (Note: `read_orders` covers the last 60 days of orders, which comfortably covers the 28-day backfill; `read_all_orders` is not needed.)

- [ ] **Step 3: Commit**

```bash
git add scripts/check-order-scopes.ts
git commit -m "feat(scripts): read_orders scope gate for Phase 4"
```

---

### Task 2: `DailySales` migration (additive)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: generated migration under `prisma/migrations/`

- [ ] **Step 1: Add the model**

```prisma
model DailySales {
  id        String   @id @default(cuid())
  date      DateTime @unique // UTC midnight of the day the sales occurred
  orders    Int
  revenue   Float    // house precedent: PHP amounts are Float (see estimatedValuePhp)
  aov       Float
  currency  String
  fetchedAt DateTime @updatedAt

  @@index([date])
}
```

- [ ] **Step 2: Generate and apply locally**

Run: `npx prisma migrate dev --name daily_sales` — expect one additive `CREATE TABLE`.
Run: `npm run db:generate`.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit` — clean.

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): DailySales daily revenue aggregates (additive)"
```

---

### Task 3: Orders connector

**Files:**
- Create: `lib/connectors/shopify-orders.ts`
- Test: `__tests__/lib/connectors/shopify-orders.test.ts`

**Interfaces:**
- Produces: `fetchOrdersWindow(range: { start: Date; end: Date }): Promise<{ orders: OrderRow[]; currency: string | null }>` where `OrderRow = { id: string; createdAt: string; cancelled: boolean; financialStatus: string | null; total: number; productIds: string[] }`. Pagination mirrors `fetchProductImages` (cursor loop, `MAX_PAGES` guard). `currency` is taken from the first order's `currencyCode` (single-currency store).

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/connectors/shopify-orders.test.ts`, mocking `@/lib/shopify-admin`'s `shopifyFetch` (mirror `__tests__/lib/content-pilot/publish-draft.test.ts`'s `vi.mock` style):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/shopify-admin", () => ({ shopifyFetch: vi.fn() }));

import { shopifyFetch } from "@/lib/shopify-admin";
import { fetchOrdersWindow } from "@/lib/connectors/shopify-orders";

const order = (id: string, amount: string, cancelled = false) => ({
  node: {
    id: `gid://shopify/Order/${id}`,
    createdAt: "2026-07-02T03:00:00Z",
    cancelledAt: cancelled ? "2026-07-02T04:00:00Z" : null,
    displayFinancialStatus: "PAID",
    currentTotalPriceSet: { shopMoney: { amount, currencyCode: "PHP" } },
    lineItems: { edges: [{ node: { product: { id: "gid://shopify/Product/9" } } }, { node: { product: null } }] },
  },
});

describe("fetchOrdersWindow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("paginates, parses money, tolerates null products, flags cancellations", async () => {
    vi.mocked(shopifyFetch)
      .mockResolvedValueOnce({
        orders: { pageInfo: { hasNextPage: true, endCursor: "c1" }, edges: [order("1", "540.00")] },
      })
      .mockResolvedValueOnce({
        orders: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [order("2", "225.50", true)] },
      });

    const result = await fetchOrdersWindow({ start: new Date("2026-07-02T00:00:00Z"), end: new Date("2026-07-03T00:00:00Z") });
    expect(result.orders).toHaveLength(2);
    expect(result.orders[0]).toMatchObject({ total: 540, cancelled: false, productIds: ["gid://shopify/Product/9"] });
    expect(result.orders[1]!.cancelled).toBe(true);
    expect(result.currency).toBe("PHP");
    const firstQueryVars = vi.mocked(shopifyFetch).mock.calls[0]![1] as Record<string, unknown>;
    expect(String(firstQueryVars.query)).toContain("created_at:>=");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/connectors/shopify-orders.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `lib/connectors/shopify-orders.ts`**

```typescript
import { shopifyFetch } from "@/lib/shopify-admin";

export interface OrderRow {
  id: string;
  createdAt: string;
  cancelled: boolean;
  financialStatus: string | null;
  total: number;
  productIds: string[];
}

interface OrdersResponse {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        createdAt: string;
        cancelledAt: string | null;
        displayFinancialStatus: string | null;
        currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
        lineItems: { edges: Array<{ node: { product: { id: string } | null } }> };
      };
    }>;
  };
}

const QUERY = `
  query OrdersWindow($after: String, $query: String!) {
    orders(first: 100, after: $after, query: $query, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          createdAt
          cancelledAt
          displayFinancialStatus
          currentTotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          lineItems(first: 50) {
            edges {
              node {
                product {
                  id
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function fetchOrdersWindow(range: {
  start: Date;
  end: Date;
}): Promise<{ orders: OrderRow[]; currency: string | null }> {
  const search = `created_at:>='${range.start.toISOString()}' created_at:<'${range.end.toISOString()}'`;
  const orders: OrderRow[] = [];
  let currency: string | null = null;
  let after: string | null = null;
  let page = 0;
  const MAX_PAGES = 30; // 3,000 orders/window guard — far above daily volume

  do {
    const data: OrdersResponse = await shopifyFetch<OrdersResponse>(QUERY, { after, query: search });
    for (const { node } of data.orders.edges) {
      const money = node.currentTotalPriceSet?.shopMoney;
      if (money && !currency) currency = money.currencyCode;
      orders.push({
        id: node.id,
        createdAt: node.createdAt,
        cancelled: Boolean(node.cancelledAt),
        financialStatus: node.displayFinancialStatus,
        total: money ? parseFloat(money.amount) || 0 : 0,
        productIds: node.lineItems.edges
          .map((e) => e.node.product?.id)
          .filter((id): id is string => Boolean(id)),
      });
    }
    after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
    if (++page >= MAX_PAGES && after) {
      console.warn(`[shopify-orders] fetchOrdersWindow truncated at ${MAX_PAGES} pages`);
      break;
    }
  } while (after);

  return { orders, currency };
}
```

- [ ] **Step 4: Run the test, then commit**

Run: `npx vitest run __tests__/lib/connectors/shopify-orders.test.ts` — PASS.

```bash
git add lib/connectors/shopify-orders.ts __tests__/lib/connectors/shopify-orders.test.ts
git commit -m "feat(connectors): shopify-orders window fetch with cursor pagination"
```

---

### Task 4: `fetch-orders` job + cron route

**Files:**
- Create: `jobs/fetch-orders.ts`, `app/api/cron/fetch-orders/route.ts`
- Test: `__tests__/jobs/fetch-orders.test.ts`

**Interfaces:**
- Produces: `fetchOrdersHandler(): Promise<JobResult<FetchOrdersSummary>>` with `FetchOrdersSummary = { daysWritten: number; ordersSeen: number; revenueTotal: number; backfilled: boolean }`.
- Behavior: UTC day-bucketed. If `DailySales` is empty → backfill the trailing **28 full days**; otherwise process **yesterday** (UTC). Per day: `fetchOrdersWindow` → non-cancelled orders roll up to `{ orders, revenue, aov }` → `dailySales.upsert` on `date` → `rawSnapshot.upsert` on the `@@unique([source, dateRangeStart, dateRangeEnd])` triple with `source: "shopify_orders"` and a compact payload (`{ orderIds, statuses, productIds per order }`). Idempotent per day by construction (both writes are upserts).

- [ ] **Step 1: Write the failing test**

Create `__tests__/jobs/fetch-orders.test.ts` (mock style mirrors `__tests__/jobs/daily-digest.test.ts`): mock `@/lib/db` (`jobRun.create/update`, `dailySales.count/upsert`, `rawSnapshot.upsert`) and `@/lib/connectors/shopify-orders`. Three tests:
1. `dailySales.count → 5` (non-empty) ⇒ exactly one day processed (yesterday UTC): one `dailySales.upsert` whose `where.date` is yesterday's UTC midnight, revenue excludes cancelled orders, `aov = revenue / orders` (0 orders ⇒ aov 0), one `rawSnapshot.upsert` with `where: { source_dateRangeStart_dateRangeEnd: {...} }`.
2. `dailySales.count → 0` ⇒ `backfilled: true` and 28 `dailySales.upsert` calls.
3. Connector throws ⇒ JobRun marked `failed`, handler returns `status: "failed"` without throwing.

Follow the `add-cron-job` house shape for JobRun lifecycle (create running → update success/failed) exactly as `jobs/daily-digest.ts` does.

- [ ] **Step 2: Run to verify it fails, then implement `jobs/fetch-orders.ts`**

Implementation skeleton (complete the JobRun/error handling by copying `jobs/daily-digest.ts`'s shape):

```typescript
import { prisma } from "@/lib/db";
import { fetchOrdersWindow } from "@/lib/connectors/shopify-orders";
import type { JobResult } from "@/lib/jobs/types";

type FetchOrdersSummary = { daysWritten: number; ordersSeen: number; revenueTotal: number; backfilled: boolean };

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function fetchOrdersHandler(): Promise<JobResult<FetchOrdersSummary>> {
  // jobRun create (jobName: "fetch-orders") … try/catch … per daily-digest shape
  const existing = await prisma.dailySales.count();
  const backfilled = existing === 0;
  const today = utcMidnight(new Date());
  const dayCount = backfilled ? 28 : 1;

  let daysWritten = 0, ordersSeen = 0, revenueTotal = 0;
  for (let i = dayCount; i >= 1; i--) {
    const dayStart = new Date(today.getTime() - i * 24 * 3_600_000);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
    const { orders, currency } = await fetchOrdersWindow({ start: dayStart, end: dayEnd });
    const live = orders.filter((o) => !o.cancelled);
    const revenue = live.reduce((sum, o) => sum + o.total, 0);
    const aov = live.length > 0 ? revenue / live.length : 0;

    await prisma.dailySales.upsert({
      where: { date: dayStart },
      update: { orders: live.length, revenue, aov, currency: currency ?? "PHP" },
      create: { date: dayStart, orders: live.length, revenue, aov, currency: currency ?? "PHP" },
    });
    await prisma.rawSnapshot.upsert({
      where: { source_dateRangeStart_dateRangeEnd: { source: "shopify_orders", dateRangeStart: dayStart, dateRangeEnd: dayEnd } },
      update: { payload: ordersPayload(orders), fetchedAt: new Date() },
      create: { source: "shopify_orders", dateRangeStart: dayStart, dateRangeEnd: dayEnd, payload: ordersPayload(orders) },
    });
    daysWritten++; ordersSeen += orders.length; revenueTotal += revenue;
  }
  // summary + jobRun success update + return
}

function ordersPayload(orders: Array<{ id: string; financialStatus: string | null; total: number; cancelled: boolean; productIds: string[] }>) {
  return { orders: orders.map((o) => ({ id: o.id, financialStatus: o.financialStatus, total: o.total, cancelled: o.cancelled, productIds: o.productIds })) } as object;
}
```

(Check whether `RawSnapshot.upsert`'s compound-unique accessor is named `source_dateRangeStart_dateRangeEnd` by looking at the generated client or an existing compound upsert — `jobs/fetch-market-intel.ts` has upsert precedents. `fetchedAt` has `@default(now())` with no `@updatedAt`; if the update-arm `fetchedAt` field errors, drop it.)

- [ ] **Step 3: Create the cron route**

`app/api/cron/fetch-orders/route.ts` — exact clone of the `run-skills` route shape with `JOB_NAME = "fetch-orders"`, `maxDuration = 300` (28-day backfill makes ~28 sequential windows on first run), calling `fetchOrdersHandler`.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run __tests__/jobs/fetch-orders.test.ts` and `npx tsc --noEmit` — PASS/clean.

```bash
git add jobs/fetch-orders.ts app/api/cron/fetch-orders/route.ts __tests__/jobs/fetch-orders.test.ts
git commit -m "feat(jobs): daily Shopify orders ingestion into DailySales + shopify_orders snapshots"
```

---

### Task 5: Dashboard — Revenue (Shopify) vs conversion value (Meta)

**Files:**
- Modify: `lib/dashboard/jobs-status.ts`, `app/(embedded)/page.tsx`

**Interfaces:**
- Produces: `JobsStatusPayload.revenueVsMeta: { shopifyRevenue: number; metaConversionValue: number | null; periodStart: string; periodEnd: string; daysCovered: number; currency: string } | null`.
- **Window alignment matters**: the latest meta snapshot's insights cover its own ~30-day `dateRangeStart..End`; comparing it against a 7-day Shopify figure would mislead. Compute both over the **meta snapshot's period**: `shopifyRevenue` = sum of `DailySales.revenue` for dates within the snapshot range (`daysCovered` = number of DailySales rows found — the 28-day backfill may not cover the full 30, label honestly); `metaConversionValue` = sum over the snapshot's `payload.insights[].action_values[]` entries where `action_type` is `"purchase"` or `"omni_purchase"` (values are strings — `parseFloat`; return null if the snapshot has no `action_values` at all).

- [ ] **Step 1: Add the field + computation in `buildJobsStatusPayload`**

Follow the Task-8-of-Phase-1 precedent exactly (that task added `outcomeWinRate` to the same function): add the type field, compute alongside the existing queries (the function already loads the latest meta snapshots for `adSpendSummary` — reuse that snapshot object rather than re-querying; **read the surrounding code first** to find its variable name), and populate `revenueVsMeta` (null when there is no meta snapshot or no DailySales rows in range). Leave the `isPayload` validator alone (same reasoning as Phase 1: it checks 3 keys; adding a new required key would invalidate pre-deploy cached snapshots).

- [ ] **Step 2: Add the Performance-row card**

In `app/(embedded)/page.tsx`: add the field to the local payload type, bump the Performance row's loading-skeleton count by one, and append a card after "Ad Spend (Latest)":

```tsx
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Revenue vs Meta (period)</Text>
                        {data?.revenueVsMeta ? (
                          <BlockStack gap="100">
                            <Text variant="heading2xl" as="p">{formatPhp(data.revenueVsMeta.shopifyRevenue, 0)}</Text>
                            <Text as="p" tone="subdued">
                              Shopify ({data.revenueVsMeta.daysCovered}d) vs {data.revenueVsMeta.metaConversionValue != null ? formatPhp(data.revenueVsMeta.metaConversionValue, 0) : "—"} Meta-reported
                            </Text>
                          </BlockStack>
                        ) : (
                          <Text as="p" tone="subdued">No sales data yet — runs after the first fetch-orders cycle</Text>
                        )}
                      </BlockStack>
                    </Card>
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit`, `npm test`, `npm run build` — clean/green (update any jobs-status payload-shape test fixture the same way Phase 1 did).

```bash
git add lib/dashboard/jobs-status.ts "app/(embedded)/page.tsx"
git commit -m "feat(dashboard): Shopify revenue vs Meta conversion value over the snapshot period"
```

---

### Task 6: Advisory store-revenue context on outcomes

**Files:**
- Modify: `jobs/check-outcomes.ts`
- Test: `__tests__/jobs/check-outcomes.test.ts`

- [ ] **Step 1: Extend the outcome payload (advisory only — verdict math untouched)**

**Read the `OutcomePayload` type and the block at ~lines 140–165 first.** Where the outcome object is built, add a `storeRevenue` field: sums of `DailySales.revenue` over the `windowDays` before and after the recommendation's execution timestamp (`prisma.dailySales.aggregate({ _sum: { revenue: true }, where: { date: { gte, lt } } })` twice), `null`s when no rows exist. Shape: `storeRevenue: { before: number | null; after: number | null; windowDays: number }`. It must not influence `result.verdict` in any way — it is context for the operator reading the outcome.

- [ ] **Step 2: Test + commit**

Extend `__tests__/jobs/check-outcomes.test.ts`: add `dailySales: { aggregate: vi.fn() }` to its prisma mock (read the existing mock first) and assert the persisted outcome JSON contains `storeRevenue` with the mocked sums; existing verdict assertions unchanged.

Run: `npx vitest run __tests__/jobs/check-outcomes.test.ts` — PASS.

```bash
git add jobs/check-outcomes.ts __tests__/jobs/check-outcomes.test.ts
git commit -m "feat(outcomes): advisory store-revenue context on recommendation outcomes"
```

---

### Task 7: Docs, ROUTER, gate, push — then 🚀 DEPLOY (operator go-ahead required)

**Files:**
- Modify: `docs/CRON.md`, `.mex/ROUTER.md`
- Prod (deploy half only): `/etc/cron.d/autopilot`, prod migration

- [ ] **Step 1: `docs/CRON.md`** — add the schedule row `| 04:15 | /api/cron/fetch-orders | Ingests yesterday's Shopify orders into DailySales (+28-day backfill on first run) |` and a detail section in the file's format (mention `read_orders` scope, idempotent per-day upserts, `shopify_orders` snapshots).

- [ ] **Step 2: `.mex/ROUTER.md`** — Current Project State bullet (bump `last_updated`): DailySales model, connector/job/cron, `revenueVsMeta` dashboard card, `storeRevenue` outcome context, scope-gate script; note the Float-not-Decimal decision and that revenue excludes cancelled orders.

- [ ] **Step 3: Final gate + push**

Run: `npx tsc --noEmit`, `npm test` (record counts), `npm run build` — clean/green.

```bash
git add docs/CRON.md .mex/ROUTER.md
git commit -m "docs: fetch-orders cron + ROUTER state for Phase 4"
git push origin main
```

**⛔ STOP HERE and report. Everything below runs only after the operator's explicit go-ahead.**

- [ ] **Step 4 (operator-gated): Deploy with migration**

Per `.mex/patterns/deploy.md`: `node scripts/linode-deploy.mjs`, then on the server (`ssh autopilot-prod`, `cd /opt/autopilot`): `npm run db:migrate` (applies the additive `daily_sales` migration), `pm2 restart autopilot`, verify `curl https://autopilot.agrikoph.com/api/health`.

- [ ] **Step 5 (operator-gated): Install the cron entry**

Append to `/etc/cron.d/autopilot`, cloning the exact `fetch-keyword-research` line shape, schedule `15 4 * * *`, path `/api/cron/fetch-orders`.

- [ ] **Step 6 (operator-gated): Live acceptance**

Trigger once via the cron endpoint (same curl-with-CRON_SECRET shape as Phase 1's acceptance). Expected: `status: success`, `backfilled: true`, `daysWritten: 28`. Then verify `DailySales` has 28 rows (`node` one-liner or Prisma studio), and the dashboard Performance row shows the revenue card with real numbers. Re-trigger once more: `daysWritten: 1`, no duplicates (acceptance criterion: idempotent per day).

---

## Self-review notes

- Roadmap coverage: connector with pagination (Task 3), `DailySales` + `shopify_orders` snapshots (Tasks 2/4), sibling-job decision made explicitly (own job + 04:15 cron — the daily 01:00 route runs before Shopify's day is meaningfully complete and is already crowded), yesterday+28-day-backfill semantics (Task 4), dashboard comparison (Task 5, window-aligned), check-outcomes revenue context (Task 6), scope gate first (Task 1, hard stop), deploy with migration at the checkpoint (Task 7, operator-gated). ✔
- Contradictions/decisions vs the sketch: no `shopify.app.toml` exists (not a CLI app) — scope verification is the runtime `currentAppInstallation` query, and scope expansion is an operator dashboard action; `Decimal` → `Float` per house precedent (documented); the comparison card aligns windows to the meta snapshot period instead of naively mixing a 7-day and 30-day figure; revenue excludes cancelled orders (defined, not left implicit).
- No placeholders: the two skeleton regions in Task 4 explicitly name their copy-from source (`jobs/daily-digest.ts` JobRun shape); read-before-edit spots are flagged (compound-upsert accessor name, adSpendSummary snapshot variable, OutcomePayload type, check-outcomes mock).
- Type consistency: `OrderRow` matches connector test assertions; `revenueVsMeta` shape identical across payload type, computation, and card; `FetchOrdersSummary` fields match the acceptance expectations in Task 7 Step 6.
- Keyword Planner surface untouched by every task; read-only Shopify access; single additive migration.
