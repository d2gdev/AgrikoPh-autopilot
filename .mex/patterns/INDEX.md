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
| [generation-dedupe.md](generation-dedupe.md) | Generated recommendations/proposals/opportunities/tasks are recreating old or already finished ideas |
| [pilot-queue-usability.md](pilot-queue-usability.md) | Pilot queues are technically deduped but still feel stale, opaque, or misleading to operators |
| [seo-pilot-proposal-actions.md](seo-pilot-proposal-actions.md) | SEO Pilot actions create proposals that do not generate or publish correctly in Content Pilot |
| [ad-approval-workflow.md](ad-approval-workflow.md) | Working on or debugging the Ad Approval workflow (state machine, AI reviews, reviewer assignment, SLA escalation, conflict-of-interest) |
