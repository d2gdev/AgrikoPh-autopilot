# Task 2 report — activation-authorized immutable contract revision

## Status

Implemented and committed the activation-authorized contract parser and revision-3 documentation package. No deployment, import, activation, production access, database mutation, Shopify write, or Meta write occurred.

## TDD evidence

- RED: `npm test -- __tests__/lib/topical-map/contract.test.ts` failed exactly one new test because the prior schema required `runtimeActivationAuthorized: false` (31 passed, 1 failed).
- GREEN parser: the same command passed 32/32.
- Final focused matrix: `npm test -- __tests__/lib/topical-map/manifest.test.ts __tests__/lib/topical-map/contract.test.ts __tests__/lib/topical-map/contract-integrity.test.ts __tests__/lib/topical-map/compiler.test.ts __tests__/lib/topical-map/validator.test.ts` passed 78/78 across five files.
- `git diff --check` passed in both repositories before commit.

## Result

- Autopilot parser accepts activation-authorized approved contracts only when validation/import eligibility is true, activation eligibility exactly matches runtime activation authorization, approval identity/time are present, the package is inactive, and live execution remains unauthorized.
- Revision 3 retains 1,493 rules and 853 coverage units. The source locators, rule bodies, coverage inventory, ambiguity dispositions, compatibility, and all five semantic hashes are unchanged.
- Contract SHA-256: `3fe3f70b239fc907b61dc8baf96e2c3916c515fd046f2124ea1f2edb0098cb05`.
- Canonical package SHA-256: `f2a39fabd27a1dcb7ffb29e44695d18a39325186443137dd15762126a8d1bf1c`.
- Semantic hashes rechecked exactly: map `f213be82bf5c774d3cb278b5f316feb4b21ff430762874f46a792a9186b8a7de`; evidence `37c3356dfb9b5ec378fdc88f2d4b6f6e87f1bfba56e599988ffbbe542874c921`; URL inventory `03d673d8a4bc02dd7c1db7690c28de31b3d30bd3860f8dbc44d7c7176d827a31`; redirect inventory `fd2cb1c1892dde6f28d2d042af7a1ecb16fa22d64bf165cfb0bcba19edb2070e`; internal links `b7d620096fb6c7eed326a70b13ff7c3cbe891fe24b4ed94247ad09836cf36345`.

## Commits

- Autopilot: `7b7068b` — `feat(topical-map): accept activation-authorized contracts`
- Theme: `2facef7` — `docs(seo): authorize topical map strategy selection`

## Self-review and concern

The committed dated manifest is canonically hashed and pins all six artifact identities, but the current `parseManifest` filename convention derives every artifact filename from `strategyVersion` (`2026-07-12`). Consequently, it rejects the dated revision-3 contract path (`...-2026-07-13.json`) even though the contract deliberately preserves strategy version `2026-07-12` and reuses the five July-12 semantic artifacts. The Task 2 brief limits parser changes to `contract.ts`, so I did not broaden `manifest.ts` or duplicate/rename semantic artifacts. This must be resolved before Task 3 import; do not deploy/import/activate this manifest as-is.

The theme checkout also contains unrelated pre-existing modified/untracked files; they were not staged or changed. The post-commit hook printed `Illegal number: 97` before reporting `mex ✓ 100/100`; both requested commits were nevertheless created successfully.

## Review-finding correction

The manifest-consumability concern above is resolved in Autopilot: only the compilation-contract path may use a canonical dated basename matching `^agriko-topical-map-compilation-contract-\d{4}-\d{2}-\d{2}\.json$`. The five semantic artifact filenames remain derived from `strategyVersion`; existing path traversal, absolute-path, hash, media-type, and contract-envelope strategy-version checks remain unchanged. The exact revision-3 manifest is now passed through `parseManifest`, and its fixture root is configurable with `TOPICAL_MAP_THEME_ROOT` with a repository-relative sibling fallback.

- RED command: `npm test -- __tests__/lib/topical-map/manifest.test.ts`
- RED result: 1 file failed; 1 failed and 11 passed. The exact-package test failed with `Artifact filename/version mismatch`.
- GREEN command: `npm test -- __tests__/lib/topical-map/manifest.test.ts __tests__/lib/topical-map/package-reader.test.ts __tests__/lib/topical-map/contract.test.ts __tests__/lib/topical-map/contract-integrity.test.ts __tests__/lib/topical-map/compiler.test.ts __tests__/lib/topical-map/validator.test.ts && git diff --check && git -C ../shopify-theme diff --check`
- GREEN result: 6 files passed; 102 tests passed; both diff checks exited zero.
- Package and contract bytes did not change; hashes remain `f2a39fabd27a1dcb7ffb29e44695d18a39325186443137dd15762126a8d1bf1c` and `3fe3f70b239fc907b61dc8baf96e2c3916c515fd046f2124ea1f2edb0098cb05` respectively.
