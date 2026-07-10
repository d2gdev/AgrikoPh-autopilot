# SEO Pilot No-Horizontal-Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every horizontal-scroll requirement from SEO Pilot while preserving all data, sorting, filters, and operator actions.

**Architecture:** Replace the shared Polaris table renderer with a contained semantic table on wide screens and labelled stacked records below the extra-large breakpoint. Add a responsive SEO navigation component that swaps the nine-tab strip for a full-width select on constrained screens, then harden panel control/action rows so every child may shrink or wrap.

**Tech Stack:** Next.js 15, React 18, TypeScript, Shopify Polaris 13, CSS Modules, Vitest.

## Global Constraints

- SEO Pilot must not require horizontal scrolling at 320, 375, 768, 1024, or 1440 pixels.
- Preserve every field, sort option, filter, link, and operator action.
- Keep desktop presentation tabular when the available layout is genuinely wide enough.
- Do not hide or clip content to satisfy the layout.
- Do not change APIs, permissions, publishing, authentication, guardrails, database schema, or Shopify/Meta behavior.

---

### Task 1: Contained responsive table primitive

**Files:**
- Create: `app/(embedded)/components/ResponsiveDataTable.module.css`
- Modify: `app/(embedded)/components/ResponsiveDataTable.tsx`
- Test: `__tests__/components/seo-pilot-responsive.test.ts`

**Interfaces:**
- Consumes: existing `headings`, `rows`, `columnContentTypes`, `sortable`, `onSort`, `compactSortIndex`, and `compactSortDirection` props.
- Produces: the same `ResponsiveDataTable` public API, with a semantic fixed-layout desktop table at `xlUp` and labelled stacked records below `xlUp`.

- [ ] **Step 1: Write the failing responsive primitive contract**

Add a source-level regression that asserts the shared component imports its CSS module, selects `xlUp`, uses `tableLayout: fixed` through the CSS class, and gives both labels and values shrink/wrap containers. Assert it no longer imports Polaris `DataTable`.

- [ ] **Step 2: Run the regression and verify RED**

Run: `npm test -- --run __tests__/components/seo-pilot-responsive.test.ts`

Expected: FAIL because the CSS module, `xlUp`, and contained semantic table do not exist.

- [ ] **Step 3: Implement the responsive primitive**

Create CSS classes equivalent to:

```css
.table { width: 100%; table-layout: fixed; border-collapse: collapse; }
.heading, .cell { min-width: 0; padding: var(--p-space-200); overflow-wrap: anywhere; word-break: break-word; }
.stackedRow, .stackedCell, .label, .value { min-width: 0; max-width: 100%; }
.value { overflow-wrap: anywhere; word-break: break-word; }
.sortControls { display: flex; flex-wrap: wrap; min-width: 0; }
```

In the component, use `useBreakpoints({ defaults: { xlUp: true } })`. Render a semantic `<table>` only at `xlUp`; sortable headings are buttons that cycle ascending, descending, and none through the existing callback. Render compact rows as CSS-grid label/value records and retain the existing compact select and direction button.

- [ ] **Step 4: Run the regression and verify GREEN**

Run: `npm test -- --run __tests__/components/seo-pilot-responsive.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add __tests__/components/seo-pilot-responsive.test.ts app/'(embedded)'/components/ResponsiveDataTable.tsx app/'(embedded)'/components/ResponsiveDataTable.module.css
git commit -m "fix(ui): contain responsive SEO data rows"
```

### Task 2: Responsive SEO navigation and panel controls

**Files:**
- Create: `app/(embedded)/(seo-pillar)/seo-pillar/components/SeoPilotNavigation.tsx`
- Create: `app/(embedded)/(seo-pillar)/seo-pillar/components/seo-pilot-responsive.module.css`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OpportunitiesPanel.tsx`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/KeywordsPanel.tsx`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/ContentGapsPanel.tsx`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OpportunityClustersPanel.tsx`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/StrategyPanel.tsx`
- Test: `__tests__/components/seo-pilot-responsive.test.ts`

**Interfaces:**
- Consumes: `tabs: { id: string; content: string }[]`, `selected: number`, and `onSelect(index: number): void`.
- Produces: `SeoPilotNavigation`, rendering Polaris `Tabs` at `xlUp` and a labelled full-width Polaris `Select` below it.

- [ ] **Step 1: Extend the failing contract across all panels**

Assert the page renders `SeoPilotNavigation`, contains no raw `Tabs` or `DataTable`, and all nine panel files use `ResponsiveDataTable` for data grids. Assert SEO panel sources contain no `overflowX`, fixed numeric `minWidth`, or `wrap={false}`. Assert the responsive stylesheet defines shrinkable control/action wrappers.

- [ ] **Step 2: Run the regression and verify RED**

Run: `npm test -- --run __tests__/components/seo-pilot-responsive.test.ts`

Expected: FAIL on raw tabs, fixed minimum widths, and non-wrapping action rows.

- [ ] **Step 3: Implement responsive navigation**

Create `SeoPilotNavigation` using `useBreakpoints({ defaults: { xlUp: true } })`. Render `<Tabs ... />` for `xlUp`; otherwise render a full-width `<Select label="SEO Pilot view" ... onChange={(value) => onSelect(Number(value))} />`. Replace the page's raw Tabs usage and remove unused wide-table imports.

- [ ] **Step 4: Harden panel control and action rows**

Use CSS module wrappers with `flex: 1 1 100%`, `min-width: 0`, and `max-width: 100%` for search, filter, and keyword inputs. Change Content Gaps quick-win/recommendation rows and Strategy primary-target actions from `wrap={false}` to wrapping layouts. Add wrapping to nested Opportunity Cluster badge groups. Preserve all callbacks and content.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm test -- --run __tests__/components/seo-pilot-responsive.test.ts __tests__/components/pilot-usability-helpers.test.ts`

Expected: both files pass with no failures.

- [ ] **Step 6: Commit Task 2**

```bash
git add __tests__/components/seo-pilot-responsive.test.ts app/'(embedded)'/'(seo-pillar)'/seo-pillar
git commit -m "fix(seo): remove compact horizontal overflow"
```

### Task 3: Verification, review, GROW, and integration

**Files:**
- Modify: `.mex/ROUTER.md`
- Modify: `.mex/patterns/seo-pilot-proposal-actions.md`
- Modify: `.mex/events/decisions.jsonl` through `mex log`

**Interfaces:**
- Consumes: completed responsive components and tests from Tasks 1 and 2.
- Produces: verified, documented, merged SEO Pilot responsive behavior.

- [ ] **Step 1: Run focused and full verification**

Run:

```bash
npm test -- --run __tests__/components/seo-pilot-responsive.test.ts __tests__/components/pilot-usability-helpers.test.ts
npm test
npm run typecheck
npm run typecheck:test
npm run lint
npm run verify:prisma-client
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/autopilot_test?schema=seo_pilot_responsive&connection_limit=1&pool_timeout=3' npx prisma validate
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/autopilot_test?schema=seo_pilot_responsive&connection_limit=1&pool_timeout=3' npm run build
git diff --check
```

Expected: tests, typechecks, Prisma checks, build, and diff check exit 0; lint has zero errors. Existing unrelated warnings are recorded separately.

- [ ] **Step 2: Perform specification and code-quality review**

Review the complete branch against the approved design. Confirm all nine panels, navigation, filters, sort controls, long content, and actions are covered. Resolve every initial finding and rerun its focused verification. Do not perform redundant review loops.

- [ ] **Step 3: Complete GROW**

Add a dated Router entry, extend the SEO Pilot pattern with the no-horizontal-scroll contract, bump scaffold dates when needed, and run:

```bash
mex log --type decision "SEO Pilot uses contained desktop tables and stacked compact records so navigation, data, filters, and actions never require horizontal scrolling."
```

- [ ] **Step 4: Commit final documentation**

```bash
git add .mex/ROUTER.md .mex/patterns/seo-pilot-proposal-actions.md .mex/events/decisions.jsonl
git commit -m "docs: record SEO Pilot responsive contract"
```

- [ ] **Step 5: Verify and integrate**

Confirm the feature worktree is clean and contains only scoped changes. Fast-forward merge `seo-pilot-no-horizontal-scroll` into clean local `main`, push `main`, confirm local and remote SHAs match, and remove the temporary worktree and branch. Do not deploy.
