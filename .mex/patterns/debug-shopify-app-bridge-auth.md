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
last_updated: 2026-06-30
---

# Debug Shopify App Bridge Auth

## Context

Embedded browser API calls normally use Shopify App Bridge session tokens through `hooks/use-auth-fetch.ts`, and API routes validate them with `requireAppAuth()` in `lib/auth.ts`.

In production, Shopify App Bridge can expose `window.shopify` and preserve `host`, but still fail to answer `shopify.idToken()`. Do not treat a longer timeout as a fix. The timeout is a symptom of a broken or unavailable parent-frame handshake.

This project currently has a temporary same-origin fallback:
- browser: `NEXT_PUBLIC_AUTOPILOT_API_KEY`
- server: `AUTOPILOT_API_KEY`
- header: `x-autopilot-api-key`

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
   - If fallback auth is configured, same-origin API calls should not invoke `idToken()` at all.

4. Check the auth helper first.
   - `useAuthFetch()` must attach `x-autopilot-api-key` to same-origin API requests when `NEXT_PUBLIC_AUTOPILOT_API_KEY` exists.
   - Once that fallback key is attached for a same-origin request, skip `getAppBridgeIdToken()` entirely.
   - Keep a 401 retry with fallback only for paths that did not already send the fallback key.

5. Check the auth gate.
   - `useAppBridgeAuth()` should mark auth ready when the same-origin fallback key exists.
   - Do not let a later failed `idToken()` attempt overwrite the gate into an error state when fallback auth is available.

6. Check server auth.
   - `requireAppAuth()` must accept the matching private fallback key while this temporary fallback is active.
   - After `requireAppAuth()` succeeds, do not immediately fail the route because `getSessionShop()` is null. API-key fallback auth is valid but does not create a Shopify session shop; use `getSessionUser()` or a stable fallback actor for rate limits and audit logs.
   - Routes that commonly regress here: Social analysis, image alt-text generation, settings/connector health, settings saves, cron/status-style embedded status endpoints.
   - Verify with a remote-side env expansion:
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
- A bearer token can still be rejected by the server; fallback must be sent on the first same-origin request while the workaround is active.
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
- If `x-autopilot-api-key` is missing, fix `useAuthFetch()` same-origin detection.
- If `x-autopilot-api-key` is present and response is 401, compare server/public key hashes on the VPS without printing secrets.
- If the page shows the App Bridge error banner but API calls succeed, fix `useAppBridgeAuth()` so fallback-ready state is not overwritten by token errors.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Known issues" if the fallback is removed or App Bridge session auth is fully fixed
- [ ] Update `context/architecture.md` if the browser auth strategy changes
- [ ] Update this pattern if the temporary fallback is removed
