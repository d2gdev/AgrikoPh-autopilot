# Plugin Review Remediation Design

## Goal

Fix the six issues identified in the custom Shopify plugin review without broadening the product surface or weakening the approval-first safety model.

## Publishing State Safety

Rejection becomes a terminal, non-publishable transition. The reject route will atomically set `status` to `rejected`, clear `scheduledPublishAt`, and move any pre-publish draft to a rejected draft state. The update predicate will continue to reject concurrent transitions once publishing has begun.

Manual and scheduled publishing will independently enforce that the proposal status is `approved` or `override_approved`. Both their initial selection and optimistic lock predicates will include the allowed status so rejection and publishing cannot both succeed in a race. This defense-in-depth requirement prevents direct API calls, stale UI state, or scheduler queries from bypassing an operator rejection.

The scheduled-publish cron will acquire the project-standard `publish-scheduled` job lock after cron authentication and release it in `finally`. Its per-proposal optimistic lock remains in place as a second concurrency boundary.

## Proposal Dedupe Semantics

Article-backed proposal keys will retain `proposalType` and normalized `articleHandle`, then add a structured discriminator when one action type can validly occur more than once per article:

- `internal-link`: destination article handle, falling back to suggested anchor text or title.
- `seo-fix`: target query or explicit issue/action, falling back to title.
- Other article-backed proposal types: the existing article-and-type key, because they represent one replacement proposal per article.

This keeps reworded duplicates blocked while allowing distinct internal-link destinations and SEO actions to coexist. Generation cleanup will use the refined key, preventing valid approved actions from being deleted as duplicates.

## Production Deployment Safety

`git-deploy.mjs` will default to `main`. Deploying another branch will require both `--branch <name>` and `--allow-non-main`. The script will reject a dirty local worktree so the deployed commit cannot be confused with uncommitted local changes.

SSH will use normal host-key verification. The deploy script will no longer add `StrictHostKeyChecking=no`; operators must provision the VPS host key in `known_hosts`. The GitHub authorization header remains redacted from error output, and the existing token transport is left otherwise unchanged in this focused remediation.

The remote sequence will install dependencies and build `.next.build` before applying database migrations. Only after a successful build will it migrate, swap the build directory, and restart PM2. Migrations must remain backward-compatible because a restart can still fail after a successful migration; the script will preserve `.next.old` until PM2 restart succeeds and restore it if both restart and start fail.

## Testing

Implementation will follow red-green TDD:

1. Add route regressions proving rejected ready and scheduled proposals cannot be manually or automatically published, including the reject/publish predicate race.
2. Add cron tests proving the job lock is acquired and released on success, empty queues, and failure paths.
3. Add dedupe tests proving distinct internal-link destinations and SEO targets remain distinct while reworded instances of the same structured action dedupe.
4. Add deploy-script tests around argument policy and remote-command ordering by extracting pure policy helpers where needed, without executing SSH or deployment commands.
5. Run focused suites after each fix, then `npm run typecheck`, `npm run typecheck:test`, `npm test`, and `git diff --check`.

## Scope Boundaries

- No live Shopify or Meta changes will be executed.
- No database schema change is required.
- No unrelated route, UI, deployment-provider, or state-machine refactor is included.
- Existing approval statuses and emergency non-main deployment capability remain available under explicit controls.
