# Pattern Index

Lookup table for all pattern files in this directory. Check here before starting any task — if a pattern exists, follow it.

| Pattern | Use when |
|---------|----------|
| [add-api-route.md#task-add-embedded-app-route](add-api-route.md#task-add-embedded-app-route) | Adding a new route callable from the Shopify embedded UI |
| [add-api-route.md#task-add-cron-route](add-api-route.md#task-add-cron-route) | Adding a new cron endpoint in `app/api/cron/` |
| [add-cron-job.md](add-cron-job.md) | Writing a new job handler in `jobs/` that fetches data and writes JobRun + RawSnapshot rows |
| [debug-pipeline.md#task-diagnose-a-failed-or-partial-job](debug-pipeline.md#task-diagnose-a-failed-or-partial-job) | A cron job is returning `failed` or `partial` status |
| [debug-pipeline.md#task-diagnose-no-recommendations-generated](debug-pipeline.md#task-diagnose-no-recommendations-generated) | Skills ran but no new Recommendation rows appeared |
| [debug-pipeline.md#task-diagnose-execute-approved-not-executing](debug-pipeline.md#task-diagnose-execute-approved-not-executing) | Approved recommendations are not being executed |
| [debug-pipeline.md#task-diagnose-connector-auth-failures](debug-pipeline.md#task-diagnose-connector-auth-failures) | A connector is returning 401/403 or token-expired errors |
| [debug-pipeline.md#task-diagnose-competitor-ads-not-appearing-in-the-market-intelligence-ui](debug-pipeline.md#task-diagnose-competitor-ads-not-appearing-in-the-market-intelligence-ui) | Market Intelligence "Ads" tab shows few/no ads for a competitor |
| [debug-shopify-app-bridge-auth.md](debug-shopify-app-bridge-auth.md) | Shopify embedded UI auth fails with App Bridge `idToken()` timeouts, dashboard 401s, or tab/navigation auth breakage |
| [deploy.md#task-deploy-code-changes](deploy.md#task-deploy-code-changes) | Deploying code to the Linode VPS production server |
| [deploy.md#task-run-database-migrations-in-production](deploy.md#task-run-database-migrations-in-production) | Running Prisma migrations on the production database |
| [deploy.md#task-update-environment-variables-in-production](deploy.md#task-update-environment-variables-in-production) | Changing env vars on the production server |
| [prisma-postgres-test-gates.md](prisma-postgres-test-gates.md) | Changing Prisma dependencies/schema, CI verification ordering, or PostgreSQL integration tests |
| [generation-dedupe.md](generation-dedupe.md) | Generated recommendations/proposals/opportunities/tasks are recreating old or already finished ideas |
| [pilot-queue-usability.md](pilot-queue-usability.md) | Pilot queues are technically deduped but still feel stale, opaque, or misleading to operators |
| [seo-pilot-proposal-actions.md](seo-pilot-proposal-actions.md) | SEO Pilot actions create proposals that do not generate or publish correctly in Content Pilot |
| [surface-fix.md](surface-fix.md) | Running a bounded audit/fix loop for one named product surface |
| [topical-map-locator-resolution.md](topical-map-locator-resolution.md) | Resolving approved topical-map Markdown and CSV source locators without interpreting policy semantics |
| [topical-map-contract-integrity.md](topical-map-contract-integrity.md) | Validating an approved topical-map contract's hash-bound anchors, coverage, references, and approval blockers before compilation |
| [topical-map-contract-compilation.md](topical-map-contract-compilation.md) | Atomically compiling an approved typed topical-map contract without deriving policy from source prose |
| [topical-map-validation.md](topical-map-validation.md) | Validating a complete raw and compiled topical-map package for import eligibility without repairing, persisting, or activating it |
| [topical-map-activation-persistence.md](topical-map-activation-persistence.md) | Persisting immutable strategy packages and atomically activating, superseding, or rolling back validated versions |
| [topical-map-policy-evaluation.md](topical-map-policy-evaluation.md) | Deterministically evaluating a supplied governed proposal without selecting, persisting, or executing a strategy |
| [topical-map-operator-surface.md](topical-map-operator-surface.md) | Rendering authenticated, read-only topical-map package governance in SEO Pilot |
| [ad-approval-workflow.md](ad-approval-workflow.md) | Working on or debugging the Ad Approval workflow (state machine, AI reviews, reviewer assignment, SLA escalation, conflict-of-interest) |
