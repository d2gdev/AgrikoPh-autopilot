---
name: topical-map-locator-resolution
description: Resolve approved topical-map Markdown and CSV locators deterministically without compiling policy semantics.
triggers:
  - "topical-map locator"
  - "source fingerprint"
  - "compilation contract anchor"
edges:
  - target: ../../lib/topical-map/contract.ts
    condition: when validating the approved contract grammar before resolving locators
  - target: ../../lib/topical-map/package-reader.ts
    condition: when resolving locators from hash-verified package artifacts
last_updated: 2026-07-12
---

# Topical-map Locator Resolution

## Context

Read the approved contract schema, review packet, and `lib/topical-map/contract.ts` first. The contract is an anchored index, never an authority to infer policy. Keep source bytes server-only and return only identity and coordinates.

## Steps

1. Parse the strict contract before consuming its locator objects.
2. Confirm locator kind matches the semantic artifact media type.
3. Resolve Markdown by heading path and normalized content fingerprint; resolve CSV by its artifact-specific stable business key, normalized header fingerprint, and canonical ordered header/value-pair fingerprint.
4. Treat line and row numbers as review aids only; accept movement only if the fingerprinted anchor is unique.
5. Throw the stable typed error without source text for malformed, cross-artifact, missing, ambiguous, or fingerprint-drifted locators.

## Gotchas

- CSV business keys are `current_url`, `redirect_id`, and `from_url` + U+001F + `to_url` for URL inventory, redirects, and internal links respectively.
- CSV canonicalization NFC-normalizes and trims values while preserving header order and RFC-style quoted fields.
- A Markdown prose span’s recorded line range may be stale; fingerprint and heading path are its identity.
- Do not add coverage/reference validation, policy compilation, storage, activation, APIs, or source-content logging to this layer.

## Verify

- `npm test -- __tests__/lib/topical-map/locator-resolver.test.ts`
- `npm run typecheck`
- `npm run typecheck:test`
- `git diff --check`

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` "Current Project State" if the resolver boundary changed.
- [ ] Update this pattern if the approved grammar gains a new locator variant.
