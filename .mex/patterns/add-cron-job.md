---
name: add-cron-job
description: Adding a new job handler in jobs/ — the full pattern for writing a job that fetches data, writes a JobRun row, and returns a typed JobResult.
triggers:
  - "new job"
  - "job handler"
  - "JobRun"
  - "JobResult"
  - "fetch job"
  - "add connector"
edges:
  - target: context/data-pipeline.md
    condition: for the full pipeline context and RawSnapshot conventions
  - target: context/conventions.md
    condition: for the verify checklist
  - target: patterns/add-api-route.md
    condition: for the cron route that calls this handler
  - target: patterns/debug-pipeline.md
    condition: when the job handler is failing
last_updated: 2026-06-25
---

# Add Cron Job Handler

## Context

Job handlers live in `jobs/[name].ts`. They are called by cron route handlers in `app/api/cron/[name]/route.ts`. Each handler is responsible for:
- Creating a `JobRun` row (or having the cron route create it)
- Calling the connector(s)
- Upserting `RawSnapshot` rows
- Returning a `JobResult<TSummary>` shape

The `JobResult` type comes from `lib/jobs/types.ts`. Use `isJobSuccessful()` to test for both `success` and `partial`.

## Steps

1. Create `jobs/my-job.ts`:
   ```ts
   import { prisma } from "@/lib/db";
   import type { JobResult } from "@/lib/jobs/types";

   type MySummary = {
     snapshotsFetched: number;
     errors: string[];
   };

   export async function myJobHandler(): Promise<JobResult<MySummary>> {
     const jobRun = await prisma.jobRun.create({
       data: { jobName: "my-job", triggeredBy: "scheduler", status: "running" },
     });

     const errors: string[] = [];
     let snapshotsFetched = 0;

     try {
       // 1. Fetch data from connector
       // 2. Upsert RawSnapshot rows
       // 3. Collect errors per-item (partial failures are valid)

       const status = errors.length === 0 ? "success" : "partial";
       await prisma.jobRun.update({
         where: { id: jobRun.id },
         data: { status, completedAt: new Date(), summary: { snapshotsFetched } },
       });

       return { jobName: "my-job", runId: jobRun.id, status, summary: { snapshotsFetched, errors }, errors };
     } catch (err) {
       const message = err instanceof Error ? err.message : String(err);
       errors.push(message);
       await prisma.jobRun.update({
         where: { id: jobRun.id },
         data: { status: "failed", completedAt: new Date(), errorLog: errors.join("\n") },
       });
       return { jobName: "my-job", runId: jobRun.id, status: "failed", summary: { snapshotsFetched, errors }, errors };
     }
   }
   ```

2. If this job fetches data for AI skills, upsert `RawSnapshot` with:
   ```ts
   await prisma.rawSnapshot.upsert({
     where: { source_dateRangeStart_dateRangeEnd: { source: "my-source", dateRangeStart, dateRangeEnd } },
     create: { source: "my-source", dateRangeStart, dateRangeEnd, payload, jobRunId: jobRun.id },
     update: { payload, jobRunId: jobRun.id, fetchedAt: new Date() },
   });
   ```

3. Create the cron route in `app/api/cron/my-job/route.ts` — see `patterns/add-api-route.md#task-add-cron-route`

4. Wire to the external VPS cron (edit the crontab on `autopilot-prod` or document in `docs/CRON.md`)

## Gotchas

- **Partial vs failed:** Use `partial` status when some items succeeded but others failed. The daily cron considers `partial` as "succeeded" for the purposes of deciding whether to run skills. Use `failed` only when the entire job produced nothing useful.
- **RawSnapshot unique key:** `(source, dateRangeStart, dateRangeEnd)` — always upsert. An insert will throw a unique constraint error if the same time range was already fetched.
- **`source` string must be consistent:** The skill orchestrator selects snapshots by `source` value. Inventing a new source string means skills won't automatically pick it up — you may need to update skill selection logic in `lib/skills/orchestrator.ts`.
- **JobRun status stuck at `running`:** If the handler throws before the update, the `JobRun` row stays `running`. The `catch` block must always update to `failed`. Never let the status stay `running`.
- **Alert wiring:** If this job should trigger failure alerts, call `notifyJobFailure` from the cron route (see how `/api/cron/daily` handles `settledStatus`), not from inside the handler.

## Verify

- [ ] Job handler creates a `JobRun` row with `status: "running"` at the start
- [ ] Both success and error paths update `JobRun.status` and set `completedAt`
- [ ] `RawSnapshot` is upserted (not inserted) using the composite unique key
- [ ] Handler returns `JobResult<TSummary>` shape with `jobName`, `runId`, `status`, `summary`, `errors`
- [ ] Cron route calls `acquireJobLock("my-job")` with the same job name string as `JobRun.jobName`
- [ ] New `source` value is documented and, if needed, wired into skill orchestrator selection

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Current Project State" if what's working/not built has changed
- [ ] Update `context/data-pipeline.md` job handlers table with the new job
- [ ] If this is a new task type without a pattern, create one in `.mex/patterns/` and add to `INDEX.md`
