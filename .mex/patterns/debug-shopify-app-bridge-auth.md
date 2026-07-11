---
name: debug-shopify-app-bridge-auth
description: Diagnose and fix Shopify embedded UI auth failures caused by App Bridge idToken timeouts, tab changes, or lost host context.
triggers:
  - "App Bridge idToken timed out"
  - "Shopify Admin connection"
  - "Failed to load dashboard data: Unauthorized"
  - "embedded auth"
  - "tab change breaks auth"
edges:
  - target: context/architecture.md
    condition: for the embedded UI and requireAppAuth flow
  - target: context/conventions.md
    condition: before changing auth helpers or embedded API routes
  - target: patterns/deploy.md
    condition: when deploying an auth fix to production
last_updated: 2026-07-11T01:33:00Z
---

# Debug Shopify App Bridge Auth

## Context

Embedded browser API calls normally use Shopify App Bridge session tokens through `hooks/use-auth-fetch.ts`, and API routes validate them with `requireAppAuth()` in `lib/auth.ts`.

In production, Shopify App Bridge can expose `window.shopify` and preserve `host`, but still fail to answer `shopify.idToken()`. Do not treat a longer timeout as a fix. The timeout is a symptom of a broken or unavailable parent-frame handshake.

Browser code must never read `AUTOPILOT_API_KEY` through a `NEXT_PUBLIC_*` variable or send `x-autopilot-api-key`. That key is server-only and remains available solely for trusted scripts and server-to-server diagnostics.

## Steps

1. Confirm the browser is using the latest deployed auth chunk.
   - Look for the loaded `/_next/static/chunks/8499-*.js` in the console or page HTML.
   - If the browser is still using an older chunk, hard refresh before changing code again.

2. Identify the failure mode.
   - `Shopify App Bridge idToken request timed out after 15000ms` or `2000ms`: App Bridge handshake is not answering.
   - `Failed to load dashboard data: Unauthorized`: API calls are reaching the server without usable auth.
   - "Works on first load, breaks after tab/navigation": client-side navigation likely lost Shopify URL context or retriggered App Bridge token loading.

3. Do not increase token timeouts.
   - Keep short API-call token attempts.
   - A token acquisition failure must reject the request before `fetch()`; never continue unauthenticated.

4. Check the auth helper first.
   - `useAuthFetch()` must acquire an App Bridge token and attach `Authorization: Bearer <token>` unless the caller already supplied an authorization header.
   - A 401 response is returned to the caller without retrying with another credential.
   - Source and bundle scans must find no `NEXT_PUBLIC_AUTOPILOT_API_KEY` or browser `x-autopilot-api-key` path.

5. Check the auth gate.
   - `useAppBridgeAuth()` becomes ready only after App Bridge initialization/token success.
   - A failed `idToken()` attempt should surface the embedded-auth error state instead of silently bypassing authentication.

6. Check server auth.
   - `requireAppAuth()` validates App Bridge JWTs for embedded traffic. The API-key path exists only for trusted non-browser callers and must never be exposed to the client bundle.
   - After trusted API-key auth succeeds, routes that intentionally support scripted access cannot assume `getSessionShop()` is present; use `getSessionUser()` or a stable fallback actor for rate limits and audit logs.
   - Routes that commonly regress here: Social analysis, image alt-text generation, settings/connector health, settings saves, cron/status-style embedded status endpoints.
   - A server-side diagnostic can still use remote env expansion without printing the secret:
     ```bash
     ssh autopilot-prod 'cd /opt/autopilot && bash --norc --noprofile -c '\''set -a; source .env; set +a; curl -sS -o /tmp/jobs-status.json -w "%{http_code}" -H "x-autopilot-api-key: ${AUTOPILOT_API_KEY}" https://autopilot.agrikoph.com/api/jobs/status; echo'\'''
     ```
   - Expected: `200`.

7. Preserve Shopify context for navigation.
   - Internal route pushes and Polaris navigation should use `withShopifyContextUrl()`.
   - Plain Next `Link href="/..."` can drop `host`/`shop`; fix these when they lead to embedded pages.

## Gotchas

- `host` present does not prove `idToken()` will resolve.
- `window.shopify` present does not prove App Bridge auth is usable.
- A bearer token can still be rejected by the server; inspect the JWT audience/shop and server logs instead of adding a browser fallback.
- A valid-looking bearer token with `signature verification failed` usually means the app credentials are mismatched: the JWT `aud`/App Bridge client ID must match the server-side session-token secret. If the Admin API token-refresh app is intentionally different, set `SHOPIFY_SESSION_API_KEY`, `SHOPIFY_SESSION_API_SECRET`, and `NEXT_PUBLIC_SHOPIFY_SESSION_API_KEY`.
- If those optional session-credential overrides are being rolled back, remove all three values, rebuild so the browser bundle receives the original public key, then delete and recreate the PM2 process with the variables explicitly unset. `pm2 restart --update-env` can retain removed variables and makes the rollback appear ineffective.
- Never log the raw bearer JWT while debugging verification failures; log only decoded public metadata such as `aud`, `dest`, `iss`, and `exp`.
- Do not use local shell interpolation when checking remote env vars; it can send an empty header and produce a false 401.
- The full deploy script rsyncs the whole working tree. If unrelated dirty files exist, deploy only scoped files or commit intentionally before using it.

## Verify

- Focused tests:
  ```bash
  npm test -- __tests__/hooks/use-auth-fetch.test.ts __tests__/lib/auth.test.ts
  npm run typecheck
  ```
- Production:
  ```bash
  curl -sS https://autopilot.agrikoph.com/api/health
  ssh autopilot-prod "pm2 status"
  ```
- Browser:
  - Hard refresh Shopify Admin app.
  - Confirm the console uses the latest `8499-*.js` chunk.
  - Switch between tabs/pages that previously failed.
  - Confirm no `idToken timed out` banner appears and dashboard data stays loaded.

## Debug

If it still fails:
- Inspect Network request headers for the failing `/api/*` call.
- If `Authorization` is missing, fix App Bridge initialization or `useAuthFetch()` token acquisition.
- If the bearer header is present and the response is 401, inspect JWT validation inputs and server logs without printing the token.
- If any browser request carries `x-autopilot-api-key`, treat it as a credential exposure regression and remove the client path.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` if the embedded auth strategy changes
- [ ] Update `context/architecture.md` if the browser auth strategy changes
- [ ] Keep this pattern aligned with the no-browser-secret invariant
