# Task 5 report: SEO Pilot topical-map command center

Status: DONE_WITH_CONCERNS

## Ground

- Replaced the nine legacy navigation destinations with five operator jobs: Map overview, Pages & ownership, Content gaps, Links & technical, and Search evidence.
- Added active-package identity and health totals covering all eleven topical-map rule domains.
- Added page ownership and technical work lists with labelled filters and expandable rule/source provenance.
- Connected active-strategy content and missing-internal-link candidates to the governed `/api/seo/gaps/promote` proposal route, with busy and created/already-handled feedback.
- Kept redirect, canonicalization, and indexation execution unavailable, with explicit explanatory disabled controls.
- Kept raw GSC observations separate and disabled their proposal controls when no map rule association exists.
- Added distinct loading, no-active-strategy, command-center error, stale-analysis, and empty-analysis copy.
- Added narrow-layout list styling, overflow containment, keyboard-visible disclosure focus, and non-color status text.

## TDD evidence

Red command:

`npm test -- __tests__/components/topical-map-strategy-panel.test.ts __tests__/components/seo-pilot-responsive.test.ts`

Observed: 2 test files failed. The failures named missing `MapOverviewPanel.tsx`, `MapPagesPanel.tsx`, `MapWorkPanel.tsx`, `.commandCenter`, and `.compactList` contracts.

Green command:

`npm test -- __tests__/components/topical-map-strategy-panel.test.ts __tests__/components/seo-pilot-responsive.test.ts __tests__/components/use-seo-data.test.ts __tests__/a11y/no-raw-hex.test.ts`

Observed: 4 files passed, 30 tests passed, 0 failed.

Additional verification:

- `npx tsc --noEmit`: exit 0.
- `git diff --check`: exit 0.
- `npm run lint`: exit 0 with 140 existing/project warnings and no errors. Several warnings now surface legacy SEO Pilot state/imports that became unreachable after the navigation cutover; they do not block compilation but should be removed in a later focused cleanup rather than broadening this task.

## Self-review

- Live execution authority was not broadened. Only the already governed proposal route is called.
- Raw strategy source bytes and compiled payloads are not rendered.
- Rule IDs, source artifact identity, bounded source-reference coverage IDs, blockers, and active package identity remain visible.
- Technical controls accurately distinguish operator-visible required work from unavailable live execution.
- No nested cards, raw colors, or horizontal scrolling were added.

## Concerns

- The existing page still contains unreachable legacy panel handlers and imports after the five-tab cutover, producing lint warnings. Removing that dead code is desirable but was intentionally not mixed into the command-center behavior change.
- Page/work filter facets are intentionally bounded to projected fields. Some work filter values have limited utility until the command-center projection exposes normalized lifecycle and blocker associations per row.

## Review-finding follow-up (2026-07-13)

- Fixed the critical proposal transport defect: content and internal-link actions now submit the exact candidate identity at both top level and per gap (`strategyVersionId`, `packageSha256`, `gaps: [gap]`). Behavior tests assert the exact request body and success feedback for both action families.
- Map-aware analysis now carries strict, validated `priority` and bounded `observedEvidence` fields. Content gaps display the actual projected priority and exact matching GSC observations, or explicitly state that no matching observation exists rather than fabricating evidence.
- Work priority/state/blocker filters now classify and filter real rows. Internal links are candidates only when an analysis candidate exists; absent candidates are evidence-blocked. Redirect/canonical/indexation rows are review-blocked because no safe Content Pilot persistence/generation type exists. Page blocker filtering now uses actual prohibited-content URL associations.
- Redirects, canonicalization, and indexation now have distinct truthful controls. Redirect persistence is labelled unsupported; canonical and indexation remain advisory-only under the package contract. No technical live-execution authority was added and no unpublishable generic proposal type was invented.
- Raw evidence filter labels are visible. Overview summaries now derive cluster URL coverage, decision distribution, action-family totals, and high-priority action counts from the command-center projection.

Follow-up verification:

- Focused UI, API, route, analysis, command-center, proposal integration, evaluator, and governed-operation matrix: 13 files passed, 113 tests passed.
- `npx tsc --noEmit`: exit 0.
- `npm run lint`: exit 0.
- `git diff --check`: exit 0.

## Remaining review findings follow-up (2026-07-13)

- Existing governed article pages whose active content decision says refresh, update, improve, optimize, or expand now emit exact `action: "refresh"` candidates. Candidates retain target URL, active package identity, exact rule IDs, projected priority, and up to 20 current query/page observations.
- The promotion route accepts refresh explicitly, revalidates active decision/rules/priority, reconstructs current bounded GSC evidence, rejects stale evidence, and persists a governed `content-refresh` proposal using the existing evaluator, compliance, and dedupe transaction.
- Page rule families now come from explicit projected `ruleDomains`; opaque rule IDs are never parsed for domain meaning.
- Global evidence/review blockers only appear when family and priority are unfiltered and state includes blocked work. In incompatible combined selections, the UI explains why association-free global blockers are hidden.
- Proposal helper coverage now includes created, already-handled, and failed responses for both content and internal-link candidates. UI coverage proves a mapped refresh renders evidence and an enabled proposal action.
- Final affected matrix: 13 files passed, 120 tests passed; `npx tsc --noEmit`, `npm run lint`, and `git diff --check` exited 0.
