---
name: auth
description: Authentication — Shopify App Bridge session tokens vs admin access token
metadata:
  type: project
---

# Auth

## ⚠️ App Bridge CDN intercepts `window.fetch` — the idToken 30s-hang root cause

`app/layout.tsx` loads `https://cdn.shopify.com/shopifycloud/app-bridge.js`. **This CDN script monkey-patches `window.fetch` at load time** and auto-intercepts every request to the app's own domain to attach `Authorization: Bearer <idToken>`. Fetching that token needs a postMessage handshake with the Shopify Admin host frame; when the host stalls, the call blocks ~30s and fails with `"idToken unavailable: host did not respond in time"`. This made Content Pilot's `/api/content-pilot/{articles,topic-clusters,link-graph}` fetches time out.

**There is NO `idToken()` call in our source** — App Bridge injects it at runtime. Grepping the codebase for `idToken` finds nothing actionable; the stack trace `app-bridge.js → <chunk> → page` is App Bridge wrapping a fetch *our* code makes. This wasted ~30 fix attempts.

**Fix (live in prod):** opt out via meta tag in `app/layout.tsx`, placed before the App Bridge script:
```html
<meta name="shopify-disabled-features" content="fetch" />
```
This disables ONLY the fetch interceptor — App Bridge stays loaded so `NavMenu` (in `app/providers.tsx`), embedding, and `auto-redirect` still work. Confirm a change took effect by curling the served HTML for the meta tag, not by re-reading source. Docs: shopify.dev Resource Fetching API / Config API (`disabledFeatures`, supports `'fetch'` and `'auto-redirect'`).

## Current UI auth: static API key (not session tokens)

UI→backend auth now uses a static header `x-autopilot-api-key` from `NEXT_PUBLIC_AUTOPILOT_API_KEY`, set by `hooks/use-auth-fetch.ts` (`useAuthFetch`). This replaced App Bridge `idToken()` session tokens precisely because the interceptor above made them unusable. The "Dual auth model" section below describes the *legacy* session-token path — verify against `lib/auth.ts` before relying on it.

### Route auth pattern — ALWAYS gate with `requireAppAuth`

`requireAppAuth(req)` (lib/auth.ts) is the only correct gate: it accepts the `x-autopilot-api-key` header AND falls back to a session token, returning a 401 `NextResponse` or `null`. Use it as:
```ts
const authError = await requireAppAuth(req);
if (authError) return authError;
```
**`getSessionShop(req)` / `getSessionUser(req)` return `null` under API-key auth** (no JWT). Never use them as a gate (`if (!shop) return 401`) — that 401s every API-key request. Use them ONLY for actor attribution, always with a fallback: `(await getSessionUser(req)) ?? "operator"` (human-action/audit fields like `updatedBy`, `approvedBy`, audit-log `actor`) or `?? "api"` (rate-limit keys).

The API-key migration originally MISSED ~15 routes that still gated on `getSessionShop`/`getSessionUser` → they all returned `Unauthorized`. Symptom: a feature works for reads (already-migrated routes) but POST/action endpoints 401. Fixed routes incl. content-pilot/brief, seo/{brief,analyze}, email-pilot/analyze, social-pilot/analyze, images, settings/{route,credentials,credentials/[key],connector-health}, cron/status, recommendations/{[id]/approve,[id]/reject,[id]/request-override,dry-run}. If you add a route, grep `getSessionShop|getSessionUser` and confirm a `requireAppAuth` gate precedes any attribution use.

## Dual auth model

**Shopify App Bridge session tokens** — used for UI requests from the embedded app. Verified by `lib/auth.ts` → `getSessionShop(req)`. Returns the shop domain as the actor. Required on all settings and recommendation API routes.

**Admin access token** — used for server-side Shopify API calls (blog articles, products). Stored in `ApiCredential` / `.env` as `SHOPIFY_ADMIN_ACCESS_TOKEN`. Never exposed to UI. Auto-refreshed on 401.

**Cron bearer token** — `CRON_SECRET` env var. All `/api/cron/*` routes check `Authorization: Bearer $CRON_SECRET`. Fails closed (rejects) if `CRON_SECRET` is unset.

## `getSessionShop(req)` behavior

- Validates App Bridge JWT from `Authorization` header
- Returns shop domain string on success, `null` on failure
- All protected routes: `if (!actor) return 401`

## No custom user accounts

There is no user table. Auth is entirely Shopify-session-based. The "actor" is always the shop domain.
