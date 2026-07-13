# Grouped Topical-map Internal Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace conflicting per-link Shopify tasks with one deterministic, governed internal-link update per source resource and execute the four scoped production updates.

**Architecture:** Group projected internal-link rules before Shopify observation, persist one source/proposed payload and Recommendation per resource, then dismiss only obsolete unapproved tasks after the replacement exists. Reuse the authenticated approval route and guarded executor for production writes.

**Tech Stack:** Next.js 15, TypeScript, Zod, Prisma 6, PostgreSQL 16, Vitest, Shopify Admin GraphQL, PM2.

## Global Constraints

- Preserve every rule ID, source reference, active package identity, observed-state hash, and proposed-state hash.
- Never alter approved, override-approved, executing, completed, or dismissed task bytes during synchronization.
- Never bypass authenticated approval, permissions, live gate, active-rule validation, stale-state validation, target locking, Shopify verification, or audit persistence.
- Execute only the four scoped internal-link resources.
- Do not execute redirects, canonicals, indexation, publishing-state changes, Meta changes, or unrelated Shopify mutations.

---

### Task 1: Group internal-link projection and markup

**Files:**
- Modify: `lib/store-tasks/topical-map.ts`
- Modify: `__tests__/lib/store-tasks/topical-map.test.ts`

**Interfaces:**
- Consumes: `TopicalMapCommandCenter.work.internalLinks`.
- Produces: one executable candidate per normalized source URL with `links: Array<{ toUrl: string; anchor: string }>` and the sorted union of `ruleIds`.

- [ ] **Step 1: Write the RED grouping test**

Add two more `/collections/rice` link rules to the fixture. Assert synchronization creates one `internal_link` task, its source contains all three sorted rules and destinations, and its proposed HTML contains one section, one heading, one list, and three links.

- [ ] **Step 2: Run RED**

Run: `npx vitest run __tests__/lib/store-tasks/topical-map.test.ts -t "groups internal links"`

Expected: FAIL because three rules create three tasks and the schema accepts singular link fields.

- [ ] **Step 3: Implement grouped candidate projection**

Group only internal-link candidates by normalized `targetUrl`, union and sort rule IDs, deduplicate links by normalized destination, and sort links by destination then anchor. Change the internal-link source branch to accept a non-empty, strict `links` array with at most 100 entries.

- [ ] **Step 4: Implement deterministic grouped markup**

Filter links already present in `resource.internalTargets`. Preserve the compact paragraph for one link. For multiple links, append one `section.ag-related-recipes` with an H2 and UL. Use `Explore More Red Rice Recipes` for `/pages/red-rice-recipes`; use `Explore Related Resources` elsewhere. Escape headings, anchors, and hrefs.

- [ ] **Step 5: Run GREEN**

Run: `npx vitest run __tests__/lib/store-tasks/topical-map.test.ts __tests__/lib/store-tasks/apply-topical-map.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/store-tasks/topical-map.ts __tests__/lib/store-tasks/topical-map.test.ts
git commit -m "fix(store): group topical-map internal links"
```

### Task 2: Supersede obsolete unapproved tasks

**Files:**
- Modify: `lib/store-tasks/topical-map.ts`
- Modify: `__tests__/lib/store-tasks/topical-map.test.ts`

**Interfaces:**
- Consumes: replacement task ID, strategy identity, target URL, and action.
- Produces: dismissed obsolete pending/failed tasks plus `topical_map_store_task_superseded` audits.

- [ ] **Step 1: Write RED lifecycle tests**

Assert synchronization dismisses old per-link tasks for the same strategy, target, and action only after persisting the replacement. Require a completion note naming the replacement and one audit per dismissal. Approved-linked, executing-linked, completed, and dismissed rows remain untouched.

- [ ] **Step 2: Run RED**

Run: `npx vitest run __tests__/lib/store-tasks/topical-map.test.ts -t "supersedes"`

Expected: FAIL because synchronization does not query or dismiss obsolete tasks.

- [ ] **Step 3: Implement bounded supersession**

Extend the local client type with exact `findMany`, `updateMany`, and audit transaction operations. Query only matching topical-map pending/failed tasks. Parse `sourceData`; require matching strategy version, package hash, executable internal-link action, and a different task ID before dismissal. Persist the replacement ID in the note and audit.

- [ ] **Step 4: Run GREEN and regressions**

Run: `npx vitest run __tests__/lib/store-tasks/topical-map.test.ts __tests__/api/topical-map-store-tasks.test.ts __tests__/lib/store-tasks/apply-topical-map.test.ts __tests__/jobs/execute-approved.test.ts`

Expected: all tests pass and synchronization performs no Shopify mutation.

- [ ] **Step 5: Commit**

```bash
git add lib/store-tasks/topical-map.ts __tests__/lib/store-tasks/topical-map.test.ts
git commit -m "fix(store): supersede conflicting map link tasks"
```

### Task 3: Full local acceptance and deployment

**Files:**
- Modify only for verified outcomes: `.mex/ROUTER.md`, `.mex/events/decisions.jsonl`, deployment evidence record.

- [ ] **Step 1: Run local acceptance**

Run `npm run db:generate`, `npm run verify:prisma-client`, `npm test`, `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, an isolated PostgreSQL-URL `npm run build`, `git diff --check`, and guarded `npm run test:postgres`. Require zero failures.

- [ ] **Step 2: Commit scoped evidence**

Confirm the worktree contains no unrelated changes. Commit only scoped GROW/evidence files.

- [ ] **Step 3: Push and deploy**

Push verified `main`, run `node scripts/git-deploy.mjs`, and require local/origin/server commit parity, current migrations, active build evidence, PM2 online, and public health `ok`.

### Task 4: Production regeneration and governed execution

**Interfaces:**
- Consumes: authenticated sync/apply routes and guarded `execute-approved`.
- Produces: four completed scoped Store Tasks with Shopify verification and audits.

- [ ] **Step 1: Back up and capture pre-state**

Create and validate a custom-format PostgreSQL backup. Record size and SHA-256. Capture the four Shopify resource state hashes and current executed-Recommendation count.

- [ ] **Step 2: Synchronize**

Call the authenticated sync route. Require four pending executable scoped tasks, with one red-rice task containing all 25 rule IDs and links. Require obsolete unapproved per-link tasks dismissed with audits.

- [ ] **Step 3: Inspect and approve**

Fetch each task detail through the authenticated route. Verify only `bodyHtml` changes and destination sets match active rules. Approve through `/api/store-tasks/:id/apply`; require HTTP 202 and frozen hashes.

- [ ] **Step 4: Execute**

Invoke `execute-approved` with explicit live intent and cron authentication. Require exactly the four scoped Recommendations to execute; stop if any unrelated Recommendation would be claimed.

- [ ] **Step 5: Verify production**

Require four completed tasks, four executed Recommendations, minimal receipts, audits, released locks, unchanged active strategy identity, and zero unrelated Shopify/Meta executions. Fetch rendered URLs and confirm expected destinations occur once and red rice has one curated section. Verify PM2 and public health.

- [ ] **Step 6: Record final evidence**

Record backup identity, deployed commit, task/Recommendation IDs, receipt hashes, rendered checks, and health. Commit, push, deploy the evidence-only commit, then reverify parity and health.

