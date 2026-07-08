# Task 5 Report: Policy lock-in test + final sweep (Phase 9)

Note: this file previously contained a Phase 8c report (ROUTER.md/final-gate/push for the SEO-Pillar split).
It has been fully overwritten with this Phase 9 Task 5 report below.

## What I implemented

Created `__tests__/a11y/no-raw-hex.test.ts` using the brief's exact test logic/assertions. One necessary
adaptation: this repo's test runner is **Vitest**, not Jest (`npm test` runs `vitest run`, confirmed via
`vitest.config.ts` — no `globals: true` set). Since globals aren't enabled, `describe`/`it`/`expect` are not
ambient — I added `import { describe, expect, it } from "vitest";` as the first line. This is purely a
runtime-binding fix; the `ROOT`, `ALLOWLIST`, `HEX`, `walk()`, and the test body/assertion (`expect(offenders).toEqual([])`)
are verbatim from the brief. The relative path `ROOT = "app/(embedded)"` resolved correctly because Vitest's
cwd is the repo root when run via `npm test`.

## Step 2: new test alone

```
npm test -- __tests__/a11y/no-raw-hex.test.ts
```
Result: **PASS** (1 test file, 1 test passed). No offenders found — Tasks 1–3 fully tokenized/allowlisted as expected.

## Step 3: final acceptance sweeps

**Sweep 1 — raw hex in tsx:**
```
rtk grep -rn --include="*.tsx" -E "#[0-9a-fA-F]{6}" "app/(embedded)"
```
Output: 4 matches, all in `app/(embedded)/(market-intelligence)/market-intelligence/components.tsx` lines
74/76/78/79 (the `BRAND_HERO` gradient/gold/accentGreen/textPrimary constants).
**Annotated expectation:** "only market-intelligence/components.tsx BRAND_HERO" — **MATCH, as expected.**

**Sweep 2 — stray emoji glyphs:**
```
rtk grep -rn --include="*.tsx" -E "✓|✗|💰|⚠|✅|❌|🚀|📈|📉|⏳|🔥" "app/(embedded)"
```
Output: no matches.
**Annotated expectation:** "no matches" — **MATCH, as expected.**

**Sweep 3 — clickable non-buttons:**
```
grep -rn --include="*.tsx" -B2 "onClick" "app/(embedded)" | grep -E "<(div|span|td|tr|li)[ >]"
```
Output: 6 lines, e.g.:
```
app/(embedded)/(content-pilot)/content-pilot/components/queue/QueueFilters.tsx-64-        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OpportunitiesPanel.tsx-32-          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
app/(embedded)/(seo-pillar)/seo-pillar/components/panels/KeywordsPanel.tsx-35-        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
app/(embedded)/(ad-pilot)/ad-approvals/page.tsx-213-              <div style={{ marginBottom: 16 }}>
app/(embedded)/(store-pilot)/images/page.tsx-269-                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
app/(embedded)/(ad-pilot)/recommendations/page.tsx-215-            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
```
**Investigated each:** all six are `-B2` context lines picked up because the "onClick" match 1–2 lines below
is actually the substring `onClick` inside Polaris `TextField`'s `onClearButtonClick` prop, on a plain
`<TextField clearButton onClearButtonClick={...} />` — not a real click handler on the `<div>` itself. The
`<div>` in each case is a plain flex-wrapper with no `onClick`/`onClearButtonClick`/role of its own. So there
are **zero real clickable non-button elements**; these 6 lines are grep false-positives from substring
matching + context-window overlap, exactly the kind of noise the brief's "no clickable non-buttons" annotation
anticipates.
**Verdict: MATCH, as expected (no genuine violations).**

## Step 4: browser a11y walk

Started `npm run dev` in background. Server came up (`[server] Ready on http://localhost:3000`), but Prisma
immediately failed on a background stale-state sweep (`Can't reach database server at 172.105.161.83:5432` —
consistent with the known "no local dev DB" constraint noted in project memory). One minimal probe:
```
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
→ 307
curl -s http://localhost:3000/
→ /api/auth/shopify
```
Root path 307-redirects to Shopify OAuth (`/api/auth/shopify`), confirming the embedded app's auth gate fires
before any page content renders — there is no meaningful DOM to keyboard-walk/contrast-check outside the
Shopify admin iframe with a live session. Per the brief's hard-stop rule, I did not fight this further.

**Outcome: browser walk blocked by embedded auth; static checks passed.** Dev server was killed immediately
after the one attempt (`pkill -f "next dev"`), confirmed no residual dev processes via `ps aux`.

## Step 5: full gates

```
npx tsc --noEmit
→ TypeScript: No errors found

npm test
→ Test Files  122 passed (122)
→ Tests       742 passed (742)

npm run build
→ build completed successfully, all routes emitted (static + dynamic), no errors
```
**742/742 as expected (741 baseline + 1 new policy test). Build clean.**

## Step 6: commit

```
git add __tests__/a11y/no-raw-hex.test.ts
git commit -m "test(a11y): enforce no-raw-hex policy in app/(embedded) with documented brand-hero allowlist

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Result: commit `65e3a0d`, 1 file changed, 38 insertions. No other files staged/touched. No push performed.

## Self-review

- Test file is otherwise byte-for-byte the brief's code; only addition is the Vitest import needed because
  this repo doesn't run Jest and doesn't enable Vitest globals. No assertions, allowlist, or regex were altered.
- Verified the allowlist path format (`app/(embedded)/(market-intelligence)/market-intelligence/components.tsx`)
  matches the actual on-disk path (confirmed via sweep 1 hits).
- No token swap was needed — Tasks 1–4's work left zero offenders, so the "never widen the allowlist" fallback
  path was not exercised.
- Sweep 3's 6 hits were manually inspected line-by-line rather than assumed benign; all confirmed false
  positives from grep's `-B2` context window plus `onClick`/`onClearButtonClick` substring overlap.
- No deploy, no push — commit only, per instructions.
- Concern: none blocking. The only deviation from the brief (vitest import) is a mechanical necessity, not a
  policy or assertion change, and was verified by running the test both in isolation and as part of the full
  742-test suite.

---

## 2026-07-09 Task 5: Organic skill source contracts

### What I implemented

- Added explicit organic source contracts to `skills-source/35-google-e2e-seo-assistant.md`.
- Mirrored the same frontmatter contract into the duplicate file `skills-source/seo-pillar/35-google-e2e-seo-assistant.md`.
- Migrated `skills-source/46-google-keyword-gap-analysis.md` from `platform: Google` to `platform: seo` and added the keyword-gap source contract.
- Left ad-adjacent mixed-platform skills such as `10` and `45`, plus Meta competitor skill `13`, unchanged because they are still paid-account prompts rather than organic-only skills.

### Command output: candidate scan

```text
$ rg -n "platform:.*(seo|google)|extraSources|keyword_research|gsc|ga4|market_intel" skills-source
skills-source/45-google-and-meta-paid-organic-overlap.md:7:  extraSources: [gsc, ga4]
skills-source/46-google-keyword-gap-analysis.md:7:  extraSources: [keyword_research, gsc]
skills-source/13-meta-competitor-creative-analysis.md:7:  extraSources: [market_intel]
skills-source/35-google-e2e-seo-assistant.md:5:  platform: seo
skills-source/10-google-and-meta-landing-page-audit.md:6:  extraSources: [ga4]
```

### Command output: loader verification

```text
$ npm test -- loader

> agriko-autopilot@0.1.0 test
> vitest run loader


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  04:30:35
   Duration  693ms (transform 159ms, setup 0ms, import 133ms, tests 193ms, environment 0ms)
```

### Command output: run-skills verification

```text
$ npm test -- run-skills

> agriko-autopilot@0.1.0 test
> vitest run run-skills


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot

 Test Files  5 passed (5)
      Tests  32 passed (32)
   Start at  04:30:41
   Duration  1.43s (transform 1.15s, setup 0ms, import 1.64s, tests 249ms, environment 1ms)
```
