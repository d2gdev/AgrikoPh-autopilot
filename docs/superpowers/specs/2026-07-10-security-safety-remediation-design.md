# Security and Safety Remediation Design

## Goal

Close the five highest-severity plugin review findings without interrupting normal Shopify, cron, or deployment operation, and rotate the API key that has already been exposed to browser assets.

## Authentication and Credential Rotation

The browser will use Shopify App Bridge session tokens exclusively. `hooks/use-auth-fetch.ts` will remove all reads, headers, retries, and ready-state shortcuts involving `NEXT_PUBLIC_AUTOPILOT_API_KEY`. The public variable will be removed from local `.env` and `.env.production` configuration and from the production VPS environment.

The server-only `AUTOPILOT_API_KEY` remains available for explicit scripted access through `X-Autopilot-Api-Key`. A new cryptographically random value will replace the current value locally and on the VPS only after the remediated browser code is deployed and verified. Repository crons continue using `CRON_SECRET` and are unaffected. Any external private script using the old API key must adopt the new value.

Rollout order prevents an authentication outage: test and deploy browser code first, verify authenticated Shopify API traffic and health while the old server key still works, then rotate the server key and remove the public variable, restart PM2, and verify again. The previous build remains available until health succeeds.

## Live Execution Gate

`executeApprovedHandler` will own the live-write decision. Its options will express an explicit live request rather than an optional `dryRun` default. The handler will execute live only when the request is explicit and `EXECUTE_APPROVED_LIVE_ENABLED === "true"`; all omitted, false, test, and direct-call cases are dry-run.

The cron route will pass the URL's `live=true` intent to the handler and derive response headers from the same shared mode resolver. The Recommendations dry-run route will request no live capability. Tests that intentionally exercise connector execution will explicitly enable both inputs, preventing new callers from silently inheriting live behavior.

## GitHub Credential Transport

The deploy script will stop placing the GitHub authorization header in Git `-c` arguments and in the SSH command text. Local Git authentication will use a temporary mode-0700 `GIT_ASKPASS` helper whose path is passed through the environment; the token itself remains in the child environment and never appears in argv. The helper is removed in `finally`.

For the VPS fetch, the token will travel over encrypted SSH stdin. The remote script will read it without echoing, create its own temporary askpass helper, perform the fetch with terminal prompts disabled, and remove the helper through a shell trap. Logs and thrown command descriptions must not contain the token.

## Health-Gated Deployment Rollback

After swapping builds and starting PM2, the remote script will poll the public health endpoint with a bounded retry loop. `.next.old` will remain intact until health returns successfully. If startup or health fails, the script will move the failed build aside, restore `.next.old`, restart PM2, remove failed artifacts, and exit non-zero. The existing local health check remains as a second verification after remote success.

Database migrations still require expand/contract compatibility because schema changes cannot be automatically rolled back with the build.

## Destructive Reset Credentials

The Market Intelligence reset route will reject query-string maintenance and confirmation credentials. It will accept only `X-Maintenance-Secret` and `X-Maintenance-Confirm` headers after Shopify session authentication. Tests and operations documentation will use headers exclusively. Production reset secrets will be rotated if they are configured because previous values may exist in request logs.

## Testing and Rollout

Implementation follows red-green TDD:

1. Client-auth tests prove no public API-key fallback or header remains.
2. Execution tests prove direct/default calls are dry-run and live execution needs both explicit intent and the environment flag.
3. Deploy-policy tests prove secrets are absent from argv/remote script, askpass cleanup exists, build rollback is health-gated, and `.next.old` survives until health succeeds.
4. Reset-route tests prove URL credentials fail and header credentials succeed.
5. Run typechecks, the full Vitest suite, production build, script syntax checks, and diff checks.
6. Deploy main, verify health and embedded authentication, rotate the API and reset secrets, restart PM2, and verify health plus authenticated API traffic again.

## Scope Boundaries

- No Meta or Shopify content/ad write is executed as part of verification.
- No database schema change is required.
- `CRON_SECRET`, Shopify credentials, and permission actor lists are unchanged.
- GitHub deploy-key provisioning is not required; the existing PAT remains in use through non-argv transport.
