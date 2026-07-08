# Task 7 Report — Docs + Push half (Steps 1-3 only)

Status: DONE (Steps 1-3 only; Steps 4-6 explicitly NOT attempted)

## Step 1: docs/CRON.md diff

Added schedule row (after the `Mon 05:50 fetch-gsc-data` row, before `06:00 execute-approved`):

```diff
 | Mon 05:50 | `/api/cron/fetch-gsc-data` | Captures query+page GSC rows into `GscQuery` for historical search analytics |
+| 04:15 | `/api/cron/fetch-orders` | Ingests yesterday's Shopify orders into DailySales (+28-day backfill on first run) |
 | 06:00 | `/api/cron/execute-approved` | Dry-runs approved execution queue unless live execution is explicitly enabled |
```

Added detail section (before the `### /api/cron/execute-approved` section):

```markdown
### `/api/cron/fetch-orders`
Calls `lib/connectors/shopify-orders.ts` (paginated Admin API) to pull yesterday's Shopify orders, excluding cancelled orders from revenue. Requires the `read_orders` scope on the client-credentials token — verified once via `scripts/check-order-scopes.ts` before this job was enabled, not re-checked per run. Writes a `shopify_orders` `RawSnapshot` per run and upserts one `DailySales` row per calendar day (compound-unique on date, so re-running the same day is idempotent — no duplicate rows). On the very first run (no existing `DailySales` rows), it backfills the trailing 28 days instead of just yesterday.
```

Note: checked the actual job code (`jobs/fetch-orders.ts`) and scope-gate script (`scripts/check-order-scopes.ts`) before writing this — the real implementation is a one-time pre-flight gate script run before the job was wired up (Task 1), not a runtime `disabledSources` check inside `fetch-orders.ts`. Worded the doc to match actual behavior.

## Step 2: .mex/ROUTER.md diff

Bumped `last_updated: 2026-07-03T22:30:00Z` → `2026-07-04T00:00:00Z`.

Added new bullet at the top of "Current Project State → Working":

```markdown
- **Shopify Orders Ingestion (Phase 4, 2026-07-04, docs/gate done — deploy pending operator go-ahead)**: new additive `DailySales` model (migration `20260703..._add_daily_sales`, NOT yet applied to prod — no local dev DB either) stores one row per calendar day with revenue as `Float`, not `Decimal` (house precedent for money fields on this project, documented as a deliberate choice, not an oversight). `lib/connectors/shopify-orders.ts` pulls paginated Shopify orders; `jobs/fetch-orders.ts` + `/api/cron/fetch-orders` (04:15 UTC, own job rather than folded into the 01:00 `daily` route because Shopify's day isn't meaningfully complete by 01:00 and that route is already crowded) upserts `DailySales` idempotently per day (compound-unique key — re-running the same day never duplicates), backfills 28 days on first run else just yesterday, excludes cancelled orders from revenue, and snapshots raw pages as `shopify_orders` `RawSnapshot`s. `read_orders` scope was verified once via `scripts/check-order-scopes.ts` (Task 1 hard gate) before any of this was wired up. Dashboard Performance row gained a `revenueVsMeta` card comparing Shopify revenue against Meta ad spend over the same aligned window; `check-outcomes`' KB context gained an advisory (non-blocking) `storeRevenue` field so skill runs can see revenue trend without it affecting outcome verdicts. See `docs/CRON.md` for the job description. **Deploy (migration + cron install + live acceptance) is explicitly deferred to operator go-ahead — do not run `db:migrate` on prod or install the `/etc/cron.d/autopilot` entry until told to.**
```

## Step 3: Final gate

- `npx tsc --noEmit` → `TypeScript: No errors found`
- `npm test` → `Test Files 117 passed (117)`, `Tests 713 passed (713)`, Duration 11.05s
- `npm run build` → completed clean, full route manifest emitted, no errors

All three gates clean/green.

## Commit + push

```
git add docs/CRON.md .mex/ROUTER.md
git commit -m "docs: fetch-orders cron + ROUTER state for Phase 4"
git push origin main
```

Commit SHA: `d062806`
Push result: `a33246b..d062806  main -> main` — pushed successfully to `https://github.com/d2gdev/AgrikoPh-autopilot.git`, remote `main` now at `d062806`.

## Confirmation: Steps 4-6 NOT touched

- No `ssh` to prod was run.
- No deploy script (`node scripts/linode-deploy.mjs`) was run.
- No `npm run db:migrate` was run anywhere (local or prod).
- `/etc/cron.d/autopilot` was not touched.
- No live acceptance curl against the cron endpoint was run.

Stopping here per instructions — operator go-ahead required before Steps 4-6.

---

**Note:** This file previously held a report for an unrelated earlier task also numbered "Task 7" (outcome badges on the Recommendations page, commit `acf17ee`). That work is untouched on disk/in git history — only this report file was overwritten to reflect the current Phase 4 dispatch.

---

# Task 7 Report — Organic priority scoring (2026-07-09)

Status: DONE

## Implementation notes

- `lib/content-pilot/generate-proposals.ts`
  - Applied `scoreOrganicOpportunity()` to GSC CTR-gap proposals, GSC new-content gaps, and market-intel keyword-gap proposals.
  - Stored scorer output at `sourceData.organicPriority`.
  - Emitted scorer-derived `priorityScore`, `priority`, `impact`, and `effort` for those proposal types.
  - Kept existing local scoring for non-organic proposal types and left dedupe/routing behavior unchanged.
- `lib/opportunities/generate.ts`
  - `opportunityFromProposal()` now prefers persisted `sourceData.organicPriority` for `score`, `priority`, `impact`, and `effort`.
  - Preserved the original proposal score at `evidence.score`.
- `lib/opportunities/route.ts`
  - No behavior change required; existing `P0 -> P1` ContentProposal mapping remains the routing contract.
- Tests
  - Added/updated regressions covering proposal ordering, proposal evidence persistence, opportunity score mapping, preserved original score, and router priority mapping.

## Exact command outputs

### `npm test -- generate-proposals`

```text
> agriko-autopilot@0.1.0 test
> vitest run generate-proposals

 RUN  v4.1.8 /home/sean/Agriko/auto-pilot


 Test Files  1 passed (1)
      Tests  13 passed (13)
   Start at  04:46:49
   Duration  766ms (transform 264ms, setup 0ms, import 390ms, tests 40ms, environment 0ms)
```

### `npm test -- content-pilot`

```text
> agriko-autopilot@0.1.0 test
> vitest run content-pilot

 RUN  v4.1.8 /home/sean/Agriko/auto-pilot


 Test Files  9 passed (9)
      Tests  57 passed (57)
   Start at  04:47:04
   Duration  4.99s (transform 2.64s, setup 0ms, import 5.73s, tests 1.29s, environment 16ms)
```

### `npm test -- opportunities`

```text
> agriko-autopilot@0.1.0 test
> vitest run opportunities

 RUN  v4.1.8 /home/sean/Agriko/auto-pilot

 Test Files  4 passed (4)
      Tests  34 passed (34)
   Start at  04:46:55
   Duration  1.42s (transform 1.04s, setup 0ms, import 1.52s, tests 135ms, environment 2ms)
```

### `npx tsc --noEmit`

```text
(no output; exit code 0)
```

## Follow-up fix: clamp direct ContentProposal priority to UI contract (2026-07-09)

Status: DONE

### Fix notes

- `lib/content-pilot/generate-proposals.ts`
  - Added a proposal-facing priority clamp for organic-scored proposals so generated `ContentProposal.priority` never exceeds the existing UI contract.
  - `organicProposalFields()` now maps scorer `P0 -> P1` while leaving `priorityScore`, `impact`, `effort`, and the preserved `sourceData.organicPriority` payload unchanged.
- `__tests__/lib/content-pilot/generate-proposals.test.ts`
  - Added a regression covering the direct generation path: a high-scoring GSC CTR-gap proposal now asserts returned `priority: "P1"` while `sourceData.organicPriority.priority` remains `"P0"`.

### Exact command outputs

#### `npm test -- generate-proposals`

```text
> agriko-autopilot@0.1.0 test
> vitest run generate-proposals


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot


 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  04:53:45
   Duration  971ms (transform 333ms, setup 0ms, import 541ms, tests 48ms, environment 0ms)
```

#### `npm test -- content-pilot`

```text
> agriko-autopilot@0.1.0 test
> vitest run content-pilot


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot


 Test Files  9 passed (9)
      Tests  58 passed (58)
   Start at  04:53:55
   Duration  4.01s (transform 1.98s, setup 0ms, import 4.34s, tests 1.01s, environment 3ms)
```

#### `npm test -- opportunities`

```text
> agriko-autopilot@0.1.0 test
> vitest run opportunities


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot


 Test Files  4 passed (4)
      Tests  34 passed (34)
   Start at  04:53:55
   Duration  2.42s (transform 1.86s, setup 0ms, import 2.74s, tests 228ms, environment 1ms)
```

#### `npx tsc --noEmit`

```text
(no output; exit code 0)
```
