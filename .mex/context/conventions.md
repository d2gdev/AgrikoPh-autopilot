---
name: conventions
description: How code is written in this project — naming, structure, patterns, and style. Load when writing new code or reviewing existing code.
triggers:
  - "convention"
  - "pattern"
  - "naming"
  - "style"
  - "how should I"
  - "what's the right way"
edges:
  - target: context/architecture.md
    condition: when a convention depends on understanding the system structure
  - target: patterns/add-api-route.md
    condition: when adding a new API route or cron endpoint
  - target: context/skills-recommendations.md
    condition: when writing skill or recommendation handling code
last_updated: 2026-07-10
---

# Conventions

## Naming

- **Files:** kebab-case everywhere (`fetch-ads-data.ts`, `job-lock.ts`, not `fetchAdsData.ts`)
- **API route files:** always `route.ts` inside `app/api/[resource]/` (Next.js App Router convention)
- **Job handlers:** named `[name]Handler` and exported from `jobs/[name].ts` (e.g. `fetchAdsDataHandler` from `jobs/fetch-ads-data.ts`)
- **Path alias:** `@/` maps to project root — always use it for cross-directory imports, never relative `../../`
- **DB import:** always `import { prisma } from "@/lib/db"` — the variable name `prisma` is the convention everywhere

## Structure

- Embedded app UI pages live in `app/(embedded)/` — route groups organize by feature (e.g. `(ad-pilot)`, `(content-pilot)`, `(market-intelligence)`)
- API routes live in `app/api/[resource]/route.ts`; business logic goes in `lib/`, not in the route handler
- Job handler functions live in `jobs/[name].ts` — called by cron route handlers in `app/api/cron/[name]/route.ts`
- AI prompts (skill definitions) live as markdown files in `skills-source/` — loaded at runtime by `lib/skills/loader.ts`; never hard-code prompts in TypeScript
- Tests live in `__tests__/` mirroring the source path (e.g. `__tests__/lib/auth.test.ts`) or in `tests/` for integration/smoke tests

## Patterns

**Auth gate — every embedded app route handler, always first:**
```ts
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  // ... handler logic
}
```

**Permission gate — operator mutations, always first:**
```ts
export async function POST(req: Request) {
  const authError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (authError) return authError;
  // ... handler logic
}
```
`requirePermission` authenticates the request before checking the named role. Keep
read-only handlers on `requireAppAuth`; keep publish mutations on their separate
`CONTENT_PUBLISH` permission instead of broadening `CONTENT_REVIEW`.

**Auth gate — every cron route handler:**
```ts
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const authError = requireCronAuth(req);  // sync, not async
  if (authError) return authError;

  const acquired = await acquireJobLock("job-name");
  if (!acquired) return Response.json({ skipped: true }, { status: 409 });

  try {
    // ... job logic
  } finally {
    await releaseJobLock("job-name");
  }
}
```

**Job result shape — all job handlers must return this:**
```ts
// from lib/jobs/types.ts
return {
  jobName: "fetch-ads-data",
  runId: jobRun.id,
  status: "success" | "partial" | "failed",
  summary: { /* job-specific fields */ },
  errors: [],
} satisfies JobResult<MySummaryType>;
```

**LLM output validation — always validate with Zod before persisting:**
```ts
const result = MySchema.safeParse(rawLLMOutput);
if (!result.success) { /* log and skip, never throw */ }
const validated = result.data;
```

## Verify Checklist

Before presenting any code change:
- [ ] New API route exports `export const dynamic = "force-dynamic"` at the top
- [ ] Embedded read handler calls `await requireAppAuth(req)` as the very first statement; an operator mutation calls `await requirePermission(req, PERMISSIONS.<role>)` as its very first statement
- [ ] Cron route calls `requireCronAuth(req)` (sync) then `acquireJobLock` with a matching `releaseJobLock` in `finally`
- [ ] All database access imports `prisma` from `@/lib/db` — no `new PrismaClient()` anywhere
- [ ] LLM outputs are validated with Zod `.safeParse()` before any `prisma.*.create()` or `prisma.*.update()`
- [ ] No `NEXT_PUBLIC_*` env var wraps a secret credential (`AUTOPILOT_API_KEY`, `CRON_SECRET`, etc.)
- [ ] New job handlers write a `JobRun` row and return a `JobResult<T>` shape
- [ ] Skills-source prompts are markdown files in `skills-source/` — not strings in TypeScript
