# Task 4 Report: Source-Aware Run-Skills Eligibility

## What I implemented

- Updated [`jobs/run-skills.ts`](/home/sean/Agriko/auto-pilot/jobs/run-skills.ts) to:
  - derive per-skill `requiredSources`, `optionalSources`, and full context-source unions
  - check required source status through `checkSourceStatus()`
  - refresh missing/stale required sources once per run with `refreshSourcesOnce()`
  - store `summary.sourceStatus`, `summary.sourceRefreshes`, and `summary.skillsUnavailable`
  - stop hard-failing immediately when Meta is missing
  - allow `platform: "seo"` skills to run without a Meta snapshot
  - select organic base snapshots from `selectBaseSnapshotForSource(primarySource)` while leaving meta/both skills Meta-backed unless they explicitly choose another primary source
  - preserve the existing v2 input hash behavior, deferred-hash preservation, and failed/truncated hash removal
- Updated [`lib/skills/extra-context.ts`](/home/sean/Agriko/auto-pilot/lib/skills/extra-context.ts) so the source-contract union can hydrate side context for snapshot-backed sources (`blog`, `dataforseo_ranked`, `shopify_catalog`, `shopify_orders`) in addition to the existing normalized builders.
- Added [`__tests__/jobs/run-skills-source-requirements.test.ts`](/home/sean/Agriko/auto-pilot/__tests__/jobs/run-skills-source-requirements.test.ts) for the SEO-without-Meta regression.
- Updated the existing run-skills suites to mock `source-registry` explicitly and to keep the hash/rotation assertions aligned with the new source-aware dispatch path.
- Added [`scripts/verify-skill-source-registry.ts`](/home/sean/Agriko/auto-pilot/scripts/verify-skill-source-registry.ts), a read-only real-data verification script that loads `.env`, reuses the app's `@/lib/db` Prisma singleton, checks `checkSourceStatus()` and `selectBaseSnapshotForSource()` against the configured PostgreSQL database, prints source/base-snapshot diagnostics for the nine organic sources, exits nonzero when no DB URL is configured or every source is `missing`/`error`, and always calls `prisma.$disconnect()` in `finally`.
- Updated [`lib/skills/loader.ts`](/home/sean/Agriko/auto-pilot/lib/skills/loader.ts) so SEO is no longer described as undispatched; LinkedIn and Reddit warnings remain intact.

## Test commands and results

- `npm test -- run-skills-source-requirements`
  - RED: 1 failed, expected `success`, received `failed`
  - GREEN: 1 passed
- `npm test -- loader`
  - PASS: loader suite passed, including the focused SEO-warning assertion
- `npm test -- run-skills`
  - PASS: 5 files, 30 tests passed
- `npx tsx scripts/verify-skill-source-registry.ts`
  - FAIL: Prisma could not reach the configured PostgreSQL host `172.105.161.83:5432`
- `npx tsc --noEmit`
  - PASS: exit code 0

## TDD Evidence

### RED

- Added the new regression test for `platform: "seo"` running from `gsc` without Meta.
- Ran `npm test -- run-skills-source-requirements`.
- Observed the intended failure: `runSkillsHandler()` returned `status: "failed"` because the job still hard-failed on missing Meta.

### GREEN

- Implemented source-aware eligibility, refresh diagnostics, and per-skill base snapshot selection.
- Re-ran `npm test -- run-skills-source-requirements` and got a pass.
- Re-ran `npm test -- run-skills` and `npx tsc --noEmit`; both passed after one follow-up fix to keep meta/both skills Meta-backed by default.
- Added and ran a read-only verification script against the configured PostgreSQL database to confirm `checkSourceStatus()` and `selectBaseSnapshotForSource()` behavior on persisted organic-source data; the local run failed on live DB connectivity before any source rows could be read.

## Files changed

- [`jobs/run-skills.ts`](/home/sean/Agriko/auto-pilot/jobs/run-skills.ts)
- [`lib/skills/extra-context.ts`](/home/sean/Agriko/auto-pilot/lib/skills/extra-context.ts)
- [`__tests__/jobs/run-skills-source-requirements.test.ts`](/home/sean/Agriko/auto-pilot/__tests__/jobs/run-skills-source-requirements.test.ts)
- [`__tests__/jobs/run-skills.test.ts`](/home/sean/Agriko/auto-pilot/__tests__/jobs/run-skills.test.ts)
- [`__tests__/jobs/run-skills.filtering.test.ts`](/home/sean/Agriko/auto-pilot/__tests__/jobs/run-skills.filtering.test.ts)
- [`__tests__/jobs/run-skills.rotation.test.ts`](/home/sean/Agriko/auto-pilot/__tests__/jobs/run-skills.rotation.test.ts)
- [`__tests__/jobs/run-skills-hash.test.ts`](/home/sean/Agriko/auto-pilot/__tests__/jobs/run-skills-hash.test.ts)
- [`__tests__/lib/skills/loader.test.ts`](/home/sean/Agriko/auto-pilot/__tests__/lib/skills/loader.test.ts)
- [`scripts/verify-skill-source-registry.ts`](/home/sean/Agriko/auto-pilot/scripts/verify-skill-source-registry.ts)

## Self-review findings

- The source refresh is run once per unique required source before eligibility decisions, as required.
- SEO skills no longer depend on Meta presence.
- Meta/both skills still default to Meta snapshots unless a `primarySource` is declared explicitly.
- Base-snapshot absence after eligibility is recorded into `skillsUnavailable` without polluting hash preservation.
- Existing hash-hardening behavior remains intact under the updated suite.

## Verify Checklist

- New API route exports `export const dynamic = "force-dynamic"` at the top: N/A, no route changes
- Embedded app route calls `await requireAppAuth(req)` as the very first statement in every handler: N/A, no route changes
- Cron route calls `requireCronAuth(req)` then `acquireJobLock` with matching `releaseJobLock` in `finally`: N/A, no route changes
- All database access imports `prisma` from `@/lib/db` — no `new PrismaClient()` anywhere: PASS
- LLM outputs are validated with Zod `.safeParse()` before persistence: PASS, unchanged in this task
- No `NEXT_PUBLIC_*` env var wraps a secret credential: PASS, no env var changes
- New job handlers write a `JobRun` row and return a `JobResult<T>` shape: N/A, existing handler updated in place
- Skills-source prompts are markdown files in `skills-source/` — not strings in TypeScript: PASS, no prompt changes

## Real-data verification

Command:

- `npx tsx scripts/verify-skill-source-registry.ts`

Observed output:

```text
Database URL source: DATABASE_URL
Verifying source registry against persisted PostgreSQL data
prisma:error
Invalid `prisma.rawSnapshot.findFirst()` invocation in
/home/sean/Agriko/auto-pilot/lib/skills/source-registry.ts:84:29

Can't reach database server at `172.105.161.83:5432`

Please make sure your database server is running at `172.105.161.83:5432`.
PrismaClientInitializationError:
Invalid `prisma.rawSnapshot.findFirst()` invocation in
/home/sean/Agriko/auto-pilot/lib/skills/source-registry.ts:84:29

Can't reach database server at `172.105.161.83:5432`

Please make sure your database server is running at `172.105.161.83:5432`.
```

Result:

- The verification script is committed and uses the real app Prisma singleton plus the configured environment, as required.
- Runtime verification against persisted PostgreSQL data could not complete locally because Prisma could not connect to the configured host.

## Concerns

- `skillsUnavailable` currently records source-registry problems and missing base snapshots, but Meta-only ineligibility is still represented by the job-level failure path rather than a synthetic `meta` source entry. That matches the current type surface because `meta` is not a `SkillDataSource`.
