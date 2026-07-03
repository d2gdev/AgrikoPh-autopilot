# Phase 3 — Insights → Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insights stop being read-only: creative-fatigue insights produce `pause_ad` recommendations (operator-approved as ever) and "refresh creative" StoreTasks; skill 46 finally runs so search-term insights exist at all; competitor insights seed ContentProposals.

**Architecture — scope corrections from fact-finding (read first):**
1. **Fatigue insights already flow into the Opportunities feed** (`lib/opportunities/generate.ts:328` creates `creative_fatigue` opportunities with a `rotate_creative` proposedAction), but `shouldRouteOpportunityToStoreTask` deliberately excludes them and **nothing creates Recommendations from insights** — recommendations only come from skill LLM output. Phase 3's fatigue work is therefore a deterministic converter (`lib/skills/insight-actions.ts`) wired into `run-skills`, not a "new skill".
2. **StoreTask already exists** (model with unique `dedupeKey`, plus the `storeTask.upsert` precedent in `lib/store-tasks/route-opportunities.ts`) — reuse, don't rebuild.
3. **Competitor ContentProposal seeds MUST live inside `generateProposals`**: the daily cron (`app/api/cron/daily/route.ts:~128`) **deletes every pending ContentProposal and regenerates the set nightly**. A standalone producer's rows would be wiped within 24h. The seeds are added as a findings source inside `lib/content-pilot/generate-proposals.ts` so they survive by being regenerated from the latest insight each night.
4. **Skill 46 never runs today** for two reasons, both fixed here: platform `"seo"` is not in `DISPATCHABLE_PLATFORMS` (`jobs/run-skills.ts:78`), and `assembleDataPayload` (`lib/skills/runner.ts:251`) builds an ad-account-centric prompt that would drown a keyword-research skill in irrelevant Meta JSON.

**Tech Stack:** Next.js 14 App Router, Prisma/PostgreSQL, Vitest. No new frameworks, no migration (StoreTask exists).

## Global Constraints

- **Keyword Planner is untouchable** (user directive, clarified 2026-07-03: the "no Google Ads" ban covers advertising only, never keyword research). Nothing here touches `lib/connectors/google-ads.ts`, `jobs/fetch-keyword-research.ts`, the `google_ads_keyword_research` connector-health entry, or `GOOGLE_ADS_*` env vars. **Skill 46 (`skills-source/46-google-keyword-gap-analysis.md`) must NOT be deleted or have its content rewritten** — this phase makes it *run*. If any step appears to require removing it, stop and surface to the operator.
- `pause_ad` must never enter `CONVERSION_SENSITIVE_ACTIONS` in `lib/guardrails.ts` (verified: the set is `pause_campaign, adjust_budget, change_bid` — leave it exactly so).
- No autonomous execution path changes: converter-created recommendations enter the same pending → operator approval → `EXECUTE_APPROVED_LIVE_ENABLED` gate as every other recommendation. This phase creates rows, never executes them.
- Dedup rule (roadmap-locked): skip creating a `pause_ad` rec if a `pending`/`approved`/`override_approved` rec already targets the same ad with the same action. "Refresh creative" is a StoreTask, never an executable action.
- All DB access via `import { prisma } from "@/lib/db"`. Verify gate: `npx tsc --noEmit` clean, `npm test` green, `npm run build` clean. New logic gets Vitest coverage.
- After the phase: update `.mex/ROUTER.md`, commit + push. **No deploy checkpoint** (next 🚀 is after Phase 4).

---

### Task 1: Fatigue converter — `pause_ad` recommendations + refresh-creative StoreTasks

**Files:**
- Create: `lib/skills/insight-actions.ts`, `__tests__/lib/skills/insight-actions.test.ts`
- Modify: `jobs/run-skills.ts` (one call site + summary fields)

**Interfaces:**
- Produces: `createFatigueActions(input: { runId: string; rows: Array<{ skillId: string; skillName: string; insightType: string; items: unknown[]; snapshotId: string }> }): Promise<{ pauseRecs: number; refreshTasks: number }>` — consumes the exact `insightRows` array `run-skills` already builds (so no re-query), acts only on `insightType === "fatigue-report"` rows.
- Fatigue item shape (from `INSIGHT_SCHEMAS["fatigue-report"]` in `lib/skills/runner.ts`): `{ adId, adName, adSetName, status: "urgent"|"warning"|"healthy"|"dead", frequency, ctrChange7d, daysRunning, estimatedDaysLeft, rationale }`.
- Behavior: `dead` or `urgent` → `pause_ad` Recommendation (confidence: dead 0.9, urgent 0.7); `urgent` only → additionally a `refresh_creative` StoreTask. `warning`/`healthy` → nothing.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/skills/insight-actions.test.ts` (mock style mirrors `__tests__/jobs/daily-digest.test.ts`):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  recommendation: { findFirst: vi.fn(), create: vi.fn().mockResolvedValue({ id: "rec_1" }) },
  storeTask: { upsert: vi.fn().mockResolvedValue({ id: "task_1" }) },
};
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/guardrails", () => ({ checkGuardrails: vi.fn().mockResolvedValue({ status: "clear" }) }));

import { createFatigueActions } from "@/lib/skills/insight-actions";

const row = (items: unknown[]) => ({
  skillId: "04-meta-creative-fatigue-detection",
  skillName: "Creative Fatigue Detection",
  insightType: "fatigue-report",
  items,
  snapshotId: "snap_1",
});

describe("createFatigueActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.recommendation.findFirst.mockResolvedValue(null);
    prismaMock.recommendation.create.mockResolvedValue({ id: "rec_1" });
    prismaMock.storeTask.upsert.mockResolvedValue({ id: "task_1" });
  });

  it("dead ad → pause_ad rec only; urgent ad → rec AND refresh task; healthy → nothing", async () => {
    const result = await createFatigueActions({
      runId: "run_1",
      rows: [row([
        { adId: "ad_dead", adName: "Dead Ad", status: "dead", rationale: "CTR collapsed" },
        { adId: "ad_urgent", adName: "Tired Ad", status: "urgent", rationale: "Frequency 6+" },
        { adId: "ad_ok", adName: "Fine Ad", status: "healthy" },
      ])],
    });
    expect(result).toEqual({ pauseRecs: 2, refreshTasks: 1 });
    expect(prismaMock.recommendation.create).toHaveBeenCalledTimes(2);
    const first = prismaMock.recommendation.create.mock.calls[0]![0].data;
    expect(first).toMatchObject({
      platform: "meta",
      actionType: "pause_ad",
      targetEntityType: "ad",
      targetEntityId: "ad_dead",
      confidenceScore: 0.9,
      snapshotId: "snap_1",
    });
    expect(prismaMock.storeTask.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.storeTask.upsert.mock.calls[0]![0].where).toEqual({
      dedupeKey: "store-task:refresh-creative:ad_urgent",
    });
  });

  it("skips the rec when a pending/approved rec already targets the same ad+action", async () => {
    prismaMock.recommendation.findFirst.mockResolvedValue({ id: "existing" });
    const result = await createFatigueActions({
      runId: "run_1",
      rows: [row([{ adId: "ad_1", adName: "A", status: "dead", rationale: "r" }])],
    });
    expect(result.pauseRecs).toBe(0);
    expect(prismaMock.recommendation.create).not.toHaveBeenCalled();
  });

  it("ignores malformed items and non-fatigue rows without throwing", async () => {
    const result = await createFatigueActions({
      runId: "run_1",
      rows: [
        row([{ adName: "no id", status: "dead" }, null, "junk"]),
        { ...row([]), insightType: "competitor-analysis", items: [{ competitor: "X" }] },
      ],
    });
    expect(result).toEqual({ pauseRecs: 0, refreshTasks: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/skills/insight-actions.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `lib/skills/insight-actions.ts`**

```typescript
import { prisma } from "@/lib/db";
import { checkGuardrails } from "@/lib/guardrails";

type InsightRow = {
  skillId: string;
  skillName: string;
  insightType: string;
  items: unknown[];
  snapshotId: string;
};

type FatigueItem = {
  adId: string;
  adName: string;
  adSetName?: string | null;
  status: "urgent" | "warning" | "healthy" | "dead";
  rationale?: string;
  estimatedDaysLeft?: number | null;
};

function parseFatigueItem(raw: unknown): FatigueItem | null {
  if (raw === null || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.adId !== "string" || !item.adId) return null;
  const status = item.status;
  if (status !== "urgent" && status !== "warning" && status !== "healthy" && status !== "dead") return null;
  return {
    adId: item.adId,
    adName: typeof item.adName === "string" && item.adName ? item.adName : item.adId,
    adSetName: typeof item.adSetName === "string" ? item.adSetName : null,
    status,
    rationale: typeof item.rationale === "string" ? item.rationale : undefined,
    estimatedDaysLeft: typeof item.estimatedDaysLeft === "number" ? item.estimatedDaysLeft : null,
  };
}

// Deterministic converter: fatigue insights → pause_ad recommendations (dead|urgent)
// and refresh-creative StoreTasks (urgent only). Recommendations enter the normal
// pending → operator-approval → gated-executor pipeline; nothing here executes.
export async function createFatigueActions(input: {
  runId: string;
  rows: InsightRow[];
}): Promise<{ pauseRecs: number; refreshTasks: number }> {
  let pauseRecs = 0;
  let refreshTasks = 0;

  for (const rowItem of input.rows) {
    if (rowItem.insightType !== "fatigue-report") continue;

    for (const raw of rowItem.items) {
      const item = parseFatigueItem(raw);
      if (!item) continue;

      if (item.status === "dead" || item.status === "urgent") {
        const rationale =
          item.rationale ??
          `${item.adName} shows ${item.status} creative fatigue and should be paused pending a refresh.`;
        const rec = {
          actionType: "pause_ad",
          targetEntityType: "ad",
          targetEntityId: item.adId,
          targetEntityName: item.adName,
          currentValue: null as string | null,
          proposedValue: "paused" as string | null,
          changePercent: null as number | null,
          rationale,
          estimatedImpact: null as string | null,
          confidenceScore: item.status === "dead" ? 0.9 : 0.7,
        };

        // Roadmap dedup rule: skip if a live rec already targets this ad+action.
        const existing = await prisma.recommendation.findFirst({
          where: {
            platform: "meta",
            actionType: "pause_ad",
            targetEntityId: item.adId,
            status: { in: ["pending", "approved", "override_approved"] },
          },
        });
        if (!existing) {
          const guard = await checkGuardrails(rec);
          try {
            await prisma.recommendation.create({
              data: {
                platform: "meta",
                skillId: rowItem.skillId,
                skillName: rowItem.skillName,
                actionType: rec.actionType,
                targetEntityType: rec.targetEntityType,
                targetEntityId: rec.targetEntityId,
                targetEntityName: rec.targetEntityName,
                currentValue: rec.currentValue,
                proposedValue: rec.proposedValue,
                changePercent: rec.changePercent,
                rationale: rec.rationale,
                estimatedImpact: rec.estimatedImpact,
                confidenceScore: rec.confidenceScore,
                guardStatus: guard.status,
                guardReason: guard.status !== "clear" ? guard.reason : null,
                snapshotId: rowItem.snapshotId,
              },
            });
            pauseRecs++;
          } catch (err: unknown) {
            const isDup =
              err != null && typeof err === "object" && "code" in err &&
              (err as { code: string }).code === "P2002";
            if (!isDup) throw err;
          }
        }
      }

      if (item.status === "urgent") {
        await prisma.storeTask.upsert({
          where: { dedupeKey: `store-task:refresh-creative:${item.adId}` },
          update: { description: item.rationale ?? "Creative fatigue — refresh recommended.", updatedAt: new Date() },
          create: {
            taskType: "refresh_creative",
            targetType: "ad",
            targetId: item.adId,
            title: `Refresh creative for ${item.adName}`,
            description: item.rationale ?? "Creative fatigue — refresh recommended.",
            proposedState: { action: "refresh_creative", adId: item.adId, adSetName: item.adSetName ?? null },
            sourceData: { runId: input.runId, snapshotId: rowItem.snapshotId, skillId: rowItem.skillId },
            priority: "high",
            dedupeKey: `store-task:refresh-creative:${item.adId}`,
          },
        });
        refreshTasks++;
      }
    }
  }

  return { pauseRecs, refreshTasks };
}
```

(If `checkGuardrails`'s `RecommendationInput` type requires fields beyond the `rec` object above, read its definition at `lib/guardrails.ts` top and satisfy it — run-skills passes its parsed LLM rec objects, which have exactly these fields.)

- [ ] **Step 4: Run the test**

Run: `npx vitest run __tests__/lib/skills/insight-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `jobs/run-skills.ts`**

**Read the block after the `prisma.skillInsight.createMany` call first** (~lines 253–300). After the insight persist and before the summary is built, add:

```typescript
  let fatigueActions = { pauseRecs: 0, refreshTasks: 0 };
  if (insightRows.length > 0) {
    const { createFatigueActions } = await import("@/lib/skills/insight-actions");
    try {
      fatigueActions = await createFatigueActions({ runId, rows: insightRows });
      totalRecs += fatigueActions.pauseRecs; // counts toward the Phase 1 new_recommendations alert
    } catch (err) {
      errors.push(`insight-actions: ${String(err)}`);
    }
  }
```

and add `fatigueActions` to the `RunSkillsSummary` object (and its type): `fatigueActions: { pauseRecs: number; refreshTasks: number }`.

- [ ] **Step 6: Run the run-skills suites and commit**

Run: `npx vitest run __tests__/jobs/run-skills.test.ts __tests__/jobs/run-skills.filtering.test.ts __tests__/jobs/run-skills.rotation.test.ts __tests__/lib/skills/insight-actions.test.ts`
Expected: PASS (the converter no-ops when no fatigue insights are in the run; if a summary-shape assertion exists, add the new field to it).

```bash
git add lib/skills/insight-actions.ts jobs/run-skills.ts __tests__/lib/skills/insight-actions.test.ts
git commit -m "feat(skills): fatigue insights convert to pause_ad recs + refresh-creative StoreTasks"
```

---

### Task 2: Dispatch skill 46 — platform "seo" runs on keyword-research + GSC data

**Files:**
- Modify: `jobs/run-skills.ts` (`DISPATCHABLE_PLATFORMS` + eligibility, ~lines 78–83), `lib/skills/runner.ts` (`assembleDataPayload`, line 251)
- Test: `__tests__/jobs/run-skills.filtering.test.ts`, `__tests__/lib/skills/runner.test.ts`

**Interfaces:**
- Locked design (per the roadmap's corrected Phase 3 note): platform `"seo"` becomes dispatchable. The meta snapshot stays the bookkeeping anchor (hash-skip, `snapshotId` on insights/recs) — skill 46 re-runs when the daily meta snapshot changes, which is the same daily cadence as its keyword-research inputs. Its *prompt payload* changes: for `"seo"` skills, `assembleDataPayload` skips every ad-account section and sends only the skill's declared `extraSources` (`keyword_research`, `gsc`) — a keyword-gap skill drowning in Meta campaign JSON is noise and a truncation risk. Skill 46's markdown content is **not modified**. Any LLM recommendations it emits with ads vocabulary (`add_negative_keyword` etc.) are already filtered by `isSupportedAction` — its value is the `search-term-opportunities` insight block, whose consumer (`lib/opportunities/generate.ts:opportunityFromSearchTermItem`) has been waiting for data since it was written.

- [ ] **Step 1: Update the filtering test first**

In `__tests__/jobs/run-skills.filtering.test.ts`: widen the `makeSkill` platform parameter type to include `"seo"`, and add a test asserting a `"seo"`-platform skill IS dispatched when a meta snapshot exists (mirror the existing dispatch-assertion style in the file — read it first). Keep the existing test asserting `google_ads` is not dispatchable, unchanged.

- [ ] **Step 2: Update `jobs/run-skills.ts`**

```typescript
  const DISPATCHABLE_PLATFORMS: SkillDefinition["platform"][] = ["meta", "both", "seo"];
  const eligibleSkills = allSkills.filter((s) => {
    if (!DISPATCHABLE_PLATFORMS.includes(s.platform)) return false;
    if (s.platform === "meta") return !!metaSnap;
    if (s.platform === "both") return !!metaSnap;
    if (s.platform === "seo") return !!metaSnap && (s.extraSources?.length ?? 0) > 0;
    return false;
  });
```

- [ ] **Step 3: Update `assembleDataPayload` in `lib/skills/runner.ts`**

Guard the ad-account sections (campaigns / adSets / ads / keywords / searchTerms / insights) behind `const includeAdAccountData = skill.platform !== "seo";` — wrap each existing `if (payload.X)` as `if (includeAdAccountData && payload.X)`. The extraContext loop at the bottom stays unchanged. Also make the header line conditional: `"# Ad Account Data for Analysis\n"` → for seo skills `"# Keyword & Organic Search Data for Analysis\n"`.

Add a runner test (in `__tests__/lib/skills/runner.test.ts`, mirroring its existing `assembleDataPayload` tests if present — read the file first): a `"seo"`-platform skill with `extraSources: ["keyword_research"]` gets a payload containing the keyword-research section and NOT `"## Campaigns"`.

- [ ] **Step 4: Confirm skill 46 becomes eligible end-to-end**

Run: `npx vitest run __tests__/jobs/run-skills.filtering.test.ts __tests__/lib/skills/runner.test.ts __tests__/lib/skills/loader.test.ts`
Expected: PASS (loader test already asserts skill 46 loads with platform `"seo"`, `extraSources: ["keyword_research","gsc"]`, `insightBlock: "search-term-opportunities"` — unchanged).

- [ ] **Step 5: Commit**

```bash
git add jobs/run-skills.ts lib/skills/runner.ts __tests__/jobs/run-skills.filtering.test.ts __tests__/lib/skills/runner.test.ts
git commit -m "feat(skills): dispatch platform-seo skills (skill 46) on keyword-research + GSC extra sources"
```

---

### Task 3: Competitor insights → ContentProposal seeds (inside generateProposals)

**Files:**
- Modify: `lib/content-pilot/generate-proposals.ts`
- Test: `__tests__/lib/content-pilot/generate-proposals.test.ts`

**Interfaces:**
- Placement is load-bearing: the daily cron **deletes all pending proposals and re-creates the generated set nightly** (`app/api/cron/daily/route.ts` `deleteMany({ where: { status: "pending" } })`). Seeds must therefore be (re)generated inside `generateProposals(prismaClient)` from the latest `competitor-analysis` SkillInsight so they persist by regeneration.
- Competitor item shape (from `INSIGHT_SCHEMAS["competitor-analysis"]`): `{ competitor, activeAdCount, dominantFormat, messagingThemes[], primaryCta, recentLaunches7d, gaps[], recommendedTests[] }`.
- Output: for each of the latest insight's items, up to 2 `recommendedTests` become ProposalInputs: `{ articleHandle: null, proposalType: "new-content", changeType: "new_article", priority: "medium", impact/effort per house style, title: "Counter-angle: <test>" (≤ 240 chars), description citing the competitor and its gaps, proposedState: { targetKeyword: <test>, angle: <test>, competitor }, sourceData: { insightId, competitor, gaps } }`. Setting `proposedState.targetKeyword` is required — the in-memory dedup (~line 505) keys null-handle proposals on `targetKeyword ?? title`, so distinct seeds survive dedup.

- [ ] **Step 1: Write the failing test**

Extend `__tests__/lib/content-pilot/generate-proposals.test.ts` (read its existing prisma-mock fixture first and extend it with `skillInsight: { findFirst: vi.fn() }`): a mocked latest competitor-analysis insight with one competitor carrying two `recommendedTests` yields two `new-content` ProposalInputs with `proposedState.competitor` set and distinct `targetKeyword`s; when `findFirst` resolves null, zero competitor proposals are produced and the other finding sources are unaffected.

- [ ] **Step 2: Implement**

In `generateProposals`, add `prismaClient.skillInsight.findFirst({ where: { insightType: "competitor-analysis" }, orderBy: { createdAt: "desc" } })` to the initial `Promise.all`, and a builder `competitorFindings(insight)` that maps items → ProposalInputs as specified, appended to the findings list **before** the dedup pass. Ignore malformed items defensively (same tolerant-parse style as Task 1). Cap: 2 tests per competitor, max 6 seeds total per run.

- [ ] **Step 3: Run and commit**

Run: `npx vitest run __tests__/lib/content-pilot/generate-proposals.test.ts`
Expected: PASS.

```bash
git add lib/content-pilot/generate-proposals.ts __tests__/lib/content-pilot/generate-proposals.test.ts
git commit -m "feat(content-pilot): competitor-analysis insights seed counter-angle ContentProposals"
```

**Known pre-existing quirk (do NOT fix in this phase, note in the report):** the daily cron's `activeKeys` filter keys on `articleHandle::proposalType`, so one approved/published null-handle `new-content` proposal suppresses ALL fresh null-handle new-content proposals (competitor seeds and content-gap proposals alike). This predates Phase 3 and affects both equally; changing the keying is a behavior change outside this scope.

---

### Task 4: Verification, ROUTER doc, final gate

**Files:**
- Modify: `.mex/ROUTER.md`

- [ ] **Step 1: Chain verification (static)**

Record in your report the file:line chain for each loop: fatigue insight → `createFatigueActions` → pending `pause_ad` rec visible on the Recommendations page (existing UI — no change needed; recs are recs) + `refresh_creative` StoreTask; skill 46 eligibility → runner payload → `search-term-opportunities` insight → `opportunityFromSearchTermItem`; competitor insight → `generateProposals` seed → nightly proposal set.

- [ ] **Step 2: `.mex/ROUTER.md` — add to Current Project State (bump `last_updated`)**

```
- Insights → actions (Phase 3, 2026-07-XX): lib/skills/insight-actions.ts converts fatigue-report insights to pause_ad recommendations (dead 0.9 / urgent 0.7 confidence, dedup vs live recs, guardrail-checked, normal approval pipeline) and refresh-creative StoreTasks (urgent only, dedupeKey store-task:refresh-creative:<adId>); called from run-skills after insight persist, counts feed the new_recommendations alert. Platform "seo" is now dispatchable — skill 46 (keyword-gap-analysis, KEPT per the Google Ads scope rule) runs on keyword_research+gsc extra sources with ad-account payload sections suppressed, finally producing search-term-opportunities insights for the existing opportunities consumer. competitor-analysis insights seed counter-angle new-content ContentProposals inside generateProposals (inside, because the daily cron wipes+regenerates pending proposals nightly).
```

- [ ] **Step 3: Final gate**

Run: `npx tsc --noEmit` — no errors. `npm test` — all green (record counts). `npm run build` — clean.

- [ ] **Step 4: Commit and push**

```bash
git add .mex/ROUTER.md
git commit -m "docs(mex): record Phase 3 insights-to-actions"
git push origin main
```

No deploy (next checkpoint after Phase 4). Note for the operator in the final report: the first real `pause_ad` recommendations will appear after the next `run-skills` cycle that produces fatigue insights, and skill 46's first insights after the next cycle with keyword-research data present.

---

## Self-review notes

- Roadmap coverage: fatigue → pause_ad recs (Task 1, with the locked dedup rule and confidence-from-severity); urgent → refresh-creative StoreTask (Task 1, reusing the existing StoreTask model/upsert precedent); search-term insights (Task 2 — skill 46 dispatched, NOT deleted, content untouched, per the corrected roadmap note); competitor insights → ContentProposal seeds (Task 3, placed inside generateProposals for survival); acceptance criteria (seeded fatigue insight → pending pause_ad rec on the Recommendations page → approval executes through the normal path → second run creates no duplicate) are covered by Task 1's dedup test + the unchanged approval/executor pipeline. ✔
- Contradictions vs the roadmap sketch are documented in the Architecture section (fatigue already feeds Opportunities; StoreTask already exists; nightly proposal wipe forces seed placement; skill 46's dual blockers).
- Safety rails restated and verified: `CONVERSION_SENSITIVE_ACTIONS` confirmed to exclude `pause_ad` and is not touched; converter rows enter the standard approval pipeline; StoreTasks are advisory rows.
- No placeholders: code steps are written against symbols read during fact-finding; the five read-before-edit spots (run-skills wiring block, filtering-test style, runner-test style, generate-proposals fixture, RecommendationInput type) are flagged with exactly what to look for.
- Type consistency: `createFatigueActions` consumes the `insightRows` element shape run-skills already builds (`skillId/skillName/insightType/items/snapshotId`); dedupeKey strings match between implementation, test, and ROUTER doc; `fatigueActions` summary field named identically in code and type.
- Keyword Planner surface: untouched by every task; skill 46 gains a dispatch path and loses nothing.
