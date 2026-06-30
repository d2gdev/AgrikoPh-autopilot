# SEO Pilot Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining SEO Pilot correctness, timeout, validation, and UI-state issues found in review.

**Architecture:** Move slow refresh work out of the embedded request path by queueing the existing dashboard refresh job, align SEO fetch reporting windows with GSC lag, and harden proposal creation so SEO opportunities map only to valid Content Pilot actions. Keep changes inside existing route/job/UI boundaries and preserve embedded auth rules.

**Tech Stack:** Next.js App Router, Prisma, PostgreSQL, Vitest/Jest-style API tests, Shopify App Bridge authenticated routes.

---

### Task 1: Refresh Timeout And History Accuracy

**Files:**
- Modify: `app/api/seo/refresh/route.ts`
- Modify: `jobs/run-dashboard-refresh.ts`
- Modify: `jobs/fetch-seo-data.ts`
- Modify: `jobs/snapshot-seo-history.ts`
- Test: `__tests__/api/seo-pilot-routes.test.ts`

- [ ] Add/update tests proving `/api/seo/refresh` queues work instead of running fetch handlers inline.
- [ ] Add/update tests proving skipped history snapshots are reported as skipped, not success.
- [ ] Change `/api/seo/refresh` to `requireAppAuth(req)` first, rate-limit by shop/user, create a dashboard refresh run, enqueue `dashboard-refresh`, and return `202`.
- [ ] Update dashboard refresh history step to run after either SEO or GSC succeeds and preserve skipped status from `snapshotSeoHistoryHandler()`.
- [ ] Align `fetch-seo-data` windows to the same GSC reporting lag used by normalized GSC.
- [ ] Stop mutating the object returned by `getLatestGscData()` in `snapshotSeoHistoryHandler()`.
- [ ] Run focused SEO Pilot tests.

### Task 2: Proposal Routing Correctness

**Files:**
- Modify: `app/api/seo/gaps/promote/route.ts`
- Modify: `app/api/seo/recommendations/decompose/route.ts`
- Optional create: `lib/seo/meta-signals.ts`
- Test: `__tests__/api/seo-pilot-routes.test.ts`

- [ ] Add tests for bulk missing-meta decomposition using current SEO field names and issue codes.
- [ ] Add tests proving `gaps/promote` rejects nonexistent article handles for SEO fixes/content refreshes.
- [ ] Add tests proving non-blog existing page opportunities are skipped instead of becoming new-content.
- [ ] Share missing-meta detection between analyze/decompose.
- [ ] Validate ArticleRecord server-side before creating existing-article proposals.
- [ ] Return useful skipped counts/reasons.

### Task 3: UI And API Hygiene

**Files:**
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx`
- Modify: `app/api/content-pilot/proposals/[id]/generate-draft/route.ts`
- Modify: `app/api/seo/brief/route.ts`
- Test: existing focused tests where practical

- [ ] Key opportunity promoting/promoted state by query + page + type.
- [ ] Change draft-generation rate limit key to shop, then session user, then stable embedded fallback.
- [ ] Validate SEO brief output with Zod and route provider/call failures through the existing 503 response.

### Task 4: Verification And Project Memory

**Files:**
- Modify: `.mex/patterns/seo-pilot-proposal-actions.md`
- Optional modify: `.mex/patterns/INDEX.md`

- [ ] Run focused SEO Pilot tests.
- [ ] Run typecheck.
- [ ] Run full test suite if focused tests and typecheck pass.
- [ ] Run `mex check`.
- [ ] Update the SEO Pilot pattern with the refresh/proposal gotchas.
- [ ] Run `mex log` with the implementation rationale.
