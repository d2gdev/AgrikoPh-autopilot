---
name: topical-map-contract-compilation
description: Atomically compile an approved typed topical-map contract without deriving policy from source prose.
triggers:
  - "topical-map compiler"
  - "compile strategy package"
  - "compiled topical-map policy"
edges:
  - target: ../../lib/topical-map/contract-integrity.ts
    condition: before projecting any package rule
  - target: ../../lib/topical-map/locator-resolver.ts
    condition: when preserving human-source coordinates
last_updated: 2026-07-12
---

# Topical-map Contract Compilation

## Context

The strict parsed compilation contract is the policy authority. Markdown and CSV bytes only support existing artifact-hash, coverage, and locator validation; never infer policy from their prose, tables, or headings.

## Steps

1. Safely decode and parse only the supplied hash-verified contract bytes.
2. Run `validateCompilationContractIntegrity` before constructing any result.
3. Resolve every coverage and rule source locator with the existing resolver, retaining only artifact identity and coordinates.
4. Project all and only typed contract fields into a complete domain-indexed result, including rule identity, conditions, evidence/review requirements, provenance, and human-source locators.
5. Normalize explicit governed URL fields deterministically; reject malformed or external governed destinations. Do not mine free-text evidence for URLs.
6. Return only after every projection succeeds. Propagate safe typed validation errors and never return partial policy.

## Gotchas

- `task3Authorized:false` in the protected approval metadata does not authorize editing or reinterpreting the contract; Task 3 is separately authorized.
- Preserve typed schedule/advisory boundaries exactly. Compilation has no persistence, activation, evaluation, API, or execution authority.
- Do not expose artifact bytes in compiled output or safe errors.

## Verify

- `npm test -- __tests__/lib/topical-map/compiler.test.ts __tests__/lib/topical-map/contract-integrity.test.ts __tests__/lib/topical-map/contract.test.ts __tests__/lib/topical-map/locator-resolver.test.ts __tests__/lib/topical-map/manifest.test.ts __tests__/lib/topical-map/package-reader.test.ts --maxWorkers=4`
- `npm run typecheck`
- `npm run typecheck:test`
- `npm run lint`
- `git diff --check`

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` when the compiler boundary changes.
- [ ] Update architecture/decisions if compilation authority or output boundary changes.
