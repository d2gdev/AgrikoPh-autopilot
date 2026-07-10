# Task 7 report

Implemented null-safe tracked-keyword uniqueness. The POST route now creates first and recovers concurrent Prisma `P2002` conflicts by locating the normalized case-insensitive English/null-location row and reactivating it; non-unique errors are rethrown. Prisma schema no longer declares the nullable compound unique and documents the migration-owned expression index. Migration source reassigns all four child-table foreign keys to oldest survivors, deletes duplicates, drops the old index, and creates a normalized expression unique index.

Verification:

- `npm test -- --run __tests__/api/seo-pilot-routes.test.ts __tests__/prisma/market-keyword-null-safe-migration.test.ts` — 2 files, 23 tests passed.
- `npx tsc --noEmit` — passed.

No production migration was applied and no live actions were executed.
