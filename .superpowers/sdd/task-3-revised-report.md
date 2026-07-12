# Task 3 Revised: Compile approved contract mappings

## Scope and boundary

Implemented only the server-only topical-map compiler boundary. `compileStrategyPackage(raw)` safely decodes and strictly parses the supplied hash-verified contract bytes, invokes existing `validateCompilationContractIntegrity` before any projection, resolves human-source locators, normalizes explicit governed URL fields, and returns a complete typed, domain-indexed record set. It does not parse Markdown/CSV prose for policy, access a database/network/filesystem beyond the supplied package, persist/import/activate a package, expose an API, evaluate proposals, or execute changes.

## RED

Command:

```text
npm test -- __tests__/lib/topical-map/compiler.test.ts
```

Result before implementation: failed as intended with `Cannot find package '@/lib/topical-map/compiler'`; the compiler module was absent and no tests ran.

## GREEN

Added:

- `lib/topical-map/compiler.ts`
- `lib/topical-map/url-normalizer.ts`
- compiler-safe error types in `lib/topical-map/types.ts`
- `__tests__/lib/topical-map/compiler.test.ts`

Focused command:

```text
npm test -- __tests__/lib/topical-map/compiler.test.ts
```

Result: 1 file passed, 7 tests passed.

The tests cover the exact approved July 12 package (1,493 rules / 853 coverage units / 163 URL / 113 redirect / 456 link rows), all typed domains, conditional recipe prohibition, dossier and medical/dosage gates, locator/provenance retention without bytes, deterministic URL normalization and external rejection, atomic integrity failures, determinism, and input non-mutation.

### URL network-path regression

RED command:

```text
npm test -- __tests__/lib/topical-map/compiler.test.ts
```

Result: 1 file failed, 1 of 7 tests failed as expected. `//example.com/path`, `///example.com/path`, and `/\\example.com/path` did not throw `EXTERNAL_GOVERNED_URL` before the fix.

GREEN implementation: `normalizeGovernedUrl` now rejects network-path and slash-backslash forms before treating a value as an internal relative path.

GREEN commands:

```text
npm test -- __tests__/lib/topical-map/compiler.test.ts
```

Passed: 1 file, 7 tests.

## Required verification

```text
npm run typecheck
```

Passed.

```text
npm run typecheck:test
```

Passed.

```text
npx vitest run __tests__/lib/topical-map/compiler.test.ts __tests__/lib/topical-map/contract-integrity.test.ts __tests__/lib/topical-map/contract.test.ts __tests__/lib/topical-map/locator-resolver.test.ts __tests__/lib/topical-map/manifest.test.ts __tests__/lib/topical-map/package-reader.test.ts --maxWorkers=4
```

Passed: 6 files, 86 tests; duration 23.24s. Four workers were used solely so the exact required combined set completed within the interactive runner window.

Regression re-run after the URL fix: passed 6 files, 86 tests; duration 24.12s.

```text
npm run lint
```

Passed with 0 errors and 118 warnings. All warnings are pre-existing outside the Task 3 changed files; ESLint reported 16 potentially auto-fixable existing warnings.

```text
git diff --check
```

Passed with no output.

## Self-review

- Projection takes policy semantics only from strict contract rule fields.
- Integrity validation completes before coverage/rule projection and any return value.
- Every source reference retains the declared locator and resolved artifact coordinates; compiled output contains no source bytes.
- URL normalization is limited to named typed governed URL fields and never mines free-text evidence.
- No persistence, activation, evaluator, API, UI, cron, production, Shopify, or Meta scope was added.

## GROW

- **Ground:** Added atomic typed whole-package compilation and governed URL normalization.
- **Record:** Updated `.mex/ROUTER.md`, `.mex/context/architecture.md`, and `.mex/context/decisions.md`.
- **Orient:** Added `.mex/patterns/topical-map-contract-compilation.md` and indexed it.
- **Write:** Bumped `last_updated` on changed scaffold files and recorded a decision with `mex log`.

## Commit and final worktree

Initial Task 3 commit: `444814e feat(topical-map): compile whole-package policy records`.

The required amend was attempted after the regression verification but is blocked by sandboxed Git metadata: `Unable to create '/home/sean/Agriko/auto-pilot/.git/worktrees/feat-topical-map-strategy-persistence/index.lock': Read-only file system`. Consequently this complete bounded regression diff cannot be staged or amended here, and final clean-worktree evidence is unavailable until the worktree Git metadata is writable.

## Concerns / blockers

No material typed-contract ambiguity or operator-judgment blocker was encountered. The only verification noise is the documented 118 pre-existing lint warnings.
