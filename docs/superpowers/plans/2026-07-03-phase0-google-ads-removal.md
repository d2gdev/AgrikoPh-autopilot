# Phase 0 — Google Ads Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every Google Ads *advertising* code path — ad execution, campaign management, and ads-only skill prompts — per the user's directive that Agriko will never use Google Ads **for advertising**. The Google Ads **Keyword Planner keyword-research integration is explicitly kept**: it is the tool Agriko uses to conduct keyword research (volume, competition, and bid-range data feeding Market Intelligence) and is out of scope for removal.

> **Scope correction (2026-07-03):** an earlier draft of this plan read the directive as "no Google Ads in any form" and removed the Keyword Planner integration too. That removal was executed and then reverted (`86853e6`); the user clarified the ban covers **advertising only, never keyword research**. This document now reflects the corrected scope — nothing below removes or retargets keyword research. Do not re-apply the reverted DataForSEO retarget.

**Architecture:** Discovery during fact-finding: (1) ad-execution support for `google_ads` was already fully inert (`SUPPORTED_ACTIONS.google_ads = []`) — pure dead-code deletion. (2) Google Ads Keyword Planner credentials are **actively configured** in `.env` and a daily cron (`fetch-keyword-research`, 05:45) calls Google's API to populate `KeywordResearchResult` rows that feed real bid/competition/volume columns on the Market Intelligence page — this is a live, working data source and **must be kept untouched**. (3) The `skills-source/` library contains 6 skill prompts that are genuinely and permanently about running Google Ads campaigns (search-term reports, bid strategy, Quality Score, ad extensions, keyword cannibalization, full account audit) and 3 more that are organic-SEO content mislabeled with `platform: Google` metadata (a pre-existing bug, unrelated to Ads, that this audit surfaced).

**Scope decision (per user clarification: "never Google Ads" = advertising only, not keyword research):**
- **Keep** `lib/connectors/google-ads.ts` on disk. Its keyword-research exports (`fetchGoogleAdsKeywordResearch`, `fetchGoogleAdsKeywordIdeas`) stay live; the ad-execution/campaign-snapshot exports become unused after this phase and are left in place (harmless, nothing calls them) rather than splitting the file.
- **Keep untouched:** `jobs/fetch-keyword-research.ts` + its test, the 05:45 cron, the `google_ads_keyword_research` connector-health entry, `scripts/google-ads-oauth.mjs`, the `GOOGLE_ADS_*` env vars (actively read), and the `KeywordResearchResult.source` default of `"google_ads"` — no schema migration in this phase.
- Delete the 6 permanently-inert pure-Google-Ads skill files; relabel the mislabeled organic-SEO skill files to `platform: SEO`. Skill 46 (keyword-gap-analysis) keeps its original content — it consumes Keyword Planner data, which remains available.
- Remove `google_ads` from every ad-execution/dispatch/platform-filter surface: executor, guardrail-inputs, execute-approved, check-outcomes, fetch-ads-data, run-skills, recommendations UI/API.

**Tech Stack:** Next.js 14 App Router API routes, Prisma/PostgreSQL, Vitest.

## Global Constraints

- No Google Ads **ad-execution** code may remain reachable after this phase. Keyword-research code is expected to remain: `lib/connectors/google-ads.ts`, `jobs/fetch-keyword-research.ts` + test, and the `google_ads_keyword_research` connector-health entry are the only legitimate `google_ads`/`google-ads` hits in `app lib jobs __tests__` after this phase.
- `pause_ad` must never enter `CONVERSION_SENSITIVE_ACTIONS` in `lib/guardrails.ts` (unaffected by this phase — confirmed `lib/guardrails.ts` has zero Google references today).
- Every deleted/changed file gets its test suite updated in the same task, not deferred.
- `npx tsc --noEmit` clean, `npm test` green, `npm run build` clean at the end.
- No Prisma migration in this phase — `KeywordResearchResult.source` keeps its `"google_ads"` default because the Keyword Planner source is kept.
- `GOOGLE_ADS_*` env vars stay in prod's `.env` — they are **actively read** by the kept Keyword Planner integration. Do not remove them.

---

### Task 1: Executor + guardrail-inputs — strip google_ads ad-execution support

**Files:**
- Modify: `lib/executor.ts`, `lib/recommendations/guardrail-inputs.ts`
- Test: `__tests__/lib/executor.test.ts`

**Interfaces:**
- Produces: `isSupportedAction(platform, actionType)` — `"google_ads"` is no longer a recognized platform key at all (was already `[]`, now absent — same runtime effect, cleaner surface). `executeRecommendation(rec)` throws `Unknown platform: google_ads` if ever called with that platform (should never happen post-Phase-0, since nothing creates such recs — see Task 5).

- [ ] **Step 1: Read the current executor test to see what must change**

Run: `grep -n "google" __tests__/lib/executor.test.ts`
Expected output includes lines mocking `executeGoogleAdsAction`/`fetchGoogleAdsData` and a test `"routes google_ads platform to executeGoogleAdsAction"`.

- [ ] **Step 2: Update the test — remove the google-ads mock and the routing test, keep meta + unknown-platform coverage**

Replace the top of `__tests__/lib/executor.test.ts` (the `vi.mock("@/lib/connectors/google-ads", ...)` block and any `mockExecuteGoogleAdsAction` references) so the file only mocks `@/lib/connectors/meta`. Remove the `it("routes google_ads platform to executeGoogleAdsAction", ...)` test entirely. Add a replacement test:

```typescript
it("throws on an unrecognized platform", async () => {
  const rec = { ...baseRec, platform: "google_ads" as const };
  await expect(executeRecommendation(rec)).rejects.toThrow("Unknown platform: google_ads");
});
```

(Keep whatever `baseRec` fixture already exists in the file — just reuse it with `platform: "google_ads"` to prove the platform is now fully unrecognized rather than routed anywhere.)

- [ ] **Step 3: Run the test to verify it fails (executor.ts still routes google_ads)**

Run: `npx vitest run __tests__/lib/executor.test.ts`
Expected: FAIL — `executeRecommendation` still routes `google_ads` to the (kept) connector's ad-execution export instead of throwing, so the new unknown-platform assertion mismatches. If the run passes unexpectedly, proceed to Step 4 regardless (the real fix lands there).

- [ ] **Step 4: Rewrite `lib/executor.ts`**

```typescript
import type { Recommendation } from "@prisma/client";

const SUPPORTED_ACTIONS: Record<string, readonly string[]> = {
  meta: ["pause_campaign", "pause_ad", "adjust_budget"],
};

export function isSupportedAction(platform: string, actionType: string): boolean {
  const supported = SUPPORTED_ACTIONS[platform];
  return supported !== undefined && supported.includes(actionType);
}

export async function executeRecommendation(rec: Recommendation): Promise<Record<string, unknown>> {
  if (rec.platform === "meta") {
    const { executeMetaAction } = await import("@/lib/connectors/meta");
    return executeMetaAction(rec);
  }

  throw new Error(`Unknown platform: ${rec.platform}`);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/executor.test.ts`
Expected: PASS (all tests including the new unknown-platform test).

- [ ] **Step 6: Simplify `lib/recommendations/guardrail-inputs.ts`**

Remove the `if (rec.platform === "google_ads") { ... }` branch (lines ~13–20) entirely, leaving only the Meta-shaped logic that already exists below it as the sole path:

```typescript
import { prisma } from "@/lib/db";

type GuardrailRecommendation = {
  platform: string;
  targetEntityId: string;
  snapshotId: string;
};

export function deriveGuardrailInputsFromPayload(
  rec: Pick<GuardrailRecommendation, "platform" | "targetEntityId">,
  payload: Record<string, unknown>
): { conversionCount: number | null; dailyBudgetPhp: number } {
  let dailyBudgetPhp = 0;
  const campaigns = (payload.campaigns as Array<Record<string, unknown>>) ?? [];
  const adSets = (payload.adSets as Array<Record<string, unknown>>) ?? [];
  const entity = [...campaigns, ...adSets].find((e) => e.id === rec.targetEntityId);
  if (entity?.daily_budget) {
    dailyBudgetPhp = parseFloat(String(entity.daily_budget)) / 100;
  }

  let conversionCount = 0;
  // (leave the remainder of the function body exactly as it was below this point —
  // it is unchanged Meta-only logic that the google_ads branch used to short-circuit past)
  return { conversionCount, dailyBudgetPhp };
}
```

**Do not guess the omitted middle** — open the file, delete only the `if (rec.platform === "google_ads") { ...; return {...}; }` block (the four lines shown in the fact-finding excerpt), and leave every line after it untouched. The `rec.platform` parameter stays in the type signature (still passed by callers) even though it's no longer branched on — do not remove it from `GuardrailRecommendation` or the function signature.

- [ ] **Step 7: Leave the `google_ads_keyword_research` connector-health entry in place**

The entry in `lib/config/connector-health.ts` (`label: "Keyword Planner Research"`, `jobName: "fetch-keyword-research"`) monitors the **kept** Keyword Planner cron — do not touch it or its tests. No changes to `lib/config/connector-health.ts` in this phase.

- [ ] **Step 8: Run the affected test set**

Run: `npx vitest run __tests__/lib/executor.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/executor.ts lib/recommendations/guardrail-inputs.ts __tests__/lib/executor.test.ts
git commit -m "refactor(google-ads): strip inert google_ads execution/guardrail support"
```

---

### Task 2: execute-approved.ts — remove the google before-state branch

**Files:**
- Modify: `jobs/execute-approved.ts`
- Test: `__tests__/jobs/execute-approved.test.ts`

**Interfaces:**
- Consumes: nothing new. Produces: no behavior change for `meta`-platform recs; a `google_ads`-platform rec (which can no longer be created — Task 5) falls through the before-state `if/else if` doing nothing, same as any other unrecognized platform today.

- [ ] **Step 1: Update the test first**

Run: `grep -n "google\|Google" __tests__/jobs/execute-approved.test.ts` to locate the mock (`executeGoogleAdsAction`, `fetchGoogleAdsBeforeState`) and the `describe("Google Ads guardrail input derivation", ...)` block (~line 256).

Delete the `executeGoogleAdsAction: vi.fn()` and `fetchGoogleAdsBeforeState: vi.fn().mockResolvedValue({})` lines from the `vi.mock("@/lib/connectors/google-ads", ...)` call — and delete the whole `vi.mock` call if those were its only two members. Delete the entire `describe("Google Ads guardrail input derivation", ...)` block (the test at ~line 257 asserting spend-field budget derivation for `platform: "google_ads"`) — that behavior no longer exists per Task 1 Step 6.

- [ ] **Step 2: Run to verify the suite still parses and the deleted test is gone**

Run: `npx vitest run __tests__/jobs/execute-approved.test.ts`
Expected: some failures still, since `jobs/execute-approved.ts` itself hasn't changed yet (fine — proceed).

- [ ] **Step 3: Remove the google branch in `jobs/execute-approved.ts`**

Find (around line 285):

```typescript
        if (rec.platform === "meta") {
          const { fetchMetaEntityState } = await import("@/lib/connectors/meta");
          beforeState = await fetchMetaEntityState(rec.targetEntityId);
        } else if (rec.platform === "google_ads") {
          const { fetchGoogleAdsBeforeState } = await import("@/lib/connectors/google-ads");
          beforeState = await fetchGoogleAdsBeforeState(rec);
        }
```

Replace with:

```typescript
        if (rec.platform === "meta") {
          const { fetchMetaEntityState } = await import("@/lib/connectors/meta");
          beforeState = await fetchMetaEntityState(rec.targetEntityId);
        }
```

- [ ] **Step 4: Run the full test file**

Run: `npx vitest run __tests__/jobs/execute-approved.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add jobs/execute-approved.ts __tests__/jobs/execute-approved.test.ts
git commit -m "refactor(google-ads): remove google before-state branch from execute-approved"
```

---

### Task 3: check-outcomes.ts + outcome-metrics.ts — drop the google snapshot source

**Files:**
- Modify: `jobs/check-outcomes.ts`, `lib/recommendations/outcome-metrics.ts` (comments only)
- Test: `__tests__/lib/recommendations/outcome-metrics.test.ts`, `__tests__/jobs/check-outcomes.test.ts` (if it references `platformSources` behavior for `"both"`)

- [ ] **Step 1: Check for a check-outcomes test asserting `platformSources`/"both" behavior**

Run: `grep -n "platformSources\|both.*google\|google.*both" __tests__/jobs/check-outcomes.test.ts`

If any test seeds a `"both"`-platform recommendation expecting a `google_ads` snapshot lookup, update it to expect only `["meta"]` sources (see Step 2). If none exists, skip to Step 2.

- [ ] **Step 2: Simplify `platformSources` in `jobs/check-outcomes.ts`**

Replace:

```typescript
function platformSources(platform: string): string[] {
  return platform === "both" ? ["meta", "google_ads"] : [platform];
}
```

with:

```typescript
function platformSources(platform: string): string[] {
  return platform === "both" ? ["meta"] : [platform];
}
```

Update the comment immediately above it (currently `// "both" recs (rare) may have landed against either connector's snapshot.`) to: `// "both" recs (rare) resolve to Meta — Google Ads is not a supported platform.`

- [ ] **Step 3: Update stale comments in `lib/recommendations/outcome-metrics.ts`**

Two comment-only references (no logic): the line mentioning `google_ads payloads embed metrics directly on the entity objects instead` (~line 44) and the docstring bullet `- google_ads: metrics live directly on the campaign/adGroup/keyword object` (~line 128). Delete both — they describe a payload shape that no longer exists in this system. Do not touch any code, only comment text; if a comment is part of a larger explanatory block, remove just the google_ads-specific sentence/bullet and leave the rest describing Meta's shape intact.

- [ ] **Step 4: Update `__tests__/lib/recommendations/outcome-metrics.test.ts`**

Run: `grep -n "google_ads" __tests__/lib/recommendations/outcome-metrics.test.ts` — locate `it("reads metrics directly off a google_ads campaign entity", ...)`. Since the underlying entity-finder logic (`findEntityMetrics`) is generic (keyed by entity shape, not literally by platform string — confirmed in fact-finding, no `if (platform === "google_ads")` branch exists in this file), rename the test to describe what it actually verifies without implying a still-supported platform:

Change the test name to `it("reads metrics directly off a campaign entity with inline fields (no nested insights)", ...)` and leave its body/fixture data unchanged (it's testing the "metrics live on the entity itself" shape, which is a real, still-relevant code path — just not one exclusive to a platform we no longer support).

- [ ] **Step 5: Run affected tests**

Run: `npx vitest run __tests__/lib/recommendations/outcome-metrics.test.ts __tests__/jobs/check-outcomes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add jobs/check-outcomes.ts lib/recommendations/outcome-metrics.ts __tests__/lib/recommendations/outcome-metrics.test.ts
git commit -m "refactor(google-ads): drop google snapshot source from outcome checking"
```

---

### Task 4: fetch-ads-data.ts — remove the google campaign-snapshot step

**Files:**
- Modify: `jobs/fetch-ads-data.ts`
- Test: `__tests__/jobs/fetch-ads-data.test.ts` (check for existence and google references first)

- [ ] **Step 1: Check for an existing test file and its google coverage**

Run: `ls __tests__/jobs/ | grep fetch-ads-data` then, if it exists, `grep -n "google\|Google" __tests__/jobs/fetch-ads-data.test.ts`. Update or remove any test asserting `googleAdsCampaignSnapshots: "enabled"` behavior or a `google_ads` RawSnapshot write — mirror the pattern of prior test edits in this plan (delete the specific assertion, keep Meta-path coverage).

- [ ] **Step 2: Rewrite `jobs/fetch-ads-data.ts`**

```typescript
import { prisma } from "@/lib/db";
import type { JobResult, JobStatus } from "@/lib/jobs/types";

type FetchAdsSummary = {
  snapshotsFetched: number;
  truncationWarnings: string[];
};

export async function fetchAdsDataHandler(): Promise<JobResult<FetchAdsSummary>> {
  const runId = (
    await prisma.jobRun.create({ data: { jobName: "fetch-ads-data" } })
  ).id;

  const errors: string[] = [];
  let snapshotsFetched = 0;
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Meta
  let metaTruncationWarnings: string[] | undefined;
  try {
    const { fetchMetaData } = await import("@/lib/connectors/meta");
    const metaData = await fetchMetaData({ start, end });
    metaTruncationWarnings = (metaData as Record<string, unknown>).truncationWarnings as string[] | undefined;
    if (metaTruncationWarnings?.length) {
      console.warn("[fetch-ads-data] Meta truncation:", metaTruncationWarnings.join("; "));
    }
    await prisma.rawSnapshot.create({
      data: { source: "meta", dateRangeStart: start, dateRangeEnd: end, payload: metaData as object, jobRunId: runId },
    });
    snapshotsFetched++;
  } catch (err) {
    errors.push(`meta: ${String(err)}`);
  }

  const status: JobStatus = errors.length === 0 ? "success" : snapshotsFetched > 0 ? "partial" : "failed";
  const summary: FetchAdsSummary = {
    snapshotsFetched,
    truncationWarnings: metaTruncationWarnings ?? [],
  };

  await prisma.jobRun.update({
    where: { id: runId },
    data: {
      status,
      completedAt: new Date(),
      summary: JSON.parse(JSON.stringify(summary)),
      errorLog: errors.length > 0 ? errors.join("\n") : null,
    },
  });

  return { status, runId, summary };
}
```

(This assumes the trailing `prisma.jobRun.update(...)` block after the section shown in fact-finding is exactly this shape — **before writing this step for real, open the file and copy the actual trailing block verbatim** rather than trusting this reconstruction; the `data:` fields must match whatever the original function already returns, since `JobResult<T>` and the update call are unrelated to the Google removal and must not change shape.)

- [ ] **Step 3: Run the test**

Run: `npx vitest run __tests__/jobs/fetch-ads-data.test.ts` (if the file doesn't exist, run `npx tsc --noEmit` instead to confirm no type breakage, and note in the commit message that this job has no dedicated test file).
Expected: PASS / clean.

- [ ] **Step 4: Commit**

```bash
git add jobs/fetch-ads-data.ts
git commit -m "refactor(google-ads): remove google campaign-snapshot step from fetch-ads-data"
```

(add the test file to the `git add` list if one was modified)

---

### Task 5: run-skills.ts — remove google_ads from dispatch

**Files:**
- Modify: `jobs/run-skills.ts`
- Test: `__tests__/jobs/run-skills.filtering.test.ts`, `__tests__/jobs/run-skills.rotation.test.ts`, `__tests__/jobs/run-skills.test.ts`

**Interfaces:**
- Produces: `DISPATCHABLE_PLATFORMS` no longer includes `"google_ads"`. A skill whose `platform` is `"google_ads"` is filtered out identically to a `"linkedin"`/`"reddit"` skill today (parsed, never dispatched).

- [ ] **Step 1: Update the three test files' shared fixtures**

Each of `run-skills.filtering.test.ts`, `run-skills.rotation.test.ts`, `run-skills.test.ts` defines a local `googleSnapshot` fixture and a `makeSkill(id, platform: "meta" | "google_ads" | "both" | "linkedin" | "reddit" = "meta")` helper (confirmed identical across all three in fact-finding). In each file:
  - Remove the `googleSnapshot` constant (unused once no test feeds it to a dispatch scenario expecting a google skill to run).
  - Narrow the `makeSkill` platform parameter type to `"meta" | "both" | "linkedin" | "reddit"`.
  - In `run-skills.filtering.test.ts`, find `it("all google_ads recs are unsupported (SUPPORTED_ACTIONS.google_ads = [])", ...)` (~line 148) and replace it with a test asserting google_ads is now an *unrecognized* platform, not merely an empty-action one:

```typescript
it("google_ads is not a dispatchable platform", async () => {
  const skill = makeSkill("google-skill", "both"); // "both" still resolves to Meta only now
  // ... (keep the surrounding setup from the original test; assert the skill only
  // ever sees the meta snapshot, never a google one, since none is ever fetched)
});
```

Adjust this to fit whatever assertion style the original test used (it likely called the handler and checked `Recommendation.platform` on created rows, or checked which snapshot a skill's payload came from) — **read the full original test body before rewriting**, since this excerpt only shows the `it(...)` title line, not its body.

- [ ] **Step 2: Run the three test files to confirm they still parse (expected failures against unchanged run-skills.ts)**

Run: `npx vitest run __tests__/jobs/run-skills.filtering.test.ts __tests__/jobs/run-skills.rotation.test.ts __tests__/jobs/run-skills.test.ts`
Expected: some failures (production code not yet updated) — confirms the tests correctly reference the new expectations.

- [ ] **Step 3: Update `jobs/run-skills.ts`**

Change:

```typescript
const DISPATCHABLE_PLATFORMS: SkillDefinition["platform"][] = ["meta", "google_ads", "both"];
```

to:

```typescript
const DISPATCHABLE_PLATFORMS: SkillDefinition["platform"][] = ["meta", "both"];
```

Remove the two branches that special-case `google_ads`:

```typescript
    if (s.platform === "meta") return !!metaSnap;
    if (s.platform === "google_ads") return !!googleSnap;
    if (s.platform === "both") return !!(metaSnap ?? googleSnap);
```

becomes:

```typescript
    if (s.platform === "meta") return !!metaSnap;
    if (s.platform === "both") return !!metaSnap;
```

and:

```typescript
    if (skill.platform === "meta") return metaSnap;
    if (skill.platform === "google_ads") return googleSnap;
```

becomes (check the full original conditional chain here — fact-finding only captured these two lines out of a larger function; **read the surrounding function body before editing** to see what the `"both"` case resolves to on this line and keep that branch, just removing the `google_ads` one):

```typescript
    if (skill.platform === "meta") return metaSnap;
```

Also remove the now-dead `googleSnap` query and its hash entry:

```typescript
    prisma.rawSnapshot.findFirst({ where: { source: "google_ads" }, orderBy: { fetchedAt: "desc" } }),
```
and
```typescript
  if (googleSnap) currentHashes.google_ads = hashPayload(googleSnap.payload);
```

Delete both — but first check every other use of the `googleSnap` variable in the file (fact-finding found references at lines 36, 65, 82, 86, 87, 113, 120, 173) via `grep -n "googleSnap" jobs/run-skills.ts` **before deleting the declaration**, and remove each reference in the same pass so nothing references an undefined variable. Line 173's `const platform = snapshot.source === "meta" ? "meta" : "google_ads";` becomes `const platform = "meta";` (since `snapshot.source` can now only ever be `"meta"` at this point in the function — confirm this by reading the surrounding context; if `snapshot` could still be something else, keep a narrower guard instead of hardcoding, e.g. `const platform = snapshot.source;` if `RawSnapshot.source` is typed as a literal union already covering only `"meta"` post-cleanup).

- [ ] **Step 4: Run the three test files again**

Run: `npx vitest run __tests__/jobs/run-skills.filtering.test.ts __tests__/jobs/run-skills.rotation.test.ts __tests__/jobs/run-skills.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add jobs/run-skills.ts __tests__/jobs/run-skills.filtering.test.ts __tests__/jobs/run-skills.rotation.test.ts __tests__/jobs/run-skills.test.ts
git commit -m "refactor(google-ads): remove google_ads from run-skills dispatch"
```

---

### Task 6: loader.ts — drop google_ads from the platform union

**Files:**
- Modify: `lib/skills/loader.ts`
- Test: `__tests__/lib/skills/loader.test.ts`

- [ ] **Step 1: Update the test**

Find `it("loads the keyword gap analysis skill (46) with 'google_ads' platform and keyword_research+gsc extraSources", ...)` (~line 125). Skill 46 (`keyword-gap-analysis`) keeps its `platform: Google` frontmatter (its content stands — it consumes kept Keyword Planner data), but with `google_ads` dropped from the platform union, `mapPlatform`'s Google fallback (Step 3 below) degrades it to `"seo"`. Update this test's expected platform to `"seo"` and rename the test to `it("loads the keyword gap analysis skill (46) with 'seo' platform and keyword_research+gsc extraSources", ...)`.

- [ ] **Step 2: Run to verify it fails against the still-unrelabeled skill file**

Run: `npx vitest run __tests__/lib/skills/loader.test.ts`
Expected: FAIL (the union still contains `google_ads` and `mapPlatform` still maps `Google` to it until Step 3 lands).

- [ ] **Step 3: Update `lib/skills/loader.ts`**

```typescript
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  platform: "meta" | "both" | "seo" | "linkedin" | "reddit";
  pilotGroup: string;
  enabled: boolean;
  fullPrompt: string;
  insightBlock?: string;
  extraSources?: ExtraSource[];
}
```

and:

```typescript
function mapPlatform(raw: string): SkillDefinition["platform"] {
  const lower = raw.toLowerCase();
  if (lower.includes("google") && lower.includes("meta")) return "both";
  if (lower.includes("meta")) return "meta";
  if (lower.includes("seo")) { console.warn(`[skills] Platform "seo" is not dispatched by run-skills`); return "seo"; }
  if (lower.includes("linkedin")) { console.warn(`[skills] Platform "linkedin" is not dispatched by run-skills`); return "linkedin"; }
  if (lower.includes("reddit")) { console.warn(`[skills] Platform "reddit" is not dispatched by run-skills`); return "reddit"; }
  if (lower.includes("google")) { console.warn(`[skills] Platform "Google" (Ads) is no longer a supported platform — treating as "seo"; relabel this skill's frontmatter`); return "seo"; }
  return "both";
}
```

(The last `if (lower.includes("google"))` branch is a safety net for any skill file this plan's Task 9 misses — it logs a warning instead of silently mapping to a dead platform, and degrades to `"seo"` — parsed but never dispatched by run-skills, same as before, but at least visible in logs.)

- [ ] **Step 4: Run the test again**

Run: `npx vitest run __tests__/lib/skills/loader.test.ts`
Expected: PASS — skill 46's `platform: Google` frontmatter now degrades to `"seo"` via the fallback branch, matching Step 1's updated expectation.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/loader.ts __tests__/lib/skills/loader.test.ts
git commit -m "refactor(google-ads): drop google_ads from skill platform union, degrade unknown Google labels to seo"
```


---

### Task 7: Keyword research — KEPT, no changes

Per the scope clarification, the Keyword Planner keyword-research integration is untouched:

- `jobs/fetch-keyword-research.ts` continues to call `fetchGoogleAdsKeywordResearch` / `fetchGoogleAdsKeywordIdeas` from `@/lib/connectors/google-ads` on the daily 05:45 cron.
- `KeywordResearchResult` rows keep `source: "google_ads"` / `"google_ads_ideas"`, with competition, competition-index, bid-range fields, and long-tail keyword-idea discovery all still populated — these feed the Market Intelligence bid/competition/volume columns.
- `__tests__/jobs/fetch-keyword-research.test.ts` is unchanged.

(An earlier draft of this task retargeted the job to DataForSEO volume-only, dropping competition/bid-range data and idea discovery. It was executed and reverted in `86853e6` — do not re-apply it.)

---

### Task 8: Keep the google-ads connector — verify only intended importers remain

**Files:**
- Keep (do NOT delete): `lib/connectors/google-ads.ts`

- [ ] **Step 1: Verify the remaining importers are keyword-research only**

Run: `rtk grep -rln "connectors/google-ads" app lib jobs __tests__ --max 20`
Expected: exactly `jobs/fetch-keyword-research.ts` and `__tests__/jobs/fetch-keyword-research.test.ts`. Tasks 1–6 removed every ad-execution importer. If any other file still imports it, stop and fix that file — do not touch the connector.

- [ ] **Step 2: Leave the unused ad-execution exports in place**

After Tasks 1–6, the connector's ad-execution/campaign-snapshot exports have no callers. Leave them in the file rather than splitting or trimming it — deleting them buys nothing and risks the keyword-research half. Nothing here is a commit; this task is verification only.

- [ ] **Step 3: Full verification**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all green.

---

### Task 9: Skill library cleanup — delete inert Google Ads skills, relabel mislabeled organic-SEO skills

**Files:**
- Delete: `skills-source/07-google-search-term-mining.md`, `skills-source/11-google-bid-strategy-recommendations.md`, `skills-source/14-google-quality-score-breakdown.md`, `skills-source/20-google-keyword-cannibalization-check.md`, `skills-source/21-google-ad-extension-audit.md`, `skills-source/37-google-ads-audit.md`, `skills-source/seo-pillar/07-google-search-term-mining.md`, `skills-source/seo-pillar/14-google-quality-score-breakdown.md`, `skills-source/seo-pillar/20-google-keyword-cannibalization-check.md`, `skills-source/seo-pillar/21-google-ad-extension-audit.md`
- Modify: `skills-source/42-google-programmatic-seo-builder.md`, `skills-source/seo-pillar/42-google-programmatic-seo-builder.md`, `skills-source/seo-pillar/35-google-e2e-seo-assistant.md` (frontmatter `platform:` field only)
- Keep unchanged: `skills-source/46-google-keyword-gap-analysis.md` — its content references Keyword Planner volume/bid-range data, which is kept; Task 6's `mapPlatform` fallback handles its `platform: Google` label.

**Rationale (do not delete more than this list, do not relabel skills not named here):** the 6 deleted skills are genuinely and exclusively about running/optimizing Google Ads campaigns (search term reports, bid strategy, Quality Score, ad extensions, keyword cannibalization within Google Ads auctions, full Google Ads account audits) — they can never produce actionable output again and have zero organic-SEO content to salvage. The relabeled files are organic/technical-SEO content that happened to declare `platform: Google` (ambiguous with "Google Ads") — confirmed by reading each file's description in fact-finding — and are switched to `platform: seo` so they're honestly categorized (same non-dispatched-by-run-skills status as before; this is a metadata correction, not a new capability).

- [ ] **Step 1: Delete the 6 pure-Google-Ads skill files and their seo-pillar duplicates**

```bash
git rm skills-source/07-google-search-term-mining.md
git rm skills-source/11-google-bid-strategy-recommendations.md
git rm skills-source/14-google-quality-score-breakdown.md
git rm skills-source/20-google-keyword-cannibalization-check.md
git rm skills-source/21-google-ad-extension-audit.md
git rm skills-source/37-google-ads-audit.md
git rm skills-source/seo-pillar/07-google-search-term-mining.md
git rm skills-source/seo-pillar/14-google-quality-score-breakdown.md
git rm skills-source/seo-pillar/20-google-keyword-cannibalization-check.md
git rm skills-source/seo-pillar/21-google-ad-extension-audit.md
```

- [ ] **Step 2: Relabel the 3 organic-SEO files' frontmatter**

In each of `skills-source/42-google-programmatic-seo-builder.md`, `skills-source/seo-pillar/42-google-programmatic-seo-builder.md`, `skills-source/seo-pillar/35-google-e2e-seo-assistant.md`, change the frontmatter line:
```
  platform: Google
```
to:
```
  platform: SEO
```

(loader.ts's `mapPlatform` lower-cases before matching, so `SEO` → `"seo"` — matches the existing `if (lower.includes("seo"))` branch.)

- [ ] **Step 3: Leave skill 46 untouched**

`skills-source/46-google-keyword-gap-analysis.md` keeps its original description and body — the keyword-research volume/bid-range data it references comes from the kept Keyword Planner integration. (An earlier draft rewrote it for a DataForSEO switch; that switch was reverted — do not re-apply.)

- [ ] **Step 4: Run the loader test from Task 6**

Run: `npx vitest run __tests__/lib/skills/loader.test.ts`
Expected: PASS now (skill 46 reports `platform: "seo"`, matching Task 6 Step 1's updated expectation).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A skills-source/
git commit -m "chore(google-ads): delete inert Google Ads skill prompts; relabel mislabeled organic-SEO skills to platform: seo"
```

---

### Task 10: UI + API — Meta-only platform surface

**Files:**
- Modify: `app/api/recommendations/route.ts`, `app/(embedded)/(ad-pilot)/recommendations/page.tsx`
- Test: any route test asserting `VALID_PLATFORMS` (check `__tests__/api/` for a recommendations-route test first)

- [ ] **Step 1: Check for an existing platform-validation test**

Run: `grep -rln "VALID_PLATFORMS\|Invalid platform" __tests__/api/`

If found, update its `google_ads`-accepted case to expect a 400, and add/confirm a case asserting `meta` is still accepted.

- [ ] **Step 2: Update `app/api/recommendations/route.ts`**

```typescript
const VALID_PLATFORMS = new Set(["meta"]);
```

- [ ] **Step 3: Update `app/(embedded)/(ad-pilot)/recommendations/page.tsx` — platformBadge**

```typescript
  function platformBadge(p: string) {
    return <Badge>{p === "meta" ? "Meta" : "Both"}</Badge>;
  }
```

(Keep the `"Both"` fallback — `platform: "both"` recommendations can still legitimately exist per the skill-loader union; only `google_ads` is gone.)

- [ ] **Step 4: Remove the "Google Ads" option from the platform filter Select**

```typescript
              <Select
                label="Filter by platform"
                labelHidden
                options={[
                  { label: "All platforms", value: "all" },
                  { label: "Meta", value: "meta" },
                ]}
                value={platform}
                onChange={setPlatform}
              />
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — expect no errors.
Run: `npm test` — expect all green.

- [ ] **Step 6: Commit**

```bash
git add app/api/recommendations/route.ts "app/(embedded)/(ad-pilot)/recommendations/page.tsx"
git commit -m "fix(google-ads): Meta-only platform filter and badge on Recommendations"
```

---

### Task 11: Docs and final verification

**Files:**
- Modify: `docs/CRON.md` (execution wording only), `.mex/ROUTER.md`
- No schema change: `prisma/schema.prisma` and `KeywordResearchResult.source`'s `"google_ads"` default are untouched.

- [ ] **Step 1: Update `docs/CRON.md` — execution wording only**

Leave the `fetch-keyword-research` row and its detail section exactly as they are (still Google Ads Keyword Planner — the integration is kept). Only replace the execution line:
```
4. **Execution** — calls the appropriate supported mutation. Google Ads mutations are blocked for this release; Google Ads is keyword research only.
```
with:
```
4. **Execution** — calls the appropriate supported mutation. Only Meta is a supported execution platform; Google Ads is keyword research only.
```

- [ ] **Step 2: Update `.mex/ROUTER.md`**

Add a bullet to "Current Project State" (and bump `last_updated`):
```
- Google Ads advertising removed (2026-07-03, user directive — the ban covers ad spend/campaign management only, NOT keyword research): executor/dispatch/platform surfaces are Meta-only; 6 pure-Google-Ads-account-optimization skill prompts deleted from `skills-source/`; 3 organic-SEO skills mislabeled `platform: Google` relabeled to `platform: SEO`. The Keyword Planner keyword-research integration is KEPT and live: `lib/connectors/google-ads.ts` research exports, `jobs/fetch-keyword-research.ts` (05:45 cron), the `google_ads_keyword_research` connector-health entry, and the `GOOGLE_ADS_*` env vars all remain — this is Agriko's keyword-research tool. Do not remove it under the "no Google Ads" directive.
```

- [ ] **Step 3: Final full verification gate**

Run: `npx tsc --noEmit` — expect no errors.
Run: `npm test` — expect all green (record the test-file/test count).
Run: `npm run build` — expect clean build.
Run: `rtk grep -rn "google_ads\|GoogleAds\|google-ads" app lib jobs --max 30` — every remaining match must belong to the kept keyword-research surface (`lib/connectors/google-ads.ts`, `jobs/fetch-keyword-research.ts`, `lib/config/connector-health.ts`'s `google_ads_keyword_research` entry) or be the DataForSEO endpoint URL string `keywords_data/google_ads/search_volume` in `lib/connectors/dataforseo-keywords.ts` (DataForSEO's own endpoint naming). No ad-execution/dispatch/UI match may remain.

- [ ] **Step 4: Commit and push**

```bash
git add docs/CRON.md .mex/ROUTER.md
git commit -m "docs(google-ads): Meta-only execution wording; record kept Keyword Planner scope"
git push origin main
```

- [ ] **Step 5: Deploy**

Follow `.mex/patterns/deploy.md`: `npm run build:remote` (or confirm `node scripts/linode-deploy.mjs` builds remotely as it always does), then run `node scripts/linode-deploy.mjs` and `pm2 restart autopilot`. No migration step — this phase has no schema change. Verify: `curl https://autopilot.agrikoph.com/api/health`.

---

## Self-review notes

- Every google_ads reference found in fact-finding (14 files) is either removed by a task or explicitly kept: executor.ts/guardrail-inputs.ts (1), execute-approved.ts (2), check-outcomes.ts/outcome-metrics.ts (3), fetch-ads-data.ts (4), run-skills.ts (5), loader.ts (6), skills-source content (9), recommendations route/page (10), docs (11); **kept by design:** fetch-keyword-research.ts + test (7), google-ads.ts connector (8), connector-health.ts keyword-research entry (Task 1 Step 7), skill 46 (Task 9 Step 3). ✔
- No placeholders: every code step shows real before/after code from the actual files read during fact-finding, or explicit instructions to read the exact surrounding lines before editing when the fact-finding excerpt was partial — flagged explicitly rather than guessed.
- Type/interface consistency: `isSupportedAction`/`executeRecommendation` signatures unchanged (Task 1) and consumed identically by Task 2's execute-approved.ts. `SkillDefinition.platform` union (Task 6) matches every `makeSkill()` fixture narrowing in Task 5; skill 46's `platform: Google` frontmatter degrades to `"seo"` via the Task 6 fallback, so no skill-file edit is needed for it.
- Deliberate scope boundary: this plan does NOT touch `skills-source/*google-and-meta-*.md` files (they map to `"both"`, still function on Meta data alone) and does NOT touch any part of the Keyword Planner keyword-research pipeline — that is a kept, live data source, not a removal target.
- **Resolved scope question (2026-07-03):** the original draft's open question — keep or remove the actively-configured Keyword Planner integration — was answered by the user: **keep it.** The "never Google Ads" directive covers advertising only; Keyword Planner is Agriko's keyword-research tool. The earlier removal was reverted in `86853e6`, scope docs corrected in `07f56cd`, and the incident recorded in `e2ab390`.
