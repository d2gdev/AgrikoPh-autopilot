# Phase 8a — Content-Pilot Page Split (+ its Phase 9 fold-in) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `app/(embedded)/(content-pilot)/content-pilot/page.tsx` (exactly 1,820 lines — the roadmap's estimate was precise) becomes < 400 lines of composition over co-located components, with **zero behavior change**, plus this page's Phase 9 a11y/theming retrofit (which fact-finding shrank to almost nothing — see below).

**Architecture — what fact-finding found (this reshapes the work):**
1. **The page is already three prop-isolated tab components defined in-file**: `OverviewTab` (lines 197–342), `QueueTab` (343–1395, ~1,053 lines — the real monolith), `BriefTab` (1396–1613), preceded by shared helpers/badges (99–196) and followed by the default `ContentPilotPage` (1614–1820) which owns only Overview data, tab selection (with a `?tab=` URL restore effect), and error/index state. `QueueTab` and `BriefTab` already receive exactly `{ authFetch, active }` and own all their state. **The split is therefore: verbatim file moves for three tabs + helpers, and an internal decomposition of QueueTab only.**
2. **The Phase 9 fold-in for this page is one line**: a single hardcoded hex (`#f6f6f7` in a `<pre>` style at line 176). Grep found **no emoji-as-icons and no clickable non-button elements** — every `onClick` in the action area (lines 840–900) sits on a Polaris `<Button>`. Color-only-signal check: the badges all carry text labels already. The roadmap's Phase 9 "known offenders" list simply doesn't apply to this page.
3. **Behavior-preservation hot spots (each must move verbatim)**: QueueTab's 4-second polling gated on `active` + a `generatingRef` (lines 495–505); `getCache`-seeded initial state (`useState(() => getCache(...))` — lazy initializers must stay lazy); the 4s toast-clear `setTimeout` (~586); BriefTab's `AbortController` + timeout fetch (~1641); the `?tab=` URL-restore effect in the main component; `withShopifyContextUrl` router pushes.

**Tech Stack:** Next.js 14 App Router, Polaris, TypeScript. Frontend-only refactor — no API, job, schema, or dependency changes.

## Global Constraints

- **Keyword Planner is untouchable** (user directive, clarified 2026-07-03: the "no Google Ads" ban covers advertising only, never keyword research). Nothing here touches `lib/connectors/google-ads.ts`, `jobs/fetch-keyword-research.ts`, the `google_ads_keyword_research` connector-health entry, `GOOGLE_ADS_*` env vars, or skill 46. If any step appears to require it, stop and surface.
- **ZERO behavior change.** Every extraction is a **verbatim cut-paste plus import fixes only** — no renaming, no "improvements", no reordering of hooks, no converting lazy `useState` initializers to eager ones, no lifting or lowering state beyond what each task specifies. If a move seems to require an API change or a logic edit, stop and surface.
- Components are **co-located**: `app/(embedded)/(content-pilot)/content-pilot/components/` (create it; nothing exists there today). The global `components/` directory is off-limits for this page's parts. `draft/[id]/page.tsx` is a separate page — **out of scope**.
- **No component definitions inside another component's body** in the extracted files (that changes React identity per render). All extracted components are module-scope.
- One commit per extraction task, so `git diff --color-moved` review stays tractable.
- **What "every page action exercised once" means here** (Shopify embedded auth blocks live click-throughs, same constraint accepted in Phases 4–6): (a) `npx tsc --noEmit` + `npm test` + `npm run build` all clean, (b) the **action-inventory table** (Task 5) mapping every user action's handler from old line to new file with the handler body confirmed identical via `git diff -w --color-moved`, and (c) hook-count invariance: total `useState`/`useEffect`/`useCallback`/`useRef`/`useMemo` counts across page + new components equal the old page's counts exactly.
- Verify gate at the end: tsc clean, tests green, build clean, page.tsx < 400 lines. After the phase: `.mex/ROUTER.md`, commit + push. **No deploy** (final 🚀 comes after Phase 9's sweep).

---

### Task 1: Shared types, helpers, and badges → co-located modules

**Files:**
- Create: `app/(embedded)/(content-pilot)/content-pilot/components/types.ts`, `.../components/helpers.tsx`
- Modify: `page.tsx` (imports only)

- [ ] **Step 1:** Read lines 38–98 of page.tsx (between the imports and the first helper) — the shared interfaces (`ContentProposal`, `ArticleRow`, `TopicCluster`, `LinkGraphData`, and whatever else lives there) move verbatim to `components/types.ts` with `export` added.
- [ ] **Step 2:** Lines 99–196 (`countWordsFromHtml`, `fmt`, `draftFailureMessage`, `ScoreBadge`, `PriorityBadge`, `ImpactBadge`, `SeoDeltaBadge`, `ProposedChangeSummary`) move verbatim to `components/helpers.tsx` with `export` added, carrying exactly the imports each needs (Polaris pieces, `sanitizeHtml` if used). **This file contains the page's single Phase 9 offender** — while moving line 176, replace `background: "#f6f6f7"` with `background: "var(--p-color-bg-surface-secondary)"`. That is the only permitted non-verbatim edit in this task, and it gets its own line in the commit message.
- [ ] **Step 3:** page.tsx imports the moved names from `./components/types` and `./components/helpers`. Run `npx tsc --noEmit` — clean. Commit: `refactor(content-pilot): extract shared types/helpers/badges to co-located modules (+ sole hex → Polaris token)`.

### Task 2: `OverviewTab` → `components/OverviewTab.tsx`

- [ ] Move lines 197–342 verbatim (component + its props type). It receives its data via props from the main component — the props interface moves with it. Fix imports (types/helpers from Task 1). `npx tsc --noEmit` clean. Commit: `refactor(content-pilot): extract OverviewTab`.

### Task 3: `BriefTab` → `components/BriefTab.tsx`

- [ ] Move lines 1396–1613 verbatim. Preserve the `AbortController`/timeout fetch block byte-identically. `npx tsc --noEmit` clean. Commit: `refactor(content-pilot): extract BriefTab`.

### Task 4: `QueueTab` → `components/QueueTab.tsx` + internal decomposition

The 1,053-line tab splits into an orchestrator that keeps **all** state, handlers, `loadProposals`, and the polling block, plus pure-render children that receive values and callbacks:

**Files:**
- Create: `components/QueueTab.tsx`, `components/queue/ProposalRow.tsx`, `components/queue/QueueFilters.tsx`, `components/queue/QueueModals.tsx`

- [ ] **Step 1: Read QueueTab in full first** (343–1395) and inventory: every `useState` (~20, including the Set-based `approvingIds`/`rejectingIds`/`generatingDraftIds`/`publishingIds`), the `getStage` classifier and derived counts (~397–415), the filter/sort pipeline (~417–440), `loadProposals` + cache seeding, the polling block (495–505), every handler (`generate`, `approve`, `reject`, `generateDraft`, `publishDraft`, expand/schedule/clone/reopen — enumerate what actually exists), the modal(s) around `showPublishModal`, and the row-rendering map with its action-button block (840–900).
- [ ] **Step 2: Extraction seams** (state stays in QueueTab; children are props-only):
  - `ProposalRow` — one proposal's card/row including the action buttons. Props: the proposal, the derived stage, the relevant busy-Set membership booleans (pass `isApproving: boolean` etc., **not** the Sets, so rows re-render on membership change exactly as today), the expand state + cached draft content for that row, and the callbacks it invokes (`onApprove(id, opts)`, `onReject(id)`, `onGenerateDraft(id)`, `onPublishDraft(id)`, `onToggleExpand(id)`, `onOpenDraft(id)`). Move the JSX verbatim; only variable references become prop references.
  - `QueueFilters` — the stage/type/priority/sort controls + counts bar. Props: current values, the derived counts object, and setters.
  - `QueueModals` — the confirm-generate and publish/schedule modal JSX. Props: open flags, in-flight flags, field values, and callbacks.
- [ ] **Step 3:** `QueueTab.tsx` composes the three. Polling, cache seeding, and every handler body are byte-identical to the old file. `npx tsc --noEmit` + `npm run build` clean. Commit: `refactor(content-pilot): extract QueueTab with props-only row/filters/modals children`.

### Task 5: Final page composition + action-inventory verification

- [ ] **Step 1:** page.tsx now contains: imports, `ContentPilotPage` (Overview data state + `loadOverview` + `?tab=` restore + tab wiring) and nothing else. Confirm `wc -l` < 400. If it isn't, the remaining overweight is `loadOverview`/index-now plumbing — extract it as a co-located hook `components/useOverviewData.ts` (verbatim body) rather than trimming logic.
- [ ] **Step 2: Action-inventory table** in the task report — every user action on the page, old line → new file:line, with `git diff -w --color-moved=zebra HEAD~4..HEAD` reviewed to confirm each handler body moved unmodified. Enumerate at minimum: tab switch (+ URL restore), overview refresh, index-now, generate-proposals confirm flow, approve+generate, approve-only, reject, generate-draft, publish-draft (both button variants), schedule/modal actions, row expand, open-draft navigation, every filter/sort change, error-banner dismissals, brief-tab generate/abort. Anything discovered in Task 4 Step 1 beyond this list gets a row too.
- [ ] **Step 3: Hook-count invariance:** `grep -c "useState(\|useEffect(\|useCallback(\|useRef(\|useMemo(" ` summed over page.tsx + all new components equals the pre-split page's counts (record both numbers).
- [ ] **Step 4:** Full gate: `npx tsc --noEmit`, `npm test`, `npm run build`. Commit: `refactor(content-pilot): page reduced to composition (<400 lines)`.

### Task 6: ROUTER, push

- [ ] `.mex/ROUTER.md` bullet (bump `last_updated`): content-pilot page split to co-located components (list them), zero behavior change protocol used (verbatim moves, action-inventory, hook-count invariance), Phase 9 fold-in for this page = one hex → Polaris token (page verified clean of emoji-icons/clickable-divs). Then final gate re-run + `git push origin main`. Commit: `docs(mex): record Phase 8a content-pilot split`.

---

## Self-review notes

- Roadmap recipe honored: co-located components, section state moved down / shared state (Overview data, tab selection) stays lifted, < 400-line composition target, zero behavior change, a11y folded in — scoped to what actually exists (one hex; everything else verified already-clean and recorded as such rather than inventing work). ✔
- The three named splitting hazards are addressed structurally: state written across sections stays in its owning orchestrator (QueueTab keeps all queue state; children are props-only); fetch/polling cadences move verbatim with explicit hot-spot list; React identity is protected by module-scope components, lazy initializers preserved, and busy-state passed as booleans not Sets.
- Verification is honest about the embedded-auth constraint: "exercised" is defined precisely (gate + action-inventory diff review + hook-count invariance) instead of pretending a click-through happened.
- No placeholders: every task names exact line ranges from fact-finding; the one read-first-then-enumerate step (Task 4 Step 1) specifies exactly what to inventory; the only non-verbatim edit in the whole plan (the hex) is called out twice.
- Keyword Planner surface untouched; no API/job/schema changes anywhere.
