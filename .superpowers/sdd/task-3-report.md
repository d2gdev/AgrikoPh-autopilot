# Task 3 Report: Keyword Research Snapshot Evidence

## What I implemented

- Added a focused unit test proving `fetchKeywordResearchHandler()` writes a persisted `RawSnapshot` with `source: "keyword_research"` for skill evidence consumption.
- Extended the Prisma test mock surface to cover:
  - `jobRun.findUnique`
  - `keywordResearchResult.findMany`
  - `rawSnapshot.upsert`
- Updated `jobs/fetch-keyword-research.ts` to:
  - read the latest persisted `KeywordResearchResult` rows from PostgreSQL via `prisma`
  - build the required snapshot payload
  - upsert a real `RawSnapshot("keyword_research")` keyed by the capture-day UTC date range
  - attach the current `jobRunId` on create/update

## Test commands and results

- `npm test -- fetch-keyword-research`
  - RED: failed as expected once the test harness covered the `runId` lookup path, because `rawSnapshot.upsert` had `0` calls
  - GREEN: passed with `Test Files 1 passed (1)` and `Tests 3 passed (3)`

## TDD Evidence

### RED

1. Added the failing snapshot-evidence test in `__tests__/jobs/fetch-keyword-research.test.ts`.
2. First execution exposed missing mock surface:
   - `TypeError: prisma.jobRun.findUnique is not a function`
3. Fixed the test harness to cover the existing runtime path, then reran RED.
4. Confirmed behavioral failure:
   - `AssertionError: expected "vi.fn()" to be called`
   - `Number of calls: 0`
   - target: `mockPrisma.rawSnapshot.upsert`

### GREEN

1. Implemented the `keyword_research` snapshot upsert in `jobs/fetch-keyword-research.ts`.
2. Reran `npm test -- fetch-keyword-research`.
3. Confirmed passing result:
   - `Test Files 1 passed (1)`
   - `Tests 3 passed (3)`

## Files changed

- `jobs/fetch-keyword-research.ts`
- `__tests__/jobs/fetch-keyword-research.test.ts`
- `.superpowers/sdd/task-3-report.md`

## Self-review findings

- Runtime code uses `import { prisma } from "@/lib/db"` only.
- No fixture data was introduced into runtime logic; the snapshot is built from persisted `keywordResearchResult` rows.
- The snapshot write is scoped to the capture-day UTC range and uses `rawSnapshot.upsert`, matching the existing `RawSnapshot` uniqueness model.
- The test remains focused on the task’s contract: a `keyword_research` snapshot exists with the expected evidence payload.
- No unrelated files were edited.

## Verify checklist

- New API route exports `dynamic`: not applicable, no route changes
- Embedded route auth first statement: not applicable, no route changes
- Cron auth + job lock: not applicable, no route changes
- All DB access imports `prisma` from `@/lib/db`: pass
- LLM outputs validated with Zod before persistence: not applicable, no LLM path changed
- No `NEXT_PUBLIC_*` secret exposure: pass
- New job handlers write `JobRun` and return `JobResult<T>`: not applicable, existing handler updated only
- Skills prompts in markdown, not TS strings: not applicable

## Concerns

- None.

## Review remediation (2026-07-09)

- Fixed the critical day-scoping bug in `jobs/fetch-keyword-research.ts`: the snapshot payload query now reads `keywordResearchResult` rows only from the same UTC capture window used by `RawSnapshot("keyword_research")`, via `where: { capturedAt: { gte: start, lt: end } }`.
- Strengthened the regression test in `__tests__/jobs/fetch-keyword-research.test.ts` by freezing time and asserting the `findMany` call includes the exact current-day `capturedAt` bounds, plus the matching snapshot date-range key.

## Review remediation verification

- `npm test -- fetch-keyword-research`: pass (`Test Files 1 passed (1)`, `Tests 3 passed (3)`)
- `npx tsc --noEmit`: pass
