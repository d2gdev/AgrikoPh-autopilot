# Phase 8c — SEO-Pillar Page Split (+ its Phase 9 fold-in) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Line numbers are as of this plan's fact-finding (page = 1,176 lines).** Relocate by grep as earlier tasks shift them; if a stated hot spot lives elsewhere, leave it alone and report (8a/8b lessons). **Protocol upgrade from 8b: every extraction task ends with a zero-raw-hex check scoped to the files that task touched** — no band goes unowned; Task 4 still runs the whole-surface sweep.

**Goal:** `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx` (1,176 lines — roadmap said ~1,100; the tier-34 fold of the retired `/seo` page added the AI-brief renderer) becomes < 400 lines of composition over co-located components, zero behavior change, plus this page's Phase 9 retrofit (4 hexes, trend-arrow second channel).

**Architecture — fact-finding results (this page differs from 8a/8b):**
- **One monolithic component.** Unlike 8a (three in-file tabs) and 8b (comment-banded sub-components), everything from ~line 176 down is a single component: ~10+ `useState` hooks (incl. the four `promoted*` Sets from Phase 5's fact-finding), handlers (analyze/refresh/track/brief/strategy actions at ~395, the promote handler at ~342), a 9-tab `Tabs` array (545–556), and nine inline tab panels: OVERVIEW (597) · OPPORTUNITIES (728) · CONTENT GAPS (763) · **ON-PAGE HEALTH (833 — contains the Phase 2 loop entry)** · KEYWORDS (915) · PILLAR CLUSTERS (968) · PAGE HEALTH (988) · OPPORTUNITY CLUSTERS (1017) · STRATEGY (after 1017 — locate by grep). Support components sit at 55–175: `InlineBold` + `BriefRenderer` (the ported /seo renderer), `Delta`, `Sparkline`. Types at 14–55. **No polling anywhere** (grep: zero `setInterval`) — one less hazard class than 8b.
- **The split shape:** state and every handler stay in the main component; the nine panels become props-only components (values + callbacks), the exact 8a `ProposalRow` / 8b sections pattern. Support components and types move to co-located modules. Components directory: `app/(embedded)/(seo-pillar)/seo-pillar/components/` (the page has its own folder; nothing exists there today).
- **On-Page Health promote flow (Phase 2's loop entry — inviolable):** the single `authFetch("/api/seo/promote", ...)` call at ~342 and the `promotedOnPage` (and sibling `promoted*`) Set state move nowhere — they stay in the main component; the panel receives membership booleans/callbacks. Request body, dedup semantics, and state updates byte-identical.

**Phase 9 permitted non-verbatim edits — exhaustive list:**
1. **Hex → Polaris token (4 total, all Sparkline-related):** the `Sparkline` default `#2c6ecb` → `var(--p-color-bg-fill-info)`; call-sites (~639/644/649): `#2c6ecb` → `var(--p-color-bg-fill-info)`, `#9c6ade` → `var(--p-color-bg-fill-magic)`, `#47c1bf` → nearest teal-role token (executor picks, e.g. a success/info secondary fill, with a visual-parity note). Whole-page grep found no other hexes — record the rest of the page as verified-clean.
2. **Trend-arrow second channel (roadmap's named item), scoped to the `Delta` component only (~132–147):** the `▲`/`▼` glyph gets `aria-hidden="true"` plus a visually-hidden "up"/"down" text sibling (or `aria-label` on the wrapping element). The two *string-built* arrow usages inside DataTable cell strings (~474, ~956) are plain text content readable by screen readers and cannot carry markup — record them as acceptable-as-text, do NOT restructure DataTable cells for this.
- Clickable non-buttons and emoji-as-icons: grep found none (the arrows are data indicators, not controls) — verified-clean.

**Tech Stack:** Next.js 14 App Router, Polaris, TypeScript. Frontend-only.

## Global Constraints

- **Keyword Planner is untouchable** (user directive, clarified 2026-07-03: advertising only, never keyword research — `lib/connectors/google-ads.ts`, `jobs/fetch-keyword-research.ts`, the connector-health entry, `GOOGLE_ADS_*` env vars, skill 46). This page *displays* keyword/GSC-derived data — display-layer moves are fine; anything touching the data pipeline (APIs, jobs, connectors) means stop and surface.
- **ZERO behavior change** outside the two enumerated Phase 9 edits. Verbatim cut-paste + import fixes; lazy `useState(() => getCache(...))` initializers stay lazy; hook order preserved; no component definitions inside another component's body; the promote flow's request/dedup/state semantics byte-identical. If a move seems to require an API/logic change, stop and surface.
- Frontend-only: nothing changes outside `app/(embedded)/(seo-pillar)/seo-pillar/` and `.mex/ROUTER.md`.
- One commit per extraction task; `git diff -w --color-moved=zebra` review; per-task zero-hex check on touched files.
- **"Every page action exercised once" means** (embedded-auth constraint): full gate (`npx tsc --noEmit`, `npm test`, `npm run build`) + action-inventory table (every action old-line → new-file, handler bodies moved-unmodified) + hook-count invariance (before/after totals equal) + visual-parity note per token swap.
- After the phase: `.mex/ROUTER.md`, commit + push. **No deploy** (final 🚀 after Phase 9's sweep — which is now the only remaining roadmap item).

---

### Task 1: Types, brief renderer, widgets → co-located modules (+ both Phase 9 edits)

**Files:**
- Create: `app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts`, `.../components/brief.tsx`, `.../components/widgets.tsx`
- Modify: `page.tsx` (imports only)

- [ ] Move lines 14–55 (response types) → `types.ts`; `InlineBold` + `BriefRenderer` (57–131) → `brief.tsx`; `Delta` + `Sparkline` (132–175) → `widgets.tsx` — verbatim + `export`, carrying exactly the imports each needs. **Apply permitted edit #1 (all 4 token swaps — the default here, the 3 call-sites when their panel moves in Task 2/3; if simpler, swap the call-site literals in place in page.tsx now and note it) and edit #2 (Delta second channel) in `widgets.tsx`.** Per-task hex check on the three new files + page.tsx. Gate clean. Commit: `refactor(seo-pillar): extract types/brief/widgets (+4 hex → tokens, Delta a11y channel)`.

### Task 2: Tab panels 1–4 → props-only components

**Files:**
- Create: `.../components/panels/OverviewPanel.tsx`, `OpportunitiesPanel.tsx`, `ContentGapsPanel.tsx`, `OnPageHealthPanel.tsx`

- [ ] **Step 1: Read the main component (176–~600) in full first** and inventory every `useState`, every handler, and which panel reads/writes what — this drives each panel's props (values + callbacks; `promoted*` membership passed as booleans/callbacks, not Sets, per the 8a rule).
- [ ] **Step 2:** Extract the four panels verbatim (OVERVIEW 597–727 includes the Sparkline call-sites — carry their token swaps if not already done in Task 1; OPPORTUNITIES 728–762; CONTENT GAPS 763–832; ON-PAGE HEALTH 833–914 with the promote button wiring as an `onPromote(handle, issue)` callback into the main component's existing handler — the handler itself does not move). Per-task hex check. Gate clean. Commit: `refactor(seo-pillar): extract panels 1-4 (overview, opportunities, gaps, on-page health)`.

### Task 3: Tab panels 5–9

**Files:**
- Create: `.../components/panels/KeywordsPanel.tsx`, `PillarClustersPanel.tsx`, `PageHealthPanel.tsx`, `OpportunityClustersPanel.tsx`, `StrategyPanel.tsx`

- [ ] Extract the remaining five panels verbatim (KEYWORDS 915–967; PILLAR CLUSTERS 968–987; PAGE HEALTH 988–1016; OPPORTUNITY CLUSTERS 1017–?; STRATEGY — locate by its comment/tab id). Strategy-tab action handlers (~395+) stay in the main component; the panel gets callbacks. Per-task hex check. Gate clean. Commit: `refactor(seo-pillar): extract panels 5-9 (keywords, clusters, page health, opp clusters, strategy)`.

### Task 4: Final composition + verification

- [ ] page.tsx = imports + main component (all state, all handlers, `load`, tabs array, panel composition). Confirm `wc -l` < 400 — fact-finding projects ~430 before the escape hatch, so expect to need it: if over, extract the data-loading (`load`/`fetchJson`-equivalents) into a co-located `components/useSeoData.ts` hook, **verbatim body** (the 8b `useDashboardData` precedent). Deliver: action-inventory table (enumerate at minimum: tab switches, refresh/analyze/track-all/add-keyword, brief generate, every promote variant — on-page/opportunity/recommendation — with their Set-state updates, opportunity/keyword search + filters, strategy actions, plus anything Task 2 Step 1 discovered), hook-count invariance numbers, whole-surface zero-hex sweep. Full gate. Commit: `refactor(seo-pillar): page reduced to composition (<400 lines)`.

### Task 5: ROUTER, push

- [ ] `.mex/ROUTER.md` bullet (bump `last_updated`): seo-pillar split file map; protocol reused from 8a/8b with the per-task hex-check upgrade; Phase 9 fold-in for this page = 4 Sparkline tokens + Delta arrow second channel, remainder verified-clean; promote-flow semantics unchanged. Final gate re-run + `git push origin main`. Commit: `docs(mex): record Phase 8c seo-pillar split`.

---

## Self-review notes

- Roadmap recipe honored: co-located components (page's own folder), props-only panels with all state and handlers staying lifted (mandatory here — the page is one component, so unlike 8a/8b nothing was pre-isolated), < 400 target with the proven escape hatch pre-authorized, zero behavior change with a two-item exhaustive permitted-edit list, Phase 9 scoped to actual findings (4 hexes + Delta arrows; emoji-icons/clickable-divs verified-clean). ✔
- 8a/8b lessons encoded: grep relocation, don't-force-premises, per-task hex ownership (the 8b gap), Sets→booleans prop threading, one commit per extraction.
- The page's inviolable integration point (the `/api/seo/promote` Phase 2 loop entry) is protected structurally: handler and `promoted*` state never move; the panel gets a callback.
- Honest sizing: the plan states the <400 target likely needs the hook extraction rather than discovering it mid-execution.
- No placeholders: real line bands throughout; the two read-first steps (Task 2 Step 1 state inventory; Strategy panel location) specify exactly what to determine; token mappings concrete with a defined parity-note rule for the one judgment call (`#47c1bf`).
- Keyword Planner surface untouched; frontend-only; no deploy — after this, only Phase 9's final sweep remains.
