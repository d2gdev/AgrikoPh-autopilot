# Phase 1 — Operator Visibility: External Alerts + Outcome Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator learns about pending work without opening the app (webhook event alerts + a daily digest), and can finally see whether past approvals worked (outcome badges on executed recommendations + a dashboard win-rate stat).

**Architecture:** 1A extends the existing `lib/alerts.ts` webhook transport (module-private `postWebhook`, already no-ops without `ALERT_WEBHOOK_URL` and never throws) with a typed `sendOperatorAlert(kind, payload)` wrapper, wires it into three existing jobs, and adds one new cron job (`daily-digest`). 1B is surface-only: `jobs/check-outcomes.ts` already populates `Recommendation.outcome` (a Json `{ verdict, metricsBefore, metricsAfter, deltas, windowDays, checkedAt }`) and `outcomeCheckedAt` — we render them. No schema changes, no migration.

**Tech Stack:** Next.js 14 App Router, Polaris, Prisma/PostgreSQL, Vitest.

## Global Constraints

- **Keyword Planner is untouchable** (user directive, clarified 2026-07-03: the "no Google Ads" ban covers advertising only, never keyword research). Nothing in this phase touches `lib/connectors/google-ads.ts`, `jobs/fetch-keyword-research.ts`, the `google_ads_keyword_research` connector-health entry, or `GOOGLE_ADS_*` env vars. If any step appears to require it, stop and surface to the operator.
- No live external writes in this phase — alerts POST to the operator's own `ALERT_WEBHOOK_URL` (existing, optional env; everything must degrade to a silent no-op when it is unset, exactly as `postWebhook` already does).
- All DB access via `import { prisma } from "@/lib/db"`. Cron routes: `requireCronAuth(req)` then `acquireJobLock` (clone the shape of `app/api/cron/run-skills/route.ts`).
- No Prisma migration in this phase. Additive code only.
- **Outcome verdict values are exactly** `"improved" | "worsened" | "neutral" | "insufficient_data"` (the `Verdict` union in `lib/recommendations/outcome-metrics.ts:13`). Do not invent `no_change`/`inconclusive` — they do not exist in this codebase.
- Shared UI helpers are mandatory: `timeAgo` from `lib/format.ts`, tones in `lib/ui/tones.ts` (`Tone = BadgeProps["tone"]`), skeletons from `components/ui/states.tsx`. No hand-rolled equivalents.
- Verify gate at the end: `npx tsc --noEmit` clean, `npm test` green, `npm run build` clean. New job logic gets Vitest coverage in `__tests__/` following existing mock patterns.
- After the phase: update `.mex/ROUTER.md`, commit + push to main, 🚀 **deploy** per `.mex/patterns/deploy.md` (Phase 1 is a deploy checkpoint; no migration step needed).

---

### Task 1: `sendOperatorAlert` typed wrapper in `lib/alerts.ts`

**Files:**
- Modify: `lib/alerts.ts`
- Test: `__tests__/lib/alerts.test.ts` (check for existence first; create if absent)

**Interfaces:**
- Produces: `sendOperatorAlert(kind: OperatorAlertKind, payload: Record<string, unknown>): Promise<void>` where `OperatorAlertKind = "new_recommendations" | "execution_failed" | "hard_block" | "sla_escalation" | "daily_digest"`. **Never throws** and **no-ops when `ALERT_WEBHOOK_URL` is unset** — this invariant is what lets Tasks 2–4 call it from inside jobs without wrapping in try/catch and without breaking any existing test (existing job tests don't set the env var, so the wrapper exits before touching `fetch` or prisma).

- [ ] **Step 1: Check whether an alerts test file already exists**

Run: `ls __tests__/lib/ | grep -i alert`
If a file exists, add the new `describe` block below into it; otherwise create `__tests__/lib/alerts.test.ts` with the full content in Step 2.

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// lib/alerts.ts imports prisma at module scope — stub it so the import doesn't
// initialize a client. sendOperatorAlert itself never touches prisma.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { sendOperatorAlert } from "@/lib/alerts";

describe("sendOperatorAlert", () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("no-ops when ALERT_WEBHOOK_URL is unset", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    await sendOperatorAlert("new_recommendations", { count: 3 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts kind as type plus payload and timestamp when configured", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example.test/x");
    await sendOperatorAlert("daily_digest", { pendingRecommendations: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.type).toBe("daily_digest");
    expect(body.pendingRecommendations).toBe(5);
    expect(typeof body.timestamp).toBe("string");
  });

  it("never throws when the webhook fails", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example.test/x");
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(sendOperatorAlert("execution_failed", {})).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run __tests__/lib/alerts.test.ts`
Expected: FAIL — `sendOperatorAlert` is not exported.

- [ ] **Step 4: Implement in `lib/alerts.ts`**

Append next to the existing `sendOpsWebhook` export at the bottom of the file:

```typescript
export type OperatorAlertKind =
  | "new_recommendations"
  | "execution_failed"
  | "hard_block"
  | "sla_escalation"
  | "daily_digest";

// Typed operator-alert wrapper over the ops webhook. Never throws; no-ops
// when ALERT_WEBHOOK_URL is unset (both guaranteed by postWebhook).
export async function sendOperatorAlert(
  kind: OperatorAlertKind,
  payload: Record<string, unknown>,
): Promise<void> {
  await postWebhook({
    type: kind,
    appUrl: process.env.SHOPIFY_APP_URL ?? null,
    timestamp: new Date().toISOString(),
    ...payload,
  });
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run __tests__/lib/alerts.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/alerts.ts __tests__/lib/alerts.test.ts
git commit -m "feat(alerts): typed sendOperatorAlert wrapper over the ops webhook"
```

---

### Task 2: Event alert — new recommendations created by run-skills

**Files:**
- Modify: `jobs/run-skills.ts`
- Test: existing `__tests__/jobs/run-skills*.test.ts` suites must stay green (no changes expected — see the Task 1 invariant)

**Interfaces:**
- Consumes: `sendOperatorAlert` from Task 1.

- [ ] **Step 1: Add the import**

At the top of `jobs/run-skills.ts`, alongside the existing imports:

```typescript
import { sendOperatorAlert } from "@/lib/alerts";
```

- [ ] **Step 2: Fire the alert after the JobRun summary update**

Locate the end of `runSkillsHandler` — the `await prisma.jobRun.update({ where: { id: runId }, ... })` call followed by `return { newRecs: totalRecs, jobName: "run-skills", runId, status, summary, errors };` (~line 290–301). Insert between them:

```typescript
  if (totalRecs > 0) {
    await sendOperatorAlert("new_recommendations", {
      count: totalRecs,
      runId,
      skillsRun: summary.skillsRun,
    });
  }
```

- [ ] **Step 3: Run the run-skills suites**

Run: `npx vitest run __tests__/jobs/run-skills.test.ts __tests__/jobs/run-skills.filtering.test.ts __tests__/jobs/run-skills.rotation.test.ts`
Expected: PASS unchanged (the wrapper no-ops without `ALERT_WEBHOOK_URL`). If any test *does* set that env var or asserts on fetch, update it to mock `@/lib/alerts` with `vi.mock("@/lib/alerts", () => ({ sendOperatorAlert: vi.fn() }))` instead.

- [ ] **Step 4: Commit**

```bash
git add jobs/run-skills.ts
git commit -m "feat(alerts): notify operator when run-skills creates recommendations"
```

---

### Task 3: Event alerts — live execution failure and live guardrail hard-block

**Files:**
- Modify: `jobs/execute-approved.ts`
- Test: `__tests__/jobs/execute-approved.test.ts` must stay green

- [ ] **Step 1: Add the import**

```typescript
import { sendOperatorAlert } from "@/lib/alerts";
```

- [ ] **Step 2: Execution-failure alert (live runs only)**

Locate the per-recommendation `catch (err)` block around lines 346–378 — it computes `const safeError = safeErrorMessage(err)`, increments `counters.failed++`, and then branches `if (dryRun) { await audit; } else { await prisma.$transaction([...]) }`. **Read the full block first.** In the **non-dry-run branch only**, after the `await prisma.$transaction([...])`, add:

```typescript
        await sendOperatorAlert("execution_failed", {
          recommendationId: rec.id,
          targetEntityName: rec.targetEntityName,
          actionType: rec.actionType,
          error: safeError,
        });
```

- [ ] **Step 3: Hard-block alert (live runs only)**

Locate the `if (guard.status === "hard_block")` branch (~line 251) — it increments `counters.blocked++`, builds an audit row, and branches on `dryRun`. **Read the full block first.** In the **non-dry-run path only**, after the existing audit persistence, add:

```typescript
          await sendOperatorAlert("hard_block", {
            recommendationId: rec.id,
            targetEntityName: rec.targetEntityName,
            actionType: rec.actionType,
            reason: guard.reason,
          });
```

- [ ] **Step 4: Verify**

Run: `npx vitest run __tests__/jobs/execute-approved.test.ts`
Expected: PASS unchanged (same no-op invariant; same fallback as Task 2 Step 3 if not).

- [ ] **Step 5: Commit**

```bash
git add jobs/execute-approved.ts
git commit -m "feat(alerts): notify operator on live execution failures and guardrail hard-blocks"
```

---

### Task 4: Event alert — ad-approval SLA escalation to admin

**Files:**
- Modify: `jobs/ad-approval-sla.ts`
- Test: `__tests__/jobs/ad-approval-sla.test.ts` must stay green

- [ ] **Step 1: Add the import and wire `flagAdmin`**

`flagAdmin(approvalId, campaignId, reason, critical)` (~line 131) is the single funnel for SLA breaches needing human attention — it already calls `flagForManualIntervention` and `createNotification`. Add the import, then append inside `flagAdmin` after the `createNotification` call:

```typescript
  await sendOperatorAlert("sla_escalation", {
    approvalId,
    campaignId,
    reason,
    critical,
  });
```

- [ ] **Step 2: Verify**

Run: `npx vitest run __tests__/jobs/ad-approval-sla.test.ts`
Expected: PASS unchanged (same fallback as Task 2 Step 3 if not).

- [ ] **Step 3: Commit**

```bash
git add jobs/ad-approval-sla.ts
git commit -m "feat(alerts): notify operator on ad-approval SLA escalations"
```

---

### Task 5: Daily digest job + cron route

**Files:**
- Create: `jobs/daily-digest.ts`, `app/api/cron/daily-digest/route.ts`
- Test: `__tests__/jobs/daily-digest.test.ts`

**Interfaces:**
- Consumes: `sendOperatorAlert("daily_digest", summary)` from Task 1; `requireCronAuth` from `@/lib/auth`; `acquireJobLock`/`releaseJobLock` from `@/lib/job-lock`; `jobResponse` from `@/lib/jobs/response`.
- Produces: `dailyDigestHandler(): Promise<JobResult<DailyDigestSummary>>` — one webhook message summarizing the trailing 24 hours plus current queue state.

- [ ] **Step 1: Verify two model facts before writing code**

Run: `rtk proxy grep -n "model AuditLog" -A 12 prisma/schema.prisma` — confirm the AuditLog model has a `createdAt` timestamp field (used for counting yesterday's execution failures). Run: `rtk proxy grep -n "model AdApproval " prisma/schema.prisma` — confirm the model/client accessor name (`prisma.adApproval`). If either differs, adapt the two queries in Step 2 to the real field/accessor names — everything else is unchanged.

- [ ] **Step 2: Write the failing test**

Create `__tests__/jobs/daily-digest.test.ts` (mirror the mock style of `__tests__/jobs/fetch-keyword-research.test.ts` — module-level `vi.mock` of `@/lib/db` and `@/lib/alerts`):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  jobRun: {
    create: vi.fn().mockResolvedValue({ id: "run_1" }),
    update: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(1),
  },
  recommendation: {
    count: vi.fn(),
    findMany: vi.fn().mockResolvedValue([
      { outcome: { verdict: "improved" } },
      { outcome: { verdict: "improved" } },
      { outcome: { verdict: "worsened" } },
    ]),
  },
  auditLog: { count: vi.fn().mockResolvedValue(2) },
  contentProposal: { count: vi.fn().mockResolvedValue(1) },
  adApproval: { count: vi.fn().mockResolvedValue(4) },
};

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/alerts", () => ({ sendOperatorAlert: vi.fn().mockResolvedValue(undefined) }));

import { dailyDigestHandler } from "@/jobs/daily-digest";
import { sendOperatorAlert } from "@/lib/alerts";

describe("dailyDigestHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.jobRun.create.mockResolvedValue({ id: "run_1" });
    // pending → 5, pendingOver7Days → 2, executedYesterday → 3, in call order
    prismaMock.recommendation.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
  });

  it("assembles the digest and sends exactly one daily_digest alert", async () => {
    const result = await dailyDigestHandler();
    expect(result.status).toBe("success");
    expect(result.summary.pendingRecommendations).toBe(5);
    expect(result.summary.pendingOver7Days).toBe(2);
    expect(result.summary.executedYesterday).toBe(3);
    expect(result.summary.outcomesCheckedYesterday).toEqual({ improved: 2, worsened: 1 });
    expect(sendOperatorAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendOperatorAlert).mock.calls[0][0]).toBe("daily_digest");
  });

  it("marks the JobRun failed and rethrows nothing when a query throws", async () => {
    prismaMock.recommendation.count.mockReset().mockRejectedValue(new Error("db down"));
    const result = await dailyDigestHandler();
    expect(result.status).toBe("failed");
    expect(prismaMock.jobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    );
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run __tests__/jobs/daily-digest.test.ts`
Expected: FAIL — module `@/jobs/daily-digest` does not exist.

- [ ] **Step 4: Implement `jobs/daily-digest.ts`**

```typescript
import { prisma } from "@/lib/db";
import { sendOperatorAlert } from "@/lib/alerts";
import type { JobResult } from "@/lib/jobs/types";

type DailyDigestSummary = {
  pendingRecommendations: number;
  pendingOver7Days: number;
  executedYesterday: number;
  failedExecutionsYesterday: number;
  outcomesCheckedYesterday: Record<string, number>;
  failedJobsYesterday: number;
  contentPublishedYesterday: number;
  approvalsAwaitingReview: number;
};

// "Yesterday" is the trailing 24h window — timezone-proof and matches how the
// operator reads a morning digest.
export async function dailyDigestHandler(): Promise<JobResult<DailyDigestSummary>> {
  const jobRun = await prisma.jobRun.create({
    data: { jobName: "daily-digest", triggeredBy: "scheduler", status: "running" },
  });
  const errors: string[] = [];

  try {
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 3_600_000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3_600_000);

    const [
      pendingRecommendations,
      pendingOver7Days,
      executedYesterday,
      failedExecutionsYesterday,
      failedJobsYesterday,
      contentPublishedYesterday,
      approvalsAwaitingReview,
      outcomeRows,
    ] = await Promise.all([
      prisma.recommendation.count({ where: { status: "pending" } }),
      prisma.recommendation.count({ where: { status: "pending", createdAt: { lt: sevenDaysAgo } } }),
      prisma.recommendation.count({ where: { status: "executed", executedAt: { gte: since } } }),
      prisma.auditLog.count({ where: { action: "execution_failed", createdAt: { gte: since } } }),
      prisma.jobRun.count({ where: { status: "failed", startedAt: { gte: since } } }),
      prisma.contentProposal.count({ where: { publishedAt: { gte: since } } }),
      prisma.adApproval.count({
        where: { status: { notIn: ["draft", "approved_to_make_kwarta", "rejected", "cancelled"] } },
      }),
      prisma.recommendation.findMany({
        where: { outcomeCheckedAt: { gte: since } },
        select: { outcome: true },
      }),
    ]);

    const outcomesCheckedYesterday: Record<string, number> = {};
    for (const row of outcomeRows) {
      const verdict = (row.outcome as { verdict?: string } | null)?.verdict ?? "unknown";
      outcomesCheckedYesterday[verdict] = (outcomesCheckedYesterday[verdict] ?? 0) + 1;
    }

    const summary: DailyDigestSummary = {
      pendingRecommendations,
      pendingOver7Days,
      executedYesterday,
      failedExecutionsYesterday,
      outcomesCheckedYesterday,
      failedJobsYesterday,
      contentPublishedYesterday,
      approvalsAwaitingReview,
    };

    await sendOperatorAlert("daily_digest", { ...summary });

    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: "success", completedAt: new Date(), summary },
    });
    return { jobName: "daily-digest", runId: jobRun.id, status: "success", summary, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: "failed", completedAt: new Date(), errorLog: errors.join("\n") },
    }).catch(() => {});
    return {
      jobName: "daily-digest",
      runId: jobRun.id,
      status: "failed",
      summary: {
        pendingRecommendations: 0,
        pendingOver7Days: 0,
        executedYesterday: 0,
        failedExecutionsYesterday: 0,
        outcomesCheckedYesterday: {},
        failedJobsYesterday: 0,
        contentPublishedYesterday: 0,
        approvalsAwaitingReview: 0,
      },
      errors,
    };
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run __tests__/jobs/daily-digest.test.ts`
Expected: PASS. If the executedYesterday assertion fails because `Promise.all` resolves counts in declaration order, keep the mock's `mockResolvedValueOnce` chain aligned with the query order above (pending → over7 → executed).

- [ ] **Step 6: Create the cron route**

Create `app/api/cron/daily-digest/route.ts` — an exact clone of the `run-skills` route shape:

```typescript
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { dailyDigestHandler } from "@/jobs/daily-digest";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { jobResponse } from "@/lib/jobs/response";

const JOB_NAME = "daily-digest";

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const acquired = await acquireJobLock(JOB_NAME);
  if (!acquired) {
    return Response.json({ skipped: true, reason: "job already running" }, { status: 409 });
  }

  try {
    const result = await dailyDigestHandler();
    return jobResponse(result);
  } catch (err) {
    console.error("[cron/daily-digest] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseJobLock(JOB_NAME);
  }
}
```

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit` — expect no errors.

```bash
git add jobs/daily-digest.ts app/api/cron/daily-digest/route.ts __tests__/jobs/daily-digest.test.ts
git commit -m "feat(alerts): daily-digest job + cron route summarizing queue and outcomes"
```

---

### Task 6: `outcomeTone` in `lib/ui/tones.ts`

**Files:**
- Modify: `lib/ui/tones.ts`
- Test: check for an existing tones test first (`ls __tests__/lib/ui/ 2>/dev/null; rtk proxy grep -rln "tones" __tests__/ | head -3`); extend it if present, otherwise rely on the tsc gate (these are two-line pure mappers matching the file's existing untested style)

- [ ] **Step 1: Add the mapper**

Append to `lib/ui/tones.ts`, matching the existing function style:

```typescript
// Outcome verdicts from check-outcomes (Verdict union in lib/recommendations/outcome-metrics.ts).
export function outcomeTone(verdict: string): Tone {
  if (verdict === "improved") return "success";
  if (verdict === "worsened") return "critical";
  if (verdict === "neutral") return "info";
  return "attention"; // insufficient_data / unknown
}
```

(`Tone = BadgeProps["tone"]` — if any literal fails `npx tsc --noEmit`, pick the nearest valid Polaris Badge tone; do not cast.)

- [ ] **Step 2: Typecheck and commit**

Run: `npx tsc --noEmit` — expect no errors.

```bash
git add lib/ui/tones.ts
git commit -m "feat(ui): outcomeTone mapper for recommendation outcome verdicts"
```

---

### Task 7: Outcome badges on the Recommendations "Executed" tab

**Files:**
- Modify: `app/(embedded)/(ad-pilot)/recommendations/page.tsx`

**Interfaces:**
- Consumes: `outcomeTone` from Task 6; `timeAgo` from `@/lib/format` (already imported in this file — verify). The API (`app/api/recommendations/route.ts`) already returns full rows via `findMany` with no `select`, so `outcome` and `outcomeCheckedAt` arrive without any API change — **verify this by reading the route, change nothing there.**

- [ ] **Step 1: Extend the client-side rec type**

Find the rec type near line 30 (it already has `executedAt: string | null;`). Add:

```typescript
  outcome: { verdict?: string } | null;
  outcomeCheckedAt: string | null;
```

- [ ] **Step 2: Render the badge next to the executed timestamp**

**Read lines ~300–340 first** to match the exact JSX structure and existing imports (`Badge`, `InlineStack`, `Text` are already used in this file — add any missing one to the existing `@shopify/polaris` import). Directly after the existing block:

```tsx
                    {rec.executedAt && (
                      <Text as="p" tone="subdued">Executed {timeAgo(rec.executedAt)}</Text>
                    )}
```

add:

```tsx
                    {rec.status === "executed" && rec.outcome?.verdict && (
                      <InlineStack gap="150" blockAlign="center">
                        <Badge tone={outcomeTone(rec.outcome.verdict)}>
                          {rec.outcome.verdict.replace(/_/g, " ")}
                        </Badge>
                        {rec.outcomeCheckedAt && (
                          <Text as="p" tone="subdued">checked {timeAgo(rec.outcomeCheckedAt)}</Text>
                        )}
                      </InlineStack>
                    )}
```

and add the import: `import { outcomeTone } from "@/lib/ui/tones";` (merge into an existing tones import if one exists).

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit` and `npm run build` — expect clean.

```bash
git add "app/(embedded)/(ad-pilot)/recommendations/page.tsx"
git commit -m "feat(recommendations): outcome verdict badges on the Executed tab"
```

---

### Task 8: Dashboard "Outcome win rate (90d)" stat

**Files:**
- Modify: `lib/dashboard/jobs-status.ts`, `app/(embedded)/page.tsx`
- Test: check `rtk proxy grep -rln "jobs-status" __tests__/ | head -3` — if a jobs-status test asserts on the payload shape, add the new field to its fixture/assertions

- [ ] **Step 1: Add the field to `JobsStatusPayload`**

In `lib/dashboard/jobs-status.ts`, the payload type starts at line ~49. Add:

```typescript
  outcomeWinRate: { improved: number; worsened: number; total: number } | null;
```

**Also check the runtime payload validator** near line 126 (`"pendingCount" in value && ...`) — if it enumerates required keys, decide deliberately: add `"outcomeWinRate" in value` only if all other keys are checked the same way (otherwise cached snapshots persisted before this deploy would fail validation — if the validator is strict, leave the new field out of it and note why in the commit message).

- [ ] **Step 2: Compute it in `buildJobsStatusPayload`**

Inside `buildJobsStatusPayload()` (line ~257), alongside the existing queries, add:

```typescript
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3_600_000);
  const outcomeRows = await prisma.recommendation.findMany({
    where: { status: "executed", outcomeCheckedAt: { gte: ninetyDaysAgo } },
    select: { outcome: true },
  });
  let outcomesImproved = 0;
  let outcomesWorsened = 0;
  for (const row of outcomeRows) {
    const verdict = (row.outcome as { verdict?: string } | null)?.verdict;
    if (verdict === "improved") outcomesImproved++;
    else if (verdict === "worsened") outcomesWorsened++;
  }
```

and in the returned payload object (the block ending near line 603 where `recsPendingOver7Days` is set):

```typescript
    outcomeWinRate: outcomeRows.length > 0
      ? { improved: outcomesImproved, worsened: outcomesWorsened, total: outcomeRows.length }
      : null,
```

- [ ] **Step 3: Surface it on the dashboard Operations row**

In `app/(embedded)/page.tsx`: add `outcomeWinRate: { improved: number; worsened: number; total: number } | null;` to the local payload type (near line 58, next to `pendingCount`). Then, in the Operations row `StatGrid` (line ~1006 — four `<Card>`s inside the non-loading branch), append a fifth card after "Last Job Run":

```tsx
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Outcome Win Rate (90d)</Text>
                        {data?.outcomeWinRate ? (
                          <BlockStack gap="100">
                            <Text variant="heading2xl" as="p">
                              {Math.round((data.outcomeWinRate.improved / data.outcomeWinRate.total) * 100)}%
                            </Text>
                            <Text as="p" tone="subdued">
                              {data.outcomeWinRate.improved} improved · {data.outcomeWinRate.worsened} worsened · {data.outcomeWinRate.total} checked
                            </Text>
                          </BlockStack>
                        ) : (
                          <Text as="p" tone="subdued">No outcomes checked yet</Text>
                        )}
                      </BlockStack>
                    </Card>
```

Also bump the loading branch's skeleton count from four `<StatCardSkeleton />` to five.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit`, `npm test`, `npm run build` — expect clean/green.

```bash
git add lib/dashboard/jobs-status.ts "app/(embedded)/page.tsx"
git commit -m "feat(dashboard): outcome win rate (90d) stat in the Operations row"
```

---

### Task 9: Docs, env, verification gate, deploy 🚀

**Files:**
- Modify: `docs/CRON.md`, `.env.example`, `.mex/ROUTER.md`
- Prod (at deploy): `/etc/cron.d/autopilot`, optionally `/opt/autopilot/.env`

- [ ] **Step 1: Document the digest cron**

In `docs/CRON.md`, add to the schedule table (the digest runs after the 05:00–07:00 data/execution/outcome chain so it reports on fresh data):

```
| 08:00 | `/api/cron/daily-digest` | Posts a one-message operator digest (pending recs, yesterday's executions + outcomes, failed jobs, content published, approvals awaiting review) to ALERT_WEBHOOK_URL |
```

and a detail section following the file's existing per-route format:

```
### `/api/cron/daily-digest`
Assembles a trailing-24h digest — pending recommendations (with >7-day staleness count), executions and their outcome verdicts, failed job runs, content published, and ad-approvals awaiting review — and sends it as a single `daily_digest` webhook message via `lib/alerts.ts`. No-ops the webhook (but still records the JobRun summary) when `ALERT_WEBHOOK_URL` is unset.
```

- [ ] **Step 2: Update `.env.example`**

Extend the existing `ALERT_WEBHOOK_URL` comment (line ~110):

```
ALERT_WEBHOOK_URL=         # Optional: POST sanitized JSON alerts (job failures, new recommendations, execution failures, guardrail hard-blocks, SLA escalations, daily digest). Point at a Slack/Discord/Telegram-bridge webhook.
```

- [ ] **Step 3: Update `.mex/ROUTER.md`**

Add a bullet to "Current Project State" (and bump `last_updated`):

```
- Operator visibility (Phase 1, 2026-07-XX): `sendOperatorAlert(kind, payload)` in `lib/alerts.ts` posts typed events (new_recommendations, execution_failed, hard_block, sla_escalation, daily_digest) to ALERT_WEBHOOK_URL — silent no-op when unset. New `jobs/daily-digest.ts` + `/api/cron/daily-digest` (08:00) sends the morning digest. Executed recommendations show outcome verdict badges (verdicts: improved/worsened/neutral/insufficient_data); dashboard Operations row has an Outcome Win Rate (90d) stat fed by `JobsStatusPayload.outcomeWinRate`.
```

- [ ] **Step 4: Full verification gate**

Run: `npx tsc --noEmit` — no errors.
Run: `npm test` — all green (record the counts).
Run: `npm run build` — clean.

- [ ] **Step 5: Commit and push**

```bash
git add docs/CRON.md .env.example .mex/ROUTER.md
git commit -m "docs: daily-digest cron, operator-alert env docs, ROUTER state for Phase 1"
git push origin main
```

- [ ] **Step 6: Deploy 🚀 and install the cron entry**

Deploy per `.mex/patterns/deploy.md` (`node scripts/linode-deploy.mjs`, then `pm2 restart autopilot` — **no migration step; this phase has no schema change**). Then on the server, append the digest line to `/etc/cron.d/autopilot`, cloning the exact shape of the existing `fetch-keyword-research` entry (SECRET extraction + curl + log redirect), with schedule `0 8 * * *` and path `/api/cron/daily-digest`. If the operator has provided a webhook endpoint, set `ALERT_WEBHOOK_URL` in `/opt/autopilot/.env` and `pm2 restart autopilot`; if not, note in the summary that alerts stay dormant until it is set (everything else still works).

- [ ] **Step 7: Live acceptance check**

Trigger once: `ssh autopilot-prod 'SECRET=$(grep "^CRON_SECRET=" /opt/autopilot/.env | cut -d= -f2 | tr -d "\""); curl -sf https://autopilot.agrikoph.com/api/cron/daily-digest -H "Authorization: Bearer $SECRET"'`
Expected: JSON with `"status":"success"` (or `queued` → then verify the JobRun row's summary). If `ALERT_WEBHOOK_URL` is set to a test endpoint, exactly one message arrives. Verify the dashboard renders the win-rate card and the Executed tab shows badges for any rec with a checked outcome.

---

## Self-review notes

- Roadmap coverage: 1A event alerts (run-skills → Task 2, execution failure → Task 3, hard-block → Task 3, SLA escalation → Task 4), 1A digest cron (Task 5 + Task 9 install), 1B outcome badges + tone map (Tasks 6–7), 1B API verify-no-change (Task 7 interfaces — route already returns full rows), 1B dashboard win rate (Task 8), acceptance criteria (Task 9 Step 7). ✔
- Corrections vs. the master roadmap, from fact-finding: verdict values are `improved/worsened/neutral/insufficient_data` (NOT `no_change`/`inconclusive`); the tone map lives against `Tone = BadgeProps["tone"]` so `subdued` is not assumed valid; `recsPendingOver7Days` already exists in `JobsStatusPayload` (reused, not rebuilt); the dashboard payload is served from `lib/dashboard/jobs-status.ts` via `app/api/jobs/status`, not a bespoke dashboard route; "yesterday's failed executions" counts `execution_failed` AuditLog rows because failed recommendations don't reliably carry `executedAt`.
- No placeholders: every code step shows real code against real symbols read during fact-finding; the four spots where surrounding code must be read before editing (Task 3 Steps 2–3, Task 7 Step 2, Task 8 Step 1 validator) are flagged explicitly with what to look for.
- Type consistency: `OperatorAlertKind` (Task 1) matches every call site kind string (Tasks 2–5); `outcomeWinRate` shape is identical in `JobsStatusPayload`, the page type, and the card render; `outcomeTone` consumes the same verdict strings the digest and badges read from `outcome.verdict`.
- Deliberate scope boundaries: no schema change; no new env var (reuses `ALERT_WEBHOOK_URL`); Keyword Planner surface untouched; the existing `notifyJobFailure`/health checks in `/api/cron/daily` are left as-is (they cover job failures; this phase adds *operator-workflow* events).
