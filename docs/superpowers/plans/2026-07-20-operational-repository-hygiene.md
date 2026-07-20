# Operational and Repository Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Subagent dispatch is prohibited for this run.

**Goal:** Restore a verified healthy production state, reconcile all current Autopilot and Shopify-theme work without losing user changes, remove only proven-redundant local branches/worktrees, and refresh the outstanding Google Search Console evidence.

**Architecture:** Treat production, Autopilot, the theme checkout, and Google Search Console as separate evidence boundaries. Repair the single orphaned production job through the existing compare-and-set stale-job command; validate every uncommitted file before integrating or preserving it; prove branch redundancy through ancestry and patch-equivalence checks before deletion; and finish with authenticated UI/API/database, live storefront, deployed artifact, and Git-state verification.

**Tech Stack:** Next.js 15, TypeScript 5.6, Prisma 6/PostgreSQL, Vitest 4, PM2, Shopify Admin GraphQL, Liquid, Google Search Console API/UI, Git worktrees.

## Global Constraints

- Preserve every user-authored dirty file until it is either intentionally committed or captured on a named preservation branch.
- Do not use destructive Git reset or checkout commands.
- Do not delete a branch or worktree until its commits are proven reachable or patch-equivalent and its worktree contains no unique source changes.
- Do not execute a Shopify live write in this cleanup. Any live/source discrepancy that needs a new Shopify mutation requires the existing approved Recommendation path or new operator authority.
- Do not call production healthy until `/api/health`, the persisted `JobRun`, the current deployed commit/build, PM2, and the public endpoint all agree.
- Do not call the GSC audit clean or complete while the authenticated Google report still shows a stale snapshot or an individually unreviewed item.

---

### Task 1: Repair the Orphaned Production Job

**Evidence:** `JobRun cmrsigfhf02m9s6ukuovyn63b` for `fetch-market-intel` has remained `running` since `2026-07-20T00:53:05.764Z`; the newer run `cmrsjll5r03ips6h52fb0wpip` completed successfully, so the old row cannot represent the active execution.

- [ ] Verify no live `fetch-market-intel` lock or process owns the old run and re-read both JobRuns.
- [ ] Run the existing command in dry-run mode:

```bash
ssh autopilot-prod 'cd /opt/autopilot && npm run jobs:stale -- --older-than-minutes 30 --job fetch-market-intel --json'
```

- [ ] Require the dry run to select exactly `cmrsigfhf02m9s6ukuovyn63b`, then apply the same compare-and-set repair:

```bash
ssh autopilot-prod 'cd /opt/autopilot && npm run jobs:stale -- --older-than-minutes 30 --job fetch-market-intel --json --apply'
```

- [ ] Verify the old row is terminal with a stale-run error, the newer successful row is unchanged, no other stale run remains, and `/api/health` reports `ok`.

Rollback is not appropriate for an orphaned execution marker. If evidence contradicts the orphan diagnosis, stop before `--apply`.

---

### Task 2: Reconcile the Autopilot Checkout

**Files:**

- `package.json`
- `scripts/verify-storefront-security-headers.mjs`
- `.worktrees/gsc-final-verify`

- [ ] Inspect the complete diff and validate the verifier:

```bash
node --check scripts/verify-storefront-security-headers.mjs
npm run verify:storefront-security-headers
```

- [ ] If the verifier correctly asserts the live HTTP security headers, commit the script and package entry intentionally. If it asserts unsupported or non-live behavior, correct it with a failing focused test first, then rerun the test and live verifier.
- [ ] Prove detached worktree commit `d4d6c1f` is reachable from `main`. Remove only generated/untracked dependencies, then remove the redundant worktree with `git worktree remove`.
- [ ] Run focused tests, typecheck, lint, build, and the full suite before pushing.
- [ ] Push `main`; if the commit changes, deploy that exact commit and verify matching server commit, active build ID, restarted PM2 process, healthy API, and public endpoint.

---

### Task 3: Reconcile the Shopify Theme Checkout

**Files currently dirty:**

- `assets/home-sections.css`
- `assets/template-index.css`
- `docs/seo/seo-release-annotations.csv`
- `layout/theme.liquid`
- `sections/main-article.liquid`
- `sections/main-home.liquid`
- `templates/robots.txt.liquid`

- [ ] Read the published main theme assets through Shopify Admin and compare hashes/content with the local files, without exposing credentials.
- [ ] Review the changes for correctness, especially per-request CSS cache busting, viewport sizing, accessibility semantics, security-header claims, and robots output.
- [ ] Run all theme source and rendering tests. Add or update focused regression coverage before changing any behavior.
- [ ] Integrate only verified intended changes. Preserve any unverified work on a clearly named branch with a clean commit rather than discarding it.
- [ ] Merge/fetch `origin/main` without destructive reset, resolving robots and release-annotation overlap from the GSC-08 commit.
- [ ] Prove `codex/gsc-08-robots-sitemap`, `codex/gsc-approved-remediation`, and `dev-branch` have no unique unintegrated patches. Remove their clean redundant local worktrees/branches only after that proof.
- [ ] Run the full theme test suite, confirm `main` is synchronized with `origin/main`, and verify the live robots response still has one absolute sitemap directive and no relative directive.

If a verified source change is not already live, do not publish it during this cleanup; route it through the governed live-change workflow.

---

### Task 4: Refresh Search Console and Final Evidence

- [ ] Refresh the authenticated GSC report and URL/sitemap evidence for task `YR_KaTzEydtIzic3eN7dow`.
- [ ] Inspect the authenticated Autopilot UI, trace every displayed GSC finding to its API response and persisted record, and record any Google-side item that remains pending.
- [ ] Verify:

```bash
git status --short --branch
git worktree list
git branch -vv
curl -fsS https://autopilot.agrikoph.com/api/health
curl -fsS https://agrikoph.com/robots.txt
```

- [ ] Record GROW updates in `.mex/ROUTER.md`, the relevant `.mex/context/` file, a reusable runbook if warranted, `docs/planning-metrics.csv`, and `mex log` when rationale matters.
- [ ] Finish only when production is healthy, required tests pass, live/deployed evidence matches, both primary checkouts are clean, and every remaining branch or Google-side pending item is explicitly justified.

