# App Bridge Token Validity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept valid near-expiry App Bridge tokens while preventing their cache reuse.

**Architecture:** `getAppBridgeIdToken()` reuses only cached tokens with at least 30 seconds remaining. `requestTokenWithRetry()` accepts a token until its actual JWT expiration and caches it only when it meets the cache-reuse margin.

**Tech Stack:** TypeScript, React, Shopify App Bridge, Vitest.

## Global Constraints

- Browser authentication uses only Shopify App Bridge bearer tokens.
- `NEXT_PUBLIC_AUTOPILOT_API_KEY` and `x-autopilot-api-key` must not appear in browser auth code.
- The 30-second safety margin applies to cached-token reuse, not validity of a newly issued token.

---

### Task 1: Accept Valid Near-Expiry App Bridge Tokens

**Files:**
- Modify: `__tests__/hooks/use-auth-fetch.test.ts`
- Modify: `hooks/use-auth-fetch.ts`

**Interfaces:**
- Consumes: `getAppBridgeIdToken(nowMs?: number, options?: TokenLoadOptions): Promise<string>`.
- Produces: A token is returned when `exp > nowMs`; it is cached only when `exp - TOKEN_EXPIRY_SKEW_MS > nowMs`.

- [x] **Step 1: Write the failing test**

Add this test after the cached-token expiry-skew test:

```ts
it("accepts a valid near-expiry token but refreshes it instead of caching it", async () => {
  const nearExpiryToken = jwtExpiresIn(20);
  const freshToken = jwtExpiresIn(120);
  const idToken = vi.fn()
    .mockResolvedValueOnce(nearExpiryToken)
    .mockResolvedValueOnce(freshToken);
  stubEmbeddedShopifyWindow(idToken);

  const now = Date.now();
  await expect(getAppBridgeIdToken(now)).resolves.toBe(nearExpiryToken);
  await expect(getAppBridgeIdToken(now + 1_000)).resolves.toBe(freshToken);

  expect(idToken).toHaveBeenCalledTimes(2);
});
```

- [x] **Step 2: Run the new test to verify it fails**

Run: `npm test -- __tests__/hooks/use-auth-fetch.test.ts`

Expected: the new test fails with `Shopify App Bridge returned an expired idToken` because the current code uses the cache-reuse margin as a validity check.

- [x] **Step 3: Write the minimal implementation**

In `requestTokenWithRetry()`, replace the near-expiry rejection and unconditional cache assignment with:

```ts
if (expiresAtMs && expiresAtMs <= Date.now()) {
  throw new Error("Shopify App Bridge returned an expired idToken");
}

cachedIdToken = expiresAtMs && expiresAtMs - TOKEN_EXPIRY_SKEW_MS > Date.now()
  ? { token, expiresAtMs }
  : null;
```

- [x] **Step 4: Run the focused test suite**

Run: `npm test -- __tests__/hooks/use-auth-fetch.test.ts __tests__/lib/auth.test.ts`

Expected: all focused tests pass.

- [x] **Step 5: Run typecheck and record scaffold context**

Run: `npm run typecheck`

Expected: exit code 0. Update `.mex/ROUTER.md` with the corrected App Bridge token-validity behavior and timestamp.

- [x] **Step 6: Commit the focused change**

Run:

```bash
git add hooks/use-auth-fetch.ts __tests__/hooks/use-auth-fetch.test.ts .mex/ROUTER.md docs/superpowers/specs/2026-07-10-app-bridge-token-validity-design.md docs/superpowers/plans/2026-07-10-app-bridge-token-validity.md
git commit -m "fix: accept valid near-expiry App Bridge tokens"
```
