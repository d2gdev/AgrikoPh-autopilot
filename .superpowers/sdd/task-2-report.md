# Task 2 Report: Authenticated topical-map command center API

## Outcome

Implemented `GET /api/topical-map/command-center` as an authenticated, dynamic, private/no-store embedded API route. It resolves the active `agrikoph.com` strategy through the authoritative `TopicalMapActivation` relation, projects the reviewed command-center model, returns an explicit no-active state, and maps failures to a bounded JSON 500 response.

## Red evidence

Command:

`npm test -- __tests__/api/topical-map-command-center-route.test.ts`

Result: expected failure, 1 failed file / 4 failed tests. Every test failed because `@/app/api/topical-map/command-center/route` did not exist.

## Green evidence

Command:

`npm test -- __tests__/api/topical-map-command-center-route.test.ts __tests__/lib/topical-map/command-center.test.ts __tests__/api/topical-map-routes.test.ts`

Result: 3 passed files / 24 passed tests.

Additional verification:

- `npm run typecheck` — passed.
- `npx eslint app/api/topical-map/command-center/route.ts __tests__/api/topical-map-command-center-route.test.ts` — passed.
- `git diff --check` — passed.

## Files

- `app/api/topical-map/command-center/route.ts`
- `__tests__/api/topical-map-command-center-route.test.ts`

## Behavioral coverage

- `await requireAppAuth(req)` is the first handler operation.
- Unauthenticated requests stop before Prisma.
- No active pointer returns `state: "no_active_strategy"` and `commandCenter: null`.
- Database/projection failures return only `{ state: "unavailable", error: "Command center is unavailable." }` with status 500.
- Ready responses contain all eleven domain counts and the projected identity.
- All route-owned responses use `Cache-Control: private, no-store`.
- The single Prisma query selects only active strategy identity plus compiled-rule projection storage; it does not select artifacts or raw source bytes.

## Self-review

- Confirmed the route exports only supported Next.js route/config symbols.
- Confirmed database access uses the shared `@/lib/db` client.
- Confirmed no mutation, activation, Shopify/Meta write, permission expansion, or raw artifact projection was introduced.
- Confirmed nullable persisted contract revisions fail closed rather than being silently projected.

## Concerns / brief deviation

The task brief's illustrative query used `topicalMapStrategyVersion.findFirst({ where: { active: true } })` and direct rule fields `payload`/`sourceReferences`. Those fields do not exist in the checked-in Prisma schema. The implementation instead uses the database-level active pointer (`topicalMapActivation.findUnique({ where: { siteHost: "agrikoph.com" } })`) and maps the persisted `compiledPayload` envelope into the already-reviewed projector input. This is the schema-correct single-query equivalent and matches the brief's stated "Prisma active-version relations" interface.

## Commit

`22c76409244f5fdaff7deca2b2b666884a1fdea0` (`feat(api): expose active topical map command center`)

## Important review finding follow-up

The active-pointer projection now selects `lifecycle` and `validationStatus` and fails closed with the existing bounded unavailable response unless the pointed strategy is both `active` and `valid`. Focused tests cover a superseded lifecycle and an invalid validation status; neither can produce a ready projection. The response-boundary test was renamed to state precisely that the exact Prisma select omits artifacts and that extra mock fields are not serialized into the API response.

### Follow-up RED evidence

Command:

`npm test -- __tests__/api/topical-map-command-center-route.test.ts`

Exact result summary:

```text
Test Files  1 failed (1)
Tests  3 failed | 3 passed (6)
```

The two new fail-closed cases received 200 instead of the expected 500, and the exact-select assertion showed `lifecycle` and `validationStatus` were absent.

### Follow-up GREEN and verification evidence

Command:

`npm test -- __tests__/api/topical-map-command-center-route.test.ts __tests__/lib/topical-map/command-center.test.ts __tests__/api/topical-map-routes.test.ts && npm run typecheck && npx eslint app/api/topical-map/command-center/route.ts __tests__/api/topical-map-command-center-route.test.ts && git diff --check`

Exact test/typecheck output summary:

```text
Test Files  3 passed (3)
Tests  26 passed (26)

> agriko-autopilot@0.1.0 typecheck
> tsc --noEmit
```

The combined command exited 0. Targeted ESLint and `git diff --check` emitted no diagnostics.
