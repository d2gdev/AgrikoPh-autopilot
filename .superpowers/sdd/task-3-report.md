# Task 3 report — production acceptance, import, and activation

## Status

Completed. The reviewed revision-3 topical-map package is the sole active `agrikoph.com` production strategy. Shopify/Meta live execution remains disabled.

## Local acceptance

- `npm run db:generate`: pass; Prisma client freshness stamp updated.
- `npm run verify:prisma-client`: pass.
- `npm test`: pass (exit 0).
- `npm run typecheck`: pass after correcting an implicit-`any` in the exact-package test.
- `npm run typecheck:test`: pass.
- `npm run lint`: pass (exit 0).
- Isolated `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/autopilot_test?... npm run build`: pass.
- `git diff --check`: pass.
- Guarded `DATABASE_URL_TEST=postgresql://test:test@127.0.0.1:5432/autopilot_test npm run test:postgres`: pass; all 52 migrations current.

The test-only typing correction was committed as `2299c41bda10a81458a4fb4cf62e9b7ef2995ce7` before rollout. Unrelated dirty Shopify-theme files were not staged or changed.

## Backup and deployment

- Verified custom-format backup: `/opt/backups/autopilot-topical-map-activation-20260712T211030Z.dump`.
- Size: 28,374,854 bytes.
- SHA-256: `92c335073944d04d09df3a372d06b5c9d4984d94522458c23e2712d3c4ed1533`.
- `pg_restore --list`: pass.
- Deployed with `node scripts/git-deploy.mjs`.
- Initial release commit parity: local/origin/server `2299c41bda10a81458a4fb4cf62e9b7ef2995ce7`.
- Production migrations: 52 present, none pending.
- Initial active build ID: `SAuR45WdRY950HUfxeFge`.
- PM2: online; public health: `ok`, no degraded reasons.

## Package install and import

- Installed exactly seven files under mode-0700 `/opt/autopilot-strategy/topical-map-f2a39fabd27a1dcb` (one manifest and six artifacts; files mode 0600).
- Runtime canonical manifest filename: `strategy-package-manifest.json`; bytes are the committed revision-3 dated manifest.
- Package SHA-256 independently derived on production: `f2a39fabd27a1dcb7ffb29e44695d18a39325186443137dd15762126a8d1bf1c`.
- Contract SHA-256: `3fe3f70b239fc907b61dc8baf96e2c3916c515fd046f2124ea1f2edb0098cb05`.
- All five semantic artifact hashes matched the manifest.
- The first import attempt returned typed `MISSING_FILE` because the runtime requires the canonical manifest basename. Renaming the same reviewed manifest in place preserved exactly seven files and the package identity; no validation was bypassed.
- Authenticated import returned HTTP 201 and version `cmriak0gt00y8s66lxrfkstp6`.
- Imported state: lifecycle `validated`, validation `valid`, 6 artifacts, 1,493 compiled rules, 0 validation issues.

## Explicit activation and verification

- Persisted `TOPICAL_MAP_STRATEGY_ROOT=/opt/autopilot-strategy/topical-map-f2a39fabd27a1dcb`.
- Persisted `TOPICAL_MAP_ACTIVATION_ENABLED=true`.
- Persisted and verified `EXECUTE_APPROVED_LIVE_ENABLED=false`.
- PM2 was deleted/recreated and saved to eliminate inherited overrides; health returned `ok` after restart.
- Authenticated `SETTINGS_ADMIN` activation returned HTTP 200 once, with reason: `Operator-authorized production activation of reviewed topical-map revision 3; strategy selection only, Shopify/Meta live execution remains disabled.`
- Sole active pointer count: 1, referencing version `cmriak0gt00y8s66lxrfkstp6` and package `f2a39f...bf1c`.
- Target lifecycle: `active`; validation remains `valid`; counts remain 6 artifacts, 1,493 rules, 0 issues.
- Activation audit count: 1; actor `api-key`; action `topical_map_strategy_activated`; reason persisted.
- `loadActiveStrategyPolicy` loaded the active production projection with the same package identity and 1,493 rules.
- Recommendations executed since the pre-rollout backup: 0.
- PM2: online; public health: `ok`; `EXECUTE_APPROVED_LIVE_ENABLED=false`.

## GROW

- Ground: production strategy selection now resolves the reviewed revision-3 package through the sole active pointer.
- Record: updated `.mex/ROUTER.md` and `.mex/events/decisions.jsonl` with verified activation evidence.
- Orient: existing topical-map strategy-package and activation runbooks covered the recurring workflow; no new runbook was needed.
- Write: recorded the activation decision with `mex log`; the final release-record commit is deployed and verified below.

## Concerns

- The production reader requires the fixed basename `strategy-package-manifest.json`; dated source manifests must be installed under that canonical runtime name without changing bytes.
- The first localhost health probe after each deliberate PM2 recreation can briefly receive connection refused before the retry succeeds; final local and public health checks were green.
