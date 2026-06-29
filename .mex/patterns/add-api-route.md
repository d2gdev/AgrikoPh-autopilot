---
name: add-api-route
description: Adding a new API route to the embedded app or a new cron endpoint. Covers auth, structure, and gotchas for both route types.
triggers:
  - "add endpoint"
  - "new route"
  - "new api"
  - "add cron"
  - "new cron"
edges:
  - target: context/conventions.md
    condition: for the auth gate patterns and verify checklist
  - target: context/architecture.md
    condition: to understand where the route fits in the system
  - target: patterns/add-cron-job.md
    condition: if the route is a cron endpoint with a full job handler
last_updated: 2026-06-25
---

# Add API Route

## Context

Two route types exist in this project:
1. **Embedded app routes** — called by the Shopify admin iframe; auth via App Bridge JWT
2. **Cron routes** — called by the external scheduler; auth via Bearer `CRON_SECRET`

All routes live in `app/api/[resource]/route.ts` (Next.js App Router). Never put business logic in the route handler — put it in `lib/`.

---

## Task: Add Embedded App Route

### Steps

1. Create `app/api/[resource]/route.ts`
2. Start with the mandatory boilerplate:
   ```ts
   import { NextRequest, NextResponse } from "next/server";
   import { prisma } from "@/lib/db";
   import { requireAppAuth } from "@/lib/auth";

   export const dynamic = "force-dynamic";

   export async function GET(req: NextRequest) {
     const authError = await requireAppAuth(req);
     if (authError) return authError;

     // ... handler logic using prisma
     return NextResponse.json({ data });
   }
   ```
3. Put any non-trivial logic in `lib/[feature]/[name].ts` and import it here
4. Validate query params explicitly before using them (see `app/api/recommendations/route.ts` for the pattern — whitelist valid values with a `Set`, reject unknowns with 400)
5. Add the page/component in `app/(embedded)/[feature]/` if this needs a UI

### Gotchas

- `requireAppAuth` is **async** — always `await` it; cron's `requireCronAuth` is sync (don't mix them up)
- Validate all query params — do not trust `req.nextUrl.searchParams` values directly; an invalid `status` or `platform` param passed to Prisma will throw
- `getSessionUser(req)` returns the Shopify user ID for actor attribution in audit logs — use it for mutations that need `reviewedBy`/`actor` fields
- Never read `AUTOPILOT_API_KEY` in route logic — `requireAppAuth` already handles that path; duplicate checks create inconsistency

---

## Task: Add Cron Route

### Steps

1. Create `app/api/cron/[name]/route.ts` with this exact boilerplate:
   ```ts
   import { NextResponse } from "next/server";
   import { requireCronAuth } from "@/lib/auth";
   import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
   import { myJobHandler } from "@/jobs/my-job";

   export const dynamic = "force-dynamic";
   export const maxDuration = 300;

   export async function GET(req: Request) {
     const authError = requireCronAuth(req);  // sync — no await
     if (authError) return authError;

     const acquired = await acquireJobLock("my-job");
     if (!acquired) {
       return Response.json({ skipped: true, reason: "already running" }, { status: 409 });
     }

     try {
       const result = await myJobHandler();
       return NextResponse.json({ ok: true, result });
     } catch (err) {
       console.error("[cron/my-job]", err);
       return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
     } finally {
       await releaseJobLock("my-job");
     }
   }
   ```
2. Create the actual job handler in `jobs/my-job.ts` — see `patterns/add-cron-job.md`
3. Wire the external cron on the VPS to call the new route with the Bearer token

### Gotchas

- `requireCronAuth` is **synchronous** — no `await`; this is the most common mistake when copying from embedded route patterns
- `acquireJobLock` / `releaseJobLock` must always be paired; use `try/finally`
- `maxDuration = 300` is the Vercel limit annotation — it's not enforced on the self-hosted VPS but keep it for documentation
- Cron routes allow unauthenticated pass-through in local dev (`NODE_ENV=development` + local DB) — don't rely on this in tests

### Verify

- [ ] `export const dynamic = "force-dynamic"` present
- [ ] `requireCronAuth(req)` called (sync, no await) before any logic
- [ ] `acquireJobLock` + `releaseJobLock` paired in try/finally
- [ ] Job name string is consistent across `acquireJobLock`, `releaseJobLock`, and the `JobRun.jobName` field
- [ ] Route file is `app/api/cron/[name]/route.ts` (not under `app/api/[name]/`)

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Current Project State" if what's working/not built has changed
- [ ] Update any `.mex/context/` files that are now out of date
- [ ] If this is a new task type without a pattern, create one in `.mex/patterns/` and add to `INDEX.md`
