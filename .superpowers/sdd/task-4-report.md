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

Follow-up command via SSH tunnel to production Postgres:

- Opened tunnel: `ssh -N -L 15432:localhost:5432 autopilot-prod`
- Ran: `DATABASE_URL=<production-url-rewritten-to-127.0.0.1:15432> npx tsx scripts/verify-skill-source-registry.ts`

Observed output:

```text
Database URL source: DATABASE_URL
Verifying source registry against persisted PostgreSQL data
source=gsc | status=stale | latestAt=2026-07-05T16:12:01.472Z | evidenceId=cmrc9zz1x0ahvs68i47lpq9dr | rowCount=1145 | baseSource=gsc | baseId=cmrc9zz1x0ahvs68i47lpq9dr
source=gsc_query_page | status=stale | latestAt=2026-07-05T16:12:01.472Z | evidenceId=cmrc9zzbd0bk4s68ivtzbkqoc | rowCount=1375 | baseSource=gsc_query_page | baseId=cmrc9zzbd0bk4s68ivtzbkqoc
source=ga4 | status=stale | latestAt=2026-07-05T16:12:01.472Z | evidenceId=cmrc9zzia0bk6s68i7sicu86t | rowCount=247 | baseSource=ga4 | baseId=cmrc9zzia0bk6s68i7sicu86t
source=blog | status=fresh | latestAt=2026-07-08T01:00:04.163Z | evidenceId=cmrbdf6bp0947s68ixou6c0pc | rowCount=648 | baseSource=blog | baseId=cmrbdf6bp0947s68ixou6c0pc
source=market_intel | status=fresh | latestAt=2026-07-08T00:00:00.000Z | evidenceId=cmrbn3nlr09uys68i19wvbj0b | rowCount=14 | baseSource=shopify_catalog | baseId=cmrbn3nlr09uys68i19wvbj0b
source=keyword_research | status=fresh | latestAt=2026-07-08T16:12:04.237Z | evidenceId=cmrbnmycz0a6ms68ik4fm6liy | rowCount=487 | baseSource=keyword_research | baseId=keyword-research-fallback
source=dataforseo_ranked | status=stale | latestAt=2026-07-05T00:00:00.000Z | evidenceId=cmr7cr2t201x7s6rlrr0k30bh | rowCount=0 | baseSource=dataforseo_ranked | baseId=cmr7cr2t201x7s6rlrr0k30bh
source=shopify_catalog | status=fresh | latestAt=2026-07-08T00:00:00.000Z | evidenceId=cmrbn3nlr09uys68i19wvbj0b | rowCount=14 | baseSource=shopify_catalog | baseId=cmrbn3nlr09uys68i19wvbj0b
source=shopify_orders | status=fresh | latestAt=2026-07-08T00:00:00.000Z | evidenceId=cmrbkdwh309tys68iij9y7ua6 | rowCount=0 | baseSource=shopify_orders | baseId=cmrbkdwh309tys68iij9y7ua6
```

Follow-up result:

- PASS: the committed verification script successfully read real persisted production PostgreSQL rows through the app Prisma singleton.
- PASS: organic source statuses and base snapshots came from real rows/snapshots, not mocked fixtures.
- Note: `keyword_research` used the source-registry's persisted-row fallback because production has not yet run the new Task 3 `RawSnapshot("keyword_research")` writer.

## Concerns

- `skillsUnavailable` currently records source-registry problems and missing base snapshots, but Meta-only ineligibility is still represented by the job-level failure path rather than a synthetic `meta` source entry. That matches the current type surface because `meta` is not a `SkillDataSource`.

## Task 4 fix verification (2026-07-09)

Changed files:

- `jobs/run-skills.ts`
- `__tests__/jobs/run-skills-source-requirements.test.ts`

Behavior change:

- `platform: "seo"` skills now require at least one organic source in their required/optional/extra contract before they are eligible to run.
- Source-less SEO skills are skipped before dispatch, never receive the Meta snapshot as a fallback, and are reported in `summary.skillsUnavailable` with reason `seo skill has no organic source contract`.
- Meta and both-platform skill behavior is unchanged.

Red-green verification:

- Added failing regression test for a source-less SEO skill.
- Observed failure before the fix: `runSkill` was called with the `meta` snapshot for `seo-without-contract`.
- Re-ran after the fix and confirmed the regression test passes.

Commands run:

```text
npm test -- run-skills-source-requirements
npm test -- run-skills
npx tsc --noEmit
```

Results:

- PASS: `npm test -- run-skills-source-requirements` → 1 file passed, 2 tests passed.
- PASS: `npm test -- run-skills` → 5 files passed, 31 tests passed.
- PASS: `npx tsc --noEmit` → exit code 0.
