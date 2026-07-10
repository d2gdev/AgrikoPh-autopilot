# Task 4 reviewer remediation report

Date: 2026-07-10

## Finding

The missing-canonical-identity branch in `generateProposalDraft()` used a token-scoped `updateMany`, but it ignored `count`. If rejection or a newer generation cleared/replaced the token between the AI-generation claim and this deterministic failure persistence, the service returned `failed` despite not updating the row. That response could misrepresent a discarded, stale operation as the current proposal failure.

The existing receipt-preservation test only demonstrated that a `publishing` draft status could be claimed with `preservePublishedReceipt`; it did not prove the published receipt itself survived the claim while the AI request remained in flight.

## Red evidence

Added two test-first regressions in `__tests__/lib/content-pilot/generation-service.test.ts`:

1. A non-`new-content` proposal without canonical identity claims a token and then receives `{ count: 0 }` for its conditional failure persistence. It expects `{ kind: "discarded", reason: "Proposal changed before missing identity failure persistence could complete" }` and confirms no AI generation occurs.
2. A published proposal starts receipt-preserving generation with a deliberately unresolved AI promise. While that promise is pending, the test verifies the claimed row has `draftStatus: "generating"` and still retains `publishedAt`, `shopifyArticleId`, `publishedHandle`, and the live `draftContent` receipt.

Red command:

```text
npm test -- --run __tests__/lib/content-pilot/generation-service.test.ts
```

Observed result before the implementation:

```text
expected { kind: 'failed', ... } to deeply equal { kind: 'discarded', ... }
received: { kind: 'failed', error: 'Proposal type "refresh" requires an articleHandle ...' }
```

The receipt-preservation regression passed against the existing claim payload; the lost-token identity regression failed for the intended production behavior.

## Correction

The missing-identity branch now calls the shared `failGeneration()` helper, which applies the token and publishable-status predicate. It returns `discarded` when `updateMany.count === 0`; otherwise its unchanged behavior is to return `failed` with the deterministic missing-identity error. This matches the pre-existing explicit validation and caught-validation persistence behavior.

No Task 5 files were read for implementation changes or modified. No stash was applied.

## Verification

```text
npm test -- --run __tests__/lib/content-pilot/generation-service.test.ts __tests__/api/content-pilot-draft-citations.test.ts __tests__/api/embedded-fallback-auth-routes.test.ts __tests__/api/content-pilot-reject-route.test.ts
4 test files passed, 24 tests passed

npm run typecheck
tsc --noEmit passed

git diff --check
passed
```

## GROW record

- Ground: lost generation ownership during missing-identity validation is now reported as `discarded`, and receipt-preserving generation explicitly protects live receipt data while AI runs.
- Record: updated `.mex/ROUTER.md` and the closest recurring-generation gotcha in `.mex/patterns/generation-dedupe.md`.
- Orient: no new pattern file was necessary; the existing generation pattern now documents the conditional-write-count rule.
- Write: the corresponding project rationale is recorded through `mex log` before commit.

---

## Spec-review follow-up (2026-07-10)

### Findings corrected

1. Receipt-preserving generation could claim a `publishing` proposal because its claim predicate excluded only `generating`.
2. Receipt-preserving generation replaced the visible published `draftStatus` with `generating` while AI ran, despite its durable token already providing ownership.

### Test-first evidence

Added/updated regressions in `__tests__/lib/content-pilot/generation-service.test.ts` and ran them before the implementation:

```text
npm test -- --run __tests__/lib/content-pilot/generation-service.test.ts
2 failed, 7 passed
```

The failures showed the claim predicate was `notIn: ["generating"]` and the receipt-preserving claim payload contained `draftStatus: "generating"`.

### Minimal correction

The ownership predicate always excludes `generating` and `publishing`. When `preservePublishedReceipt` is true, the claim writes only `draftGenerationToken` and `draftGenerationStartedAt`; it leaves the visible published status and receipt untouched.

### Verification

```text
npm test -- --run __tests__/lib/content-pilot/generation-service.test.ts
9 tests passed

npm test -- --run __tests__/lib/content-pilot/generation-service.test.ts __tests__/api/content-pilot-draft-citations.test.ts __tests__/api/embedded-fallback-auth-routes.test.ts __tests__/api/content-pilot-reject-route.test.ts
4 test files passed, 25 tests passed

npm run typecheck
tsc --noEmit passed
```

No Task 5 file was modified and no stash was applied.
