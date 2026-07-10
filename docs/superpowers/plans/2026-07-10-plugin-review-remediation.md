# Plugin Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all six reviewed safety and correctness issues in Content Pilot publishing, proposal deduplication, scheduled cron execution, and production deployment.

**Architecture:** Enforce proposal approval at every publish boundary while making rejection atomically non-publishable. Refine logical proposal keys only for multi-action proposal types, and extract pure deploy-policy helpers so production branch and worktree rules are directly testable without running SSH.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, Vitest, Node.js ESM deployment scripts, PowerShell/WSL verification.

## Global Constraints

- Never execute live Shopify or Meta writes during implementation or verification.
- Keep `requireAppAuth`/`requirePermission` and `requireCronAuth` as the first handler gates.
- Use `import { prisma } from "@/lib/db"` for all database access.
- Production deploys default to `main`; non-main deploys require `--branch <name> --allow-non-main`.
- No database schema change and no unrelated refactor.

---

### Task 1: Make rejection terminal and publishing approval-aware

**Files:**
- Modify: `__tests__/api/content-pilot-reject-route.test.ts`
- Modify: `__tests__/api/content-pilot-publish-failure.test.ts`
- Modify: `app/api/content-pilot/proposals/[id]/reject/route.ts`
- Modify: `app/api/content-pilot/proposals/[id]/publish/route.ts`
- Modify: `app/api/cron/publish-scheduled/route.ts`

**Interfaces:**
- Consumes: existing proposal `status`, `draftStatus`, and `scheduledPublishAt` fields.
- Produces: publish predicates that accept only `approved` and `override_approved`; rejection state `{ status: "rejected", draftStatus: "rejected", scheduledPublishAt: null }`.

- [ ] **Step 1: Write failing rejection and publish tests**

Add assertions equivalent to:

```ts
expect(mockPrisma.contentProposal.updateMany).toHaveBeenCalledWith({
  where: expect.any(Object),
  data: expect.objectContaining({
    status: "rejected",
    draftStatus: "rejected",
    scheduledPublishAt: null,
  }),
});

expect(mockPrisma.contentProposal.updateMany).toHaveBeenCalledWith({
  where: {
    id: "proposal-1",
    status: { in: ["approved", "override_approved"] },
    draftStatus: "ready",
  },
  data: { draftStatus: "publishing" },
});
```

Also add manual and scheduled cases with `status: "rejected"` that expect no call to `publishDraft`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- __tests__/api/content-pilot-reject-route.test.ts __tests__/api/content-pilot-publish-failure.test.ts
```

Expected: failures showing rejection does not clear scheduling/change draft status and publish locks do not include status.

- [ ] **Step 3: Implement the minimal state fix**

Use shared allowed statuses in both publish routes:

```ts
const CONTENT_PROPOSAL_PUBLISHABLE_STATUSES = ["approved", "override_approved"];
```

Apply that predicate to initial reads and optimistic locks. Update rejection atomically with:

```ts
data: {
  status: "rejected",
  draftStatus: "rejected",
  scheduledPublishAt: null,
  reviewedBy,
  reviewedAt: new Date(),
  reviewNote: reviewNote ?? null,
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 1 command again. Expected: both files pass.

### Task 2: Add the scheduled-publish route lock

**Files:**
- Modify: `__tests__/api/content-pilot-publish-failure.test.ts`
- Modify: `app/api/cron/publish-scheduled/route.ts`

**Interfaces:**
- Consumes: `acquireJobLock(name)` and `releaseJobLock(name)` from `@/lib/job-lock`.
- Produces: serialized route execution under lock name `publish-scheduled` and a 409 skipped response when already active.

- [ ] **Step 1: Write failing lock lifecycle tests**

Mock `@/lib/job-lock`, then assert acquisition after authentication, 409 on `false`, and release on empty, success, and handled-publish-failure paths:

```ts
expect(mockLocks.acquireJobLock).toHaveBeenCalledWith("publish-scheduled");
expect(mockLocks.releaseJobLock).toHaveBeenCalledWith("publish-scheduled");
```

- [ ] **Step 2: Run the cron-focused test and verify RED**

Run `npm test -- __tests__/api/content-pilot-publish-failure.test.ts`.

Expected: missing job-lock calls.

- [ ] **Step 3: Implement the route-level lock**

After `requireCronAuth`, acquire the lock, return 409 if unavailable, and wrap all route work in:

```ts
try {
  // existing scheduled publishing flow
} finally {
  await releaseJobLock("publish-scheduled");
}
```

- [ ] **Step 4: Run the cron-focused test and verify GREEN**

Run the Task 2 command again. Expected: pass.

### Task 3: Preserve distinct article actions in deduplication

**Files:**
- Modify: `__tests__/lib/content-pilot/proposal-dedupe.test.ts`
- Modify: `lib/content-pilot/proposal-dedupe.ts`

**Interfaces:**
- Consumes: `ContentProposalDedupeInput.proposedState`.
- Produces: stable structured discriminators for `internal-link` and `seo-fix` keys.

- [ ] **Step 1: Write failing key tests**

Add cases proving:

```ts
expect(internalLinkToB).not.toBe(internalLinkToC);
expect(seoFixForCtr).not.toBe(seoFixForSchema);
expect(rewordedSameSeoFix).toBe(originalSeoFix);
```

Use `toArticle` for internal links and `targetQuery`/`issue` for SEO fixes.

- [ ] **Step 2: Run the focused test and verify RED**

Run `npm test -- __tests__/lib/content-pilot/proposal-dedupe.test.ts`.

Expected: distinct structured actions currently produce identical keys.

- [ ] **Step 3: Implement structured action discriminators**

For handled inputs, append:

```ts
if (proposalType === "internal-link") {
  return `${base}:to:${normalizeKeyPart(toArticle ?? anchorText ?? input.title)}`;
}
if (proposalType === "seo-fix") {
  return `${base}:action:${normalizeKeyPart(targetQuery ?? issue ?? action ?? input.title)}`;
}
return base;
```

- [ ] **Step 4: Run dedupe and SEO route regressions**

Run:

```bash
npm test -- __tests__/lib/content-pilot/proposal-dedupe.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/api/content-pilot-routes.test.ts
```

Expected: pass.

### Task 4: Harden production deploy policy and sequencing

**Files:**
- Create: `scripts/git-deploy-policy.mjs`
- Create: `__tests__/scripts/git-deploy-policy.test.ts`
- Modify: `scripts/git-deploy.mjs`
- Modify: `docs/OPERATIONS.md`

**Interfaces:**
- Produces: `resolveDeployBranch({ requestedBranch, allowNonMain })`, `assertCleanWorktree(status)`, and `assertRemoteStepOrder(script)` pure helpers.
- Consumes: CLI flags `--branch` and `--allow-non-main`, plus `git status --porcelain`.

- [ ] **Step 1: Write failing deploy-policy tests**

Cover these exact outcomes:

```ts
expect(resolveDeployBranch({ requestedBranch: null, allowNonMain: false })).toBe("main");
expect(() => resolveDeployBranch({ requestedBranch: "feature/x", allowNonMain: false })).toThrow(/allow-non-main/);
expect(resolveDeployBranch({ requestedBranch: "feature/x", allowNonMain: true })).toBe("feature/x");
expect(() => assertCleanWorktree(" M app/page.tsx")).toThrow(/working tree/);
expect(assertCleanWorktree("")).toBeUndefined();
```

Add a source-order assertion requiring `build:remote` before `db:migrate`, and a source assertion that `StrictHostKeyChecking=no` is absent.

- [ ] **Step 2: Run deploy-policy tests and verify RED**

Run `npm test -- __tests__/scripts/git-deploy-policy.test.ts`.

Expected: missing helper module and unsafe script ordering/options.

- [ ] **Step 3: Implement branch/worktree policy**

Add pure helpers, default to `main`, require the override flag for non-main, and call:

```js
assertCleanWorktree(run("git", ["status", "--porcelain"], { stdio: "pipe" }));
```

Remove `StrictHostKeyChecking=no` from `sshOpts`.

- [ ] **Step 4: Reorder build, migration, swap, and rollback**

Install and build `.next.build` before `npm run db:migrate`. Preserve `.next.old`; if both PM2 restart and start fail, restore `.next.old` and exit non-zero. Delete `.next.old` only after PM2 reports successful process start/restart.

- [ ] **Step 5: Update operator documentation**

Document default `main`, emergency syntax `node scripts/git-deploy.mjs --branch <branch> --allow-non-main`, clean-worktree requirement, and known-host provisioning.

- [ ] **Step 6: Run deploy-policy tests and verify GREEN**

Run the Task 4 test command. Expected: pass.

### Task 5: Verify and record the remediation

**Files:**
- Modify: `.mex/ROUTER.md`
- Modify: `.mex/patterns/deploy.md`
- Modify: `.mex/patterns/pilot-queue-usability.md`
- Modify: `.mex/events/decisions.jsonl` via `mex log` when available.

**Interfaces:**
- Produces: current project state and recurring runbook guidance matching implemented behavior.

- [ ] **Step 1: Run complete verification**

Run:

```bash
npm run typecheck
npm run typecheck:test
npm test
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 2: Run GROW**

Record the publishing invariant, refined dedupe semantics, route lock, and deploy policy in the relevant `.mex` files; bump `last_updated` values; run `mex log` with the remediation rationale.

- [ ] **Step 3: Re-run documentation checks**

Run `git diff --check` and inspect `git status --short`. Expected: no whitespace errors and only task-scoped changes.
