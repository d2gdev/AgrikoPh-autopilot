# Task 2 Report: Topical-map Store Task synchronization

## Outcome

Implemented strict topical-map Store Task projection and synchronization for governed product, collection, and page resources. The service batches SEO/content drafting into at most one AI call, deterministically appends internal links, creates advisory-only tasks for unsupported technical/home/blog-index work, suppresses unobserved resources, and preserves completed/dismissed history.

## TDD evidence

- RED: `npx vitest run __tests__/lib/store-tasks/topical-map.test.ts` failed because `@/lib/store-tasks/topical-map` did not exist.
- GREEN: `npx vitest run __tests__/lib/store-tasks/topical-map.test.ts` passed: 1 file, 8 tests.

## Verification

- `npx vitest run __tests__/lib/store-tasks/topical-map.test.ts` — 8/8 passed.
- `npx tsc --noEmit` — passed.
- `git diff --cached --check` — passed before commit.
- Staged scope before commit contained only `lib/store-tasks/topical-map.ts` and `__tests__/lib/store-tasks/topical-map.test.ts`.

## Coverage

- Governed non-blog product/collection/page content decisions.
- Deterministic non-blog internal-link additions with normalized destination checks and escaped anchor/URL output.
- Blog-article exclusion; homepage/blog-index advisory projection.
- Redirect/canonical/indexation advisory-only projection.
- Missing observation suppression.
- Strict source/proposed schemas, exact observed state and strategy/rule identity.
- Dedupe identity over strategy version/package, sorted rule IDs, normalized URL, action, and proposed-state hash.
- Pending/failed refresh while completed/dismissed rows remain unchanged.
- One batched AI call, strict key parsing, metadata bounds, grounding checks, additive body sections, and advisory fallback.

## Self-review / safety

- No production/deploy/live Shopify or Meta write occurred.
- The reviewed `lib/shopify-governed-resources.ts` mutation boundaries were not changed.
- No route, cron, schema, secret, or authorization behavior changed.
- Existing unrelated `.superpowers/sdd/task-1-report.md` worktree changes were preserved and excluded from the commit.

## Commit

`0cacacc898e1bf588f6503701b959927a09daf5a` (`feat(store): synchronize topical-map tasks`)

## Concerns

None identified within Task 2 scope.

## Review hardening follow-up

Commit `b20493b62c6f342639b84cac85ce06e7859aec9d` (`fix(store): harden topical-map task drafts`) addresses the Task 2 review findings.

- Replaced the executable proposed-state schema with strict action-discriminated variants. SEO updates require at least one bounded SEO field and forbid title/body HTML; content and internal-link updates require body HTML and forbid SEO/title fields.
- Restricted source hashes, governed URLs, rule domains, advisory target types, and advisory reasons to their known semantic values.
- Replaced AI-provided HTML with bounded plain `sectionText`; server code escapes all HTML-significant characters and wraps the result in fixed markup.
- Added TDD regressions for empty/mismatched states, arbitrary advisory values, and script/javascript/event-like AI text.

RED evidence: focused suite failed 4 tests against the pre-fix implementation. Final verification: 11/11 focused tests passed, `npx tsc --noEmit` passed, and staged `git diff --check` passed with only the two Task 2 files staged.
