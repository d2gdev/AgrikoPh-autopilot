# 2026-07-09 SEO + Content Pilot Audit Findings

## SEO Pilot Findings
- [Critical] Active duplication checks ignore already-published rows, so SEO-derived proposals can be regenerated repeatedly.
  - `app/api/seo/gaps/promote/route.ts:26` defines `ACTIVE_STATUSES = ["pending", "approved", "override_approved"]` and uses that set for duplicate checks at `app/api/seo/gaps/promote/route.ts:88`.
  - `app/api/seo/recommendations/decompose/route.ts:13` uses the same narrow status set and ignores `published` at `app/api/seo/recommendations/decompose/route.ts:245`.
  - Impact: published or completed SEO items can re-enter as fresh suggestions and keep reappearing.

- [Critical] Current dedupe model does not prevent duplicate row creation under concurrent promotion.
  - `app/api/seo/gaps/promote/route.ts:75-79` explicitly notes the missing DB unique index for title/type/status dedupe.
  - Impact: concurrent requests can create duplicate proposals despite in-transaction checks.

## Content Pilot Findings
- [Critical] Opportunities are upserted before proposal replacement filtering, which creates stale opportunity rows for proposals that never get created.
  - `app/api/content-pilot/proposals/generate/route.ts:25-30` persists opportunities before any dedupe/replacement filtering.
  - The replacement filter (`activeKeys` + `fresh`) runs later at `app/api/content-pilot/proposals/generate/route.ts:60-75`.
  - Cron runs the same flow in `app/api/cron/daily/route.ts:113-126`.
  - `lib/opportunities/generate.ts:401-406` performs unconditional per-row upserts by dedupe key.
  - Impact: opportunities become open/visible for content that is dropped as duplicate (`already exists`), causing noisy and inaccurate opportunity metrics.

- [Critical] Null/empty handle proposals collapse into a synthetic dedupe key and suppress distinct topics.
  - `app/api/content-pilot/proposals/generate/route.ts:66-67` and `app/api/cron/daily/route.ts:121-125` use `"__null__"` for null handles.
  - Filtering compares only `articleHandle + proposalType`, so unrelated new-content proposals can suppress each other.
  - Impact: valid keyword-gap opportunities are dropped as duplicates.

- [Important] `override_approved` status parity is inconsistent across duplicate-suppression paths.
  - `app/api/content-pilot/proposals/manual/route.ts:29` and `app/api/seo/gaps/promote/route.ts:26` treat `override_approved` as active.
  - `app/api/content-pilot/proposals/generate/route.ts:35-40` and `app/api/content-pilot/proposals/generate/route.ts:60-67` do not include it in replacement suppression.
  - `lib/opportunities/route.ts:55` includes it for active-opportunity routing.
  - Impact: same intent can be considered duplicate in one surface and fresh in another.

- [Important] Gap promotion UX can claim creation even when nothing was added.
  - `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx:128` and `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx:147` build `Created...`/`Already planned` messaging without explicit no-op checks.
  - Impact: operator confidence drops due to false-positive success signals.

- [Minor] Proposal list API omits `override_approved` from status filtering.
  - `app/api/content-pilot/proposals/route.ts:17-20` only allows `pending`, `approved`, `rejected`, `published`.
  - Impact: audit and triage views miss an operational status.

- [Minor] Route-level test coverage for content-pilot generation paths is currently missing.
  - `npm test -- __tests__/api/content-pilot-routes.test.ts` returns `No test files found`.
  - Impact: endpoint-level regression risk is higher because generate/cron suppression behavior has no direct API test lock.

## Severity Ranking
- [Critical] Fix stale opportunities created from dropped proposals.
  - Owner: Shared runtime (`app/api/content-pilot/proposals/generate/route.ts`, `app/api/cron/daily/route.ts`, `lib/opportunities/generate.ts`).
  - Fix effort: med.
  - Risk of fix: low.

- [Critical] Fix null-handle dedupe collapse so distinct new-content opportunities are not dropped.
  - Owner: Shared runtime (`app/api/content-pilot/proposals/generate/route.ts`, `app/api/cron/daily/route.ts`).
  - Fix effort: low.
  - Risk of fix: low.

- [Critical] Fix published-state parity in SEO/content replacement checks.
  - Owner: SEO + Content runtime (`app/api/seo/gaps/promote/route.ts`, `app/api/seo/recommendations/decompose/route.ts`, `app/api/content-pilot/proposals/generate/route.ts`, `app/api/cron/daily/route.ts`, `lib/opportunities/route.ts`).
  - Fix effort: med.
  - Risk of fix: low.

- [Important] Normalize `override_approved` handling across all dedupe surfaces.
  - Owner: Shared runtime (`app/api/content-pilot/proposals/manual/route.ts`, `app/api/content-pilot/proposals/generate/route.ts`, `app/api/seo/gaps/promote/route.ts`, `lib/opportunities/route.ts`).
  - Fix effort: med.
  - Risk of fix: low.

- [Important] Improve no-op UX messaging and race hardening.
  - Owner: SEO UI + runtime (`app/(embedded)/(seo-pillar)/seo-pillar/page.tsx`, `app/api/seo/gaps/promote/route.ts`).
  - Fix effort: low.
  - Risk of fix: low.

- [Minor] Add status filter support and route-level regression coverage.
  - Owner: Content runtime (`app/api/content-pilot/proposals/route.ts`, `__tests__/api/content-pilot-routes.test.ts`).
  - Fix effort: low.
  - Risk of fix: low.
