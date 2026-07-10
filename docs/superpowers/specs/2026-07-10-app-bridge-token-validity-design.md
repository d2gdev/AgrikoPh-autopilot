# App Bridge Token Validity Design

## Goal

Stop the embedded auth gate from rejecting a valid Shopify App Bridge `idToken()` merely because it has fewer than 30 seconds remaining.

## Decision

Treat the 30-second safety margin as a cache-reuse rule only. A newly returned token is accepted until its actual JWT `exp` timestamp. Tokens in the margin are deliberately not cached, so the next request obtains a new token from App Bridge.

## Alternatives Considered

1. Remove the margin entirely. Rejected because a cached token could expire during an API request.
2. Keep rejecting newly returned near-expiry tokens. Rejected because Shopify may legitimately return a valid token in this window, producing the reported false error.
3. Use the margin only for cache reuse. Selected: preserves request safety and accepts valid tokens from the authority that issued them.

## Scope

- Update `hooks/use-auth-fetch.ts` only at token acceptance/cache handling.
- Add a regression test in `__tests__/hooks/use-auth-fetch.test.ts`.
- Preserve retry behavior, server-side verification, and the no-browser-secret invariant.

## Verification

The regression test will prove that a token with less than 30 seconds remaining is returned successfully, then is refreshed rather than reused on the following request. The focused auth test suite and typecheck will be run afterwards.
