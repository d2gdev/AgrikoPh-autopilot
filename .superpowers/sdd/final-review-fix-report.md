# Final Review Fix Report

Date: 2026-07-09

Notes:
- Fixed final-review finding 1 by making `lib/skills/runner.ts` serialize the stable deduped effective source union from `requiredSources`, `optionalSources`, and `extraSources`, and by making `jobs/run-skills.ts` hash against that same effective-source list.
- Fixed final-review finding 2 by lifting `organicPriority` from routed opportunity evidence to top-level `ContentProposal.sourceData` in `lib/opportunities/route.ts` while preserving the original nested `evidence` payload.
- Added regressions in `__tests__/lib/skills/runner.test.ts`, `__tests__/jobs/run-skills-hash.test.ts`, and `__tests__/lib/opportunities/route.test.ts`.

Exact command outputs:

```text
$ npm test -- skills

> agriko-autopilot@0.1.0 test
> vitest run skills


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot

 Test Files  11 passed (11)
      Tests  89 passed (89)
   Start at  05:33:27
   Duration  5.67s (transform 3.09s, setup 0ms, import 5.18s, tests 1.78s, environment 23ms)
```

```text
$ npm test -- run-skills

> agriko-autopilot@0.1.0 test
> vitest run run-skills


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot


 Test Files  5 passed (5)
      Tests  33 passed (33)
   Start at  05:33:28
   Duration  4.08s (transform 2.30s, setup 0ms, import 4.14s, tests 692ms, environment 1ms)
```

```text
$ npm test -- opportunities

> agriko-autopilot@0.1.0 test
> vitest run opportunities


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot


 Test Files  4 passed (4)
      Tests  35 passed (35)
   Start at  05:33:28
   Duration  3.06s (transform 1.78s, setup 0ms, import 2.85s, tests 327ms, environment 1ms)
```

```text
$ npm test -- growth-brief

> agriko-autopilot@0.1.0 test
> vitest run growth-brief


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot


 Test Files  2 passed (2)
      Tests  8 passed (8)
   Start at  05:33:28
   Duration  3.43s (transform 1.27s, setup 0ms, import 1.33s, tests 1.51s, environment 0ms)
```

```text
$ npx tsc --noEmit

[no output]
```
