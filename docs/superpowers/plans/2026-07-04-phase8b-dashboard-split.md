# Phase 8b — Dashboard Page Split (+ its Phase 9 fold-in) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Line numbers are as of this plan's fact-finding (page = 1,478 lines).** Earlier tasks shift them — relocate by grep, never trust stale numbers. If a stated hot spot turns out to live elsewhere, leave it alone and report; don't force the premise. (Both lessons from Phase 8a's execution.)

**Goal:** `app/(embedded)/page.tsx` (1,478 lines — roadmap said ~1,430; Phases 1 and 4 added the win-rate and revenue cards) becomes < 400 lines of composition over co-located components, zero behavior change, **plus this page's Phase 9 retrofit, which is real here**: 15 hardcoded hexes, one emoji-as-icon caret, and color-only status dots.

**Architecture — fact-finding results:**
- The page is comment-sectioned and cleanly banded: Types (33–170) · Constants (171–195, incl. `STATUS_DOT_COLOR`) · Helpers (196–274, incl. `stalenessTone`/`stalenessStyle`, `PanelNotice`) · Sub-components (275–474: `Sparkline`, `TrendDots`, `JobRow`, local `StatCardSkeleton`/`JobHealthSkeleton`) · Skill-insight cards (475–598: `FatigueCard`/`SearchTermCard`/`CompetitorCard`) · Main page (599–1478) with marked JSX sections: stale-alert banner (935) · **Pending rec inbox (946 — leads the page per commit 3a51f79; its position is inviolable)** · Operations row (1011) · Performance row (1103) · Intel row (1230) · Skill Insights (1298) · Job Health (1333) · Trends (1372, sparkline call-sites with hexes at 1396/1412) · Recent Activity (1440).
- Polling: two `setInterval`s in the main component (a 5-minute `load()` refresh and a second interval nearby — inventory both at execution). Skeleton counts live inside each row's own loading branch, so verbatim row extraction keeps them synchronized by construction (the Phase 1/4 bump hazard).
- **Component directory decision:** `app/(embedded)/components/dashboard/`. The dashboard page is the route-group *root* (`app/(embedded)/page.tsx`), so it has no page-specific folder of its own; a plain non-route folder under the group is invisible to the router and keeps the parts co-located with the group without touching the global `components/`. The shared `components/ui/states.tsx` skeletons stay global; the page's two *local* skeletons move with their sections (they are different components, not duplicates).

**Phase 9 permitted non-verbatim edits — this exhaustive list is the ONLY sanctioned deviation from verbatim moves:**
1. **Hex → Polaris token (15 total; run `grep -n "#[0-9a-fA-F]\{6\}" ` and map every hit; the known ones):** `STATUS_DOT_COLOR` (5: success `#008060`→`var(--p-color-bg-fill-success)`, partial `#ffc453`→`var(--p-color-bg-fill-warning)`, failed `#d72c0d`→`var(--p-color-bg-fill-critical)`, queued/running `#2c6ecb`→`var(--p-color-bg-fill-info)`); `stalenessStyle` (3: `#f1f8f5`→`var(--p-color-bg-surface-success)`, `#fff5ea`→`var(--p-color-bg-surface-warning)`, `#fff4f4`→`var(--p-color-bg-surface-critical)`); `Sparkline` default `#2c6ecb`→`var(--p-color-bg-fill-info)`; `TrendDots` fallback `#8c9196`→`var(--p-color-bg-fill-tertiary)`; Trends call-sites `#2c6ecb`/`#008060`→ info/success fill tokens; remaining hits mapped to the visually nearest token, each listed in the commit body. CSS custom properties work in inline styles and SVG stroke/fill — no rendering-path change.
2. **Emoji caret (line ~378, `{open ? "▲" : "▼"}` in JobRow)** → Polaris `Icon` with `ChevronUpIcon`/`ChevronDownIcon` from `@shopify/polaris-icons` plus an accessible label; check what toggles `open` first — if the toggle target is a non-button element, make it a keyboard-operable control (Polaris `Button variant="monochromePlain"` or `tabIndex`/`role="button"`/`onKeyDown`), which is the roadmap's focus/keyboard item.
3. **TrendDots second channel:** the run-status dots are color-only — add a text channel (`title`/`aria-label` per dot with the status name, or a visually-hidden text). Smallest addition that gives non-color information; no layout change.

Everything else — every handler, every fetch, every state hook, every card — moves byte-identical.

**Tech Stack:** Next.js 14 App Router, Polaris, TypeScript. Frontend-only.

## Global Constraints

- **Keyword Planner is untouchable** (user directive, clarified 2026-07-03: advertising only, never keyword research — `lib/connectors/google-ads.ts`, `jobs/fetch-keyword-research.ts`, the connector-health entry, `GOOGLE_ADS_*` env vars, skill 46). If any step appears to require it, stop and surface.
- **ZERO behavior change** outside the three enumerated Phase 9 edits. Verbatim cut-paste + import fixes; lazy initializers stay lazy; hook order preserved; no component definitions inside another component's body in new files; the Pending Review inbox keeps its lead position; the `isPayload`-validated payload contract and both polling intervals move byte-identical. If a move seems to require an API/logic change, stop and surface.
- Frontend-only: no changes outside `app/(embedded)/page.tsx`, the new `app/(embedded)/components/dashboard/`, and `.mex/ROUTER.md`.
- One commit per extraction task; `git diff -w --color-moved=zebra` is the review tool.
- **"Every page action exercised once" means** (embedded-auth constraint, accepted since Phase 4): full gate (`npx tsc --noEmit`, `npm test`, `npm run build`) + the action-inventory table (every action old-line → new-file, handler bodies confirmed moved-unmodified) + hook-count invariance (`useState/useEffect/useCallback/useRef/useMemo` totals equal before/after) + a Phase 9 visual-parity note per token swap (token chosen ≈ original color's role).
- After the phase: `.mex/ROUTER.md`, commit + push. **No deploy** (final 🚀 after Phase 9's sweep).

---

### Task 1: Types, constants, helpers → co-located modules (+ color-token edits #1)

**Files:**
- Create: `app/(embedded)/components/dashboard/types.ts`, `.../dashboard/helpers.tsx`
- Modify: `page.tsx` (imports only)

- [ ] Move lines 33–170 (types) to `types.ts` and 171–274 (constants + helpers + `PanelNotice`) to `helpers.tsx`, verbatim + `export`. **Apply permitted edit #1 to `STATUS_DOT_COLOR` and `stalenessStyle` while moving them** — those 8 swaps and any other hex in these bands, each listed in the commit body. `npx tsc --noEmit` clean. Commit: `refactor(dashboard): extract types/constants/helpers (+8 hex → Polaris tokens)`.

### Task 2: Support components (+ edits #2 and #3)

**Files:**
- Create: `.../dashboard/Sparkline.tsx`, `.../dashboard/JobHealth.tsx`

- [ ] Move `Sparkline` (277–302) to `Sparkline.tsx` (default-color token swap included). Move `TrendDots` + `JobRow` + `JobHealthSkeleton` (303–474 band; `StatCardSkeleton` goes wherever its consumers land — check who uses it and co-locate accordingly) to `JobHealth.tsx`. Apply edit #2 (caret → Polaris icons + keyboard check) and edit #3 (dot second channel) here. Everything else byte-identical. Gate clean. Commit: `refactor(dashboard): extract Sparkline/JobHealth (+ caret icons, dot text channel, 2 tokens)`.

### Task 3: Skill-insight cards

**Files:**
- Create: `.../dashboard/InsightCards.tsx`

- [ ] Move `FatigueCard`/`SearchTermCard`/`CompetitorCard` (475–598) verbatim. Gate clean. Commit: `refactor(dashboard): extract skill-insight cards`.

### Task 4: Main-page JSX sections → section components

**Files:**
- Create: `.../dashboard/sections/` — one file per marked section: `StaleAlertBanner.tsx`, `PendingRecInbox.tsx`, `OperationsRow.tsx`, `PerformanceRow.tsx`, `IntelRow.tsx`, `SkillInsightsSection.tsx`, `JobHealthSection.tsx`, `TrendsSection.tsx`, `RecentActivity.tsx`

- [ ] **Step 1: Read the main component (599–1478) in full first** and inventory: every `useState`/`useEffect` (including both intervals), `load()` and any other fetchers, and which state each JSX section reads/writes — this drives each section component's props. State stays in the main page; sections are props-only (values + callbacks), the 8a `ProposalRow` pattern. Loading-skeleton branches move inside their section verbatim (keeps card/skeleton counts paired).
- [ ] **Step 2:** Extract the nine sections in page order, **Pending Rec Inbox keeping its exact position in the composed output**. The Trends section carries the two call-site sparkline color swaps (edit #1 remainder). One commit for sections 1–5, one for 6–9 (keeps each diff reviewable). Gate clean after each. Commits: `refactor(dashboard): extract sections 1–5 (banner, inbox, operations, performance, intel)` and `refactor(dashboard): extract sections 6–9 (insights, job health, trends, activity) (+2 sparkline tokens)`.

### Task 5: Final composition + verification

- [ ] page.tsx = imports + main component (state, `load`, both intervals, `?`-param effects if any, section composition). Confirm `wc -l` < 400 (from 8a's experience it should land well under; if not, extract the data-loading into a co-located `useDashboardData.ts` hook, verbatim body). Deliver: the action-inventory table (tab-less page — enumerate: manual refresh, inbox item actions/navigations, every card link, job-row expand, insight-card interactions, trends hover states if any, banner dismissals), hook-count invariance numbers, the full hex sweep result (`grep` on page + new files returns zero raw hexes), and the visual-parity note per token. Full gate. Commit: `refactor(dashboard): page reduced to composition (<400 lines)`.

### Task 6: ROUTER, push

- [ ] `.mex/ROUTER.md` bullet (bump `last_updated`): dashboard split file map; zero-behavior protocol reused from 8a; Phase 9 fold-in for this page = 15 hex→token swaps + caret→icons + TrendDots text channel (the roadmap's named offenders for this page, all cleared). Final gate re-run + `git push origin main`. Commit: `docs(mex): record Phase 8b dashboard split`.

---

## Self-review notes

- Roadmap recipe honored: co-located (directory decision made and justified — group-root page, non-route folder), props-only sections with state staying lifted in the page, < 400 target, zero behavior change with an exhaustive permitted-edit list, Phase 9 fold-in scoped to what greps actually found (and this page has the roadmap's named offenders: `stalenessStyle`, `STATUS_DOT_COLOR`, sparkline colors — all mapped to specific tokens). ✔
- 8a lessons encoded at the top (grep relocation, don't force stale premises) and 8a patterns reused (props-only children, one commit per extraction, action inventory, hook invariance, honest "exercised" definition).
- Hazards from the brief addressed structurally: skeleton counts move inside their sections (can't desynchronize), the inbox's lead position is called out as inviolable, the JobsStatusPayload contract moves untouched (types file is a verbatim move), both polling intervals inventoried before extraction.
- No placeholders: every band has real line numbers from fact-finding; the two read-first steps (Task 2 caret toggle target, Task 4 Step 1 state inventory) specify exactly what to determine; token mappings are concrete with a defined rule for stragglers.
- Keyword Planner surface untouched; frontend-only; no deploy.
