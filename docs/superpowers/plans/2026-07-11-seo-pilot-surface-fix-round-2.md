# SEO Pilot Surface Fix Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five accepted SEO Pilot P2 defects and merge the verified remediation directly to `main` without deployment.

**Architecture:** Keep each correction inside the existing SEO domain helper that owns the behavior. Routes transport complete safe metadata, while UI components render it through existing Polaris and responsive-table patterns. Preserve compatibility only where it prevents unrelated callers from breaking.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma, Polaris, Vitest.

## Global Constraints

- Use strict red-green TDD for every behavioral change.
- Keep embedded authentication as the first route statement and preserve existing permission checks.
- Use the shared Prisma singleton; never instantiate `PrismaClient` in application code.
- Do not execute live Shopify or Meta mutations, use production databases, apply production migrations, deploy, or SSH.
- Perform exactly one whole-change specification review and one code-quality review. A re-review requires explicit approval.
- Preserve existing responsive layouts and operator actions.

---

### Task 1: Canonical SEO meta proposal dedupe

**Files:**
- Modify: `lib/content-pilot/proposal-dedupe.ts`
- Test: `__tests__/lib/content-pilot/proposal-dedupe.test.ts`

**Interfaces:**
- Consumes: `ContentProposalDedupeInput`
- Produces: `contentProposalDedupeKey(input): string`, with article-backed `seo-fix` keyed only by normalized article handle.

- [ ] Add a regression asserting two `seo-fix` inputs for one article with different issues/queries produce the same key, while internal-link destinations remain distinct.
- [ ] Run `npx vitest run __tests__/lib/content-pilot/proposal-dedupe.test.ts` and confirm the SEO-fix assertion fails because the keys differ.
- [ ] Remove the SEO-fix action/query suffix from article-backed keys; retain all other discriminator behavior.
- [ ] Re-run the focused test and confirm it passes.
- [ ] Commit with `fix(seo): prevent competing article meta proposals`.

### Task 2: Opportunity-first deterministic gap selection

**Files:**
- Modify: `lib/seo/analysis.ts`
- Test: `__tests__/lib/seo/analysis.test.ts`

**Interfaces:**
- Consumes: `GscQueryRow[]`, query-page evidence, article evidence, optional `queryLimit`.
- Produces: `buildProgrammaticSeoGaps(...)` that filters eligible uncovered position 5-20 queries, sorts by impressions descending, clicks ascending, position ascending, and query, then applies the query limit.

- [ ] Add a regression with thirty one-click ineligible rows followed by a 10,000-impression zero-click eligible query; assert the latter is returned.
- [ ] Run `npx vitest run __tests__/lib/seo/analysis.test.ts` and confirm the target is absent.
- [ ] Move the bound after coverage and eligibility filtering and add deterministic opportunity ordering.
- [ ] Re-run the focused test and confirm it passes without changing article-health gap behavior.
- [ ] Commit with `fix(seo): prioritize actionable content gaps`.

### Task 3: Safe refresh diagnostics

**Files:**
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/useSeoData.ts`
- Test: `__tests__/components/use-seo-data.test.ts`

**Interfaces:**
- Produces: `RefreshPollResult` containing `status`, `terminal`, and safe structured `issues: string[]`.
- Diagnostics are derived only from summary step status/name fields; `errorLog` and arbitrary raw messages are ignored.

- [ ] Add poller regressions for a partial summary and a failed response containing a secret-like `errorLog`; assert safe step labels are retained and raw text is absent.
- [ ] Run `npx vitest run __tests__/components/use-seo-data.test.ts` and confirm the missing `issues` assertions fail.
- [ ] Add a pure safe-summary extractor, return issues from terminal polls, and use them in partial/failed toast copy.
- [ ] Re-run the focused test and confirm success and bounded-timeout behavior remain green.
- [ ] Commit with `fix(seo): surface safe refresh diagnostics`.

### Task 4: Complete GSC freshness transport and display

**Files:**
- Modify: `app/api/seo/route.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OverviewPanel.tsx`
- Test: `__tests__/api/seo-pilot-routes.test.ts`
- Test: `__tests__/components/seo-pilot-responsive.test.ts`

**Interfaces:**
- Produces: `gscFreshness` in summary/full SEO responses using `Awaited<ReturnType<typeof getLatestGscData>>["freshness"]`.
- Consumes: typed client freshness and displays a compact fallback annotation beside GSC updated time.

- [ ] Add route assertions that summary and full responses include the exact GSC freshness object.
- [ ] Add a component source/usability assertion that Overview accepts and renders raw fallback provenance.
- [ ] Run both focused suites and confirm the new assertions fail.
- [ ] Transport `gscData.freshness`, add the client type, pass it into Overview, and render concise source/fallback copy.
- [ ] Re-run both suites and confirm they pass.
- [ ] Commit with `fix(seo): expose GSC fallback freshness`.

### Task 5: Preserve every page-health diagnosis

**Files:**
- Modify: `lib/seo/types.ts`
- Modify: `lib/seo/page-health.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/PageHealthPanel.tsx`
- Test: `__tests__/lib/seo/page-health.test.ts`
- Test: `__tests__/components/seo-pilot-responsive.test.ts`

**Interfaces:**
- Produces: `PageHealthRow.flags: PageHealthFlag[]` plus compatibility `flag: PageHealthFlag | null`.
- Severity is the sum of applicable high-bounce and low-conversion severity contributions.

- [ ] Add a pure regression asserting a high-impression page with 90% bounce and 0% conversion returns both flags and combined severity.
- [ ] Add component coverage asserting Page Health renders all finding badges.
- [ ] Run both focused suites and confirm the new assertions fail.
- [ ] Calculate each condition independently, populate `flags`, retain the first flag as compatibility primary, and render every badge.
- [ ] Re-run both suites and confirm they pass.
- [ ] Commit with `fix(seo): retain all page health findings`.

### Task 6: GROW, review, verify, and integrate

**Files:**
- Modify: `.mex/ROUTER.md`
- Modify: `.mex/patterns/seo-pilot-proposal-actions.md`
- Modify: relevant test/docs files only if initial reviews find an issue.

**Interfaces:**
- Produces: documented current behavior and regression guidance.

- [ ] Update GROW documentation and scaffold dates, then commit with `docs(seo): record second surface remediation`.
- [ ] Run focused suites for proposal dedupe, analysis, refresh polling, SEO routes, page health, and responsive components.
- [ ] Run one whole-change specification review and resolve its initial findings.
- [ ] Run one whole-change code-quality review and resolve its initial findings.
- [ ] Run `npm test -- --run`, `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, a production build with a disposable localhost PostgreSQL URL, and `git diff --check`.
- [ ] Re-audit the five defects and confirm no surface-owned P0/P1/P2 issue or introduced warning remains.
- [ ] Merge the branch directly into current `main`, confirm `main` and the branch point at the merge result, and do not deploy.
