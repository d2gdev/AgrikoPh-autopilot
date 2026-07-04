# Phase 5 — Ad-Approvals Stepper, Timeline, Human Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operator opening an ad approval can see at a glance where it sits in the pipeline (stage stepper), what happened to it in order (unified timeline), and who the humans are (display names instead of raw Shopify user ids).

**Architecture — scope corrections from fact-finding:**
1. **Review names already exist**: `AdReview.reviewerName` is denormalized at write time ("AI Pre-Review Agent" or the human's display name), so the timeline needs no user join for reviews. The raw-id problem is confined to `submitterId` and the three `assigned*Id` fields on the list/detail — and `lib/ad-approval/app-users.ts` (`captureAppUser`) already populates the `AppUser` directory (`shopifyUserId → displayName/email`), so the join has data.
2. **`campaignId` is already the human-facing label** — it's the detail page's `<Page title>`. The roadmap's optional Meta-campaign-name enrichment stays: a best-effort id→name map from the latest meta `RawSnapshot.payload.campaigns`.
3. **`stageProgress(status)` alone cannot place `needs_revision` / `rejected` / `cancelled`** — those statuses don't encode which stage bounced the ad, but `AdApproval.stage` does (and `transition()` maintains it). The signature is therefore `stageProgress(status, stage)`.
4. **Timeline sources confirmed**: `AdRevision` (`submittedAt`, `revisionNumber`), `AdReview` (`completedAt`, `stage`, `reviewerName`, `decision`, `score`, `comments`), `AuditLog` where `entityType: "ad_approval"` (indexed on `[entityType, entityId]`; rows carry `actor`, `action`, `meta` — e.g. the SLA worker's `ESCALATED`). No stepper/timeline machinery exists anywhere yet (grep-verified).

**Tech Stack:** Next.js 14 App Router, Polaris, Prisma/PostgreSQL, Vitest. No new dependencies, no migration.

## Global Constraints

- **Keyword Planner is untouchable** (user directive, clarified 2026-07-03: the "no Google Ads" ban covers advertising only, never keyword research). Nothing here touches `lib/connectors/google-ads.ts`, `jobs/fetch-keyword-research.ts`, the `google_ads_keyword_research` connector-health entry, `GOOGLE_ADS_*` env vars, or skill 46. If any step appears to require it, stop and surface to the operator.
- **UI + API read-shaping only.** No writes to Meta or Shopify, no migrations, and **no changes to the approval state machine** (`transition()`, `constants.ts` STATUS/STAGE values, route mutation handlers). If a task appears to need a state-machine change, stop and surface.
- All API additions are **non-breaking**: new response fields only (`names`, `campaignLabel`, `timeline`, `stageProgress` consumed client-side); existing field shapes untouched.
- **Phase 7 forward-compatibility (roadmap-locked):** Phase 7 will append a `launched` step to the stepper. `stageProgress` therefore returns an ordered `steps` array with stable string `key`s that consumers render generically (no hardcoded step count anywhere in the UI) — appending an 8th step later is additive.
- All DB access via `import { prisma } from "@/lib/db"`. Verify gate: `npx tsc --noEmit` clean, `npm test` green, `npm run build` clean. The stepper function is unit-tested against **every** status in `constants.ts` programmatically, so a future status addition fails the test rather than rendering wrong.
- After the phase: update `.mex/ROUTER.md`, commit + push. **No deploy checkpoint** (next 🚀 is after Phase 7).

---

### Task 1: `stageProgress` — pure stepper state function

**Files:**
- Create: `lib/ad-approval/stage-progress.ts`
- Test: `__tests__/lib/stage-progress.test.ts`

**Interfaces:**
- Produces: `stageProgress(status: string, stage: string): { steps: StepState[] }` with `StepState = { key: StepKey; label: string; state: "done" | "current" | "blocked" | "pending" }` and `StepKey = "ai_pre_review" | "brand" | "conversion" | "technical" | "penultimate" | "final" | "approved"` (exported — Phase 7 appends `"launched"`).
- Semantics: the seven pipeline steps in order. Active statuses mark earlier steps `done`, the live step `current`, later steps `pending`. `approved_to_make_kwarta` → all seven `done`. `draft` → all `pending`. `needs_revision` / `rejected` / `cancelled` → steps before the bouncing stage `done`, the bouncing step `blocked` (located via the `stage` argument: `PRE_REVIEW→ai_pre_review, BRAND→brand, CONVERSION→conversion, TECHNICAL→technical, PENULTIMATE→penultimate, FINAL→final`), rest `pending`. Unknown status or stage → all `pending` (defensive, never throws).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { STATUS, STAGE } from "@/lib/ad-approval/constants";
import { stageProgress } from "@/lib/ad-approval/stage-progress";

const KEYS = ["ai_pre_review", "brand", "conversion", "technical", "penultimate", "final", "approved"];

describe("stageProgress", () => {
  it("covers every STATUS value without throwing and always returns 7 ordered steps", () => {
    for (const status of Object.values(STATUS)) {
      for (const stage of Object.values(STAGE)) {
        const { steps } = stageProgress(status, stage);
        expect(steps.map((s) => s.key)).toEqual(KEYS);
        for (const s of steps) expect(["done", "current", "blocked", "pending"]).toContain(s.state);
      }
    }
  });

  it("maps the happy path", () => {
    expect(stageProgress(STATUS.DRAFT, STAGE.PRE_REVIEW).steps.every((s) => s.state === "pending")).toBe(true);
    const inBrand = stageProgress(STATUS.IN_BRAND_REVIEW, STAGE.BRAND).steps;
    expect(inBrand[0]!.state).toBe("done");
    expect(inBrand[1]!.state).toBe("current");
    expect(inBrand[2]!.state).toBe("pending");
    const final = stageProgress(STATUS.WITH_FINAL_APPROVER, STAGE.FINAL).steps;
    expect(final[5]!.state).toBe("current");
    expect(final[6]!.state).toBe("pending");
    expect(stageProgress(STATUS.APPROVED, STAGE.FINAL).steps.every((s) => s.state === "done")).toBe(true);
  });

  it("locates blocked states via the stage argument", () => {
    const bounced = stageProgress(STATUS.NEEDS_REVISION, STAGE.CONVERSION).steps;
    expect(bounced[0]!.state).toBe("done");
    expect(bounced[1]!.state).toBe("done");
    expect(bounced[2]!.state).toBe("blocked");
    expect(bounced[3]!.state).toBe("pending");
    expect(stageProgress(STATUS.REJECTED, STAGE.FINAL).steps[5]!.state).toBe("blocked");
    expect(stageProgress(STATUS.CANCELLED, STAGE.PRE_REVIEW).steps[0]!.state).toBe("blocked");
  });

  it("degrades to all-pending on unknown input", () => {
    expect(stageProgress("mystery_status", "MYSTERY").steps.every((s) => s.state === "pending")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/stage-progress.test.ts` — FAIL, module missing.

- [ ] **Step 3: Implement `lib/ad-approval/stage-progress.ts`**

```typescript
import { STATUS, STAGE } from "@/lib/ad-approval/constants";

// Phase 7 will append a "launched" step — keys are stable, consumers must
// render the array generically (no hardcoded step counts).
export type StepKey =
  | "ai_pre_review" | "brand" | "conversion" | "technical"
  | "penultimate" | "final" | "approved";

export type StepStateValue = "done" | "current" | "blocked" | "pending";
export interface StepState { key: StepKey; label: string; state: StepStateValue }

const PIPELINE: Array<{ key: StepKey; label: string }> = [
  { key: "ai_pre_review", label: "AI pre-review" },
  { key: "brand", label: "Brand" },
  { key: "conversion", label: "Conversion" },
  { key: "technical", label: "Technical" },
  { key: "penultimate", label: "Penultimate" },
  { key: "final", label: "Final" },
  { key: "approved", label: "Approved" },
];

// status → index of the "current" step while the pipeline is live.
const CURRENT_INDEX: Record<string, number> = {
  [STATUS.FOR_AI_PRE_REVIEW]: 0,
  [STATUS.IN_AI_PRE_REVIEW]: 0,
  [STATUS.FOR_BRAND_REVIEW]: 1,
  [STATUS.IN_BRAND_REVIEW]: 1,
  [STATUS.FOR_CONVERSION_REVIEW]: 2,
  [STATUS.IN_CONVERSION_REVIEW]: 2,
  [STATUS.FOR_TECHNICAL_REVIEW]: 3,
  [STATUS.IN_TECHNICAL_REVIEW]: 3,
  [STATUS.WITH_PENULTIMATE_APPROVER]: 4,
  [STATUS.WITH_FINAL_APPROVER]: 5,
};

const STAGE_INDEX: Record<string, number> = {
  [STAGE.PRE_REVIEW]: 0,
  [STAGE.BRAND]: 1,
  [STAGE.CONVERSION]: 2,
  [STAGE.TECHNICAL]: 3,
  [STAGE.PENULTIMATE]: 4,
  [STAGE.FINAL]: 5,
};

function build(states: StepStateValue[]): { steps: StepState[] } {
  return { steps: PIPELINE.map((p, i) => ({ ...p, state: states[i] ?? "pending" })) };
}

function upTo(index: number, at: StepStateValue): { steps: StepState[] } {
  return build(PIPELINE.map((_, i): StepStateValue => (i < index ? "done" : i === index ? at : "pending")));
}

export function stageProgress(status: string, stage: string): { steps: StepState[] } {
  if (status === STATUS.APPROVED) return build(PIPELINE.map(() => "done"));
  if (status in CURRENT_INDEX) return upTo(CURRENT_INDEX[status]!, "current");

  if (status === STATUS.NEEDS_REVISION || status === STATUS.REJECTED || status === STATUS.CANCELLED) {
    const idx = STAGE_INDEX[stage];
    if (idx === undefined) return build(PIPELINE.map(() => "pending"));
    return upTo(idx, "blocked");
  }

  // draft and anything unknown: nothing has happened in the pipeline yet.
  return build(PIPELINE.map(() => "pending"));
}
```

- [ ] **Step 4: Run to verify PASS, then commit**

```bash
git add lib/ad-approval/stage-progress.ts __tests__/lib/stage-progress.test.ts
git commit -m "feat(ad-approval): stageProgress pure stepper state (all 15 statuses covered)"
```

---

### Task 2: `buildApprovalTimeline` — pure merge of revisions, reviews, audit entries

**Files:**
- Create: `lib/ad-approval/timeline.ts`
- Test: `__tests__/lib/ad-approval-timeline.test.ts`

**Interfaces:**
- Produces: `buildApprovalTimeline(input: { revisions: RevisionLike[]; reviews: ReviewLike[]; auditRows: AuditLike[]; names: Record<string, string> }): TimelineEntry[]` — `TimelineEntry = { at: string; actor: string; kind: "revision" | "review" | "audit"; summary: string }`, sorted ascending by `at`. Input types are structural subsets of the Prisma rows (define them locally in the module so the function stays pure and mockable):
  - `RevisionLike = { revisionNumber: number; submittedAt: Date; statusAtSubmission: string }` — actor is the submitter: pass the resolved submitter name via `names[submitterId] ?? submitterId` at the call site by including it in input as `submitterLabel: string`.
  - `ReviewLike = { stage: string; reviewerName: string; decision: string; score: number | null; comments: string | null; completedAt: Date }` — actor is `reviewerName` (already human-readable).
  - `AuditLike = { createdAt: Date; actor: string; action: string; meta: unknown }` — actor resolved via `names[actor] ?? actor` (audit actors are `"system"` or Shopify user ids).
- Summaries: revision → `Revision N submitted (from <statusAtSubmission>)`; review → `<stage>: <decision>` + ` — score X` when present + ` — "<comments trimmed to 140 chars>"` when present; audit → `<action>` + ` — <meta.reason>` when meta is an object carrying a string `reason`.

- [ ] **Step 1: Write the failing test** — three fixtures (one of each kind, out of order), assert ascending sort, actor resolution (audit actor id → name via map, unknown id falls back raw, `"system"` stays `"system"`), and each summary format exactly. Plus an empty-input → `[]` case.

- [ ] **Step 2–4: Implement, PASS, commit** (`feat(ad-approval): buildApprovalTimeline pure merge`) — implementation is a straightforward map-concat-sort; keep it dependency-free.

---

### Task 3: Detail API — timeline + names + stage progress inputs

**Files:**
- Modify: `app/api/ad-approvals/[id]/route.ts` (GET only)

- [ ] **Step 1: Read the GET handler** (~lines 27–50 — it already `include`s `revisions`, `reviews`, and AI reports). Then extend it:

1. Fetch audit rows: `prisma.auditLog.findMany({ where: { entityType: "ad_approval", entityId: id }, orderBy: { createdAt: "asc" }, take: 200 })`.
2. Resolve names once: collect `[approval.submitterId, approval.assignedConversionReviewerId, approval.assignedPenultimateApproverId, approval.assignedFinalApproverId, ...auditRows.map(r => r.actor)]`, filter non-null/non-"system", `prisma.appUser.findMany({ where: { shopifyUserId: { in: ids } }, select: { shopifyUserId: true, displayName: true, email: true } })` → `names[shopifyUserId] = displayName ?? email ?? shopifyUserId`.
3. Build `timeline` via `buildApprovalTimeline` (submitterLabel = `names[approval.submitterId] ?? approval.submitterId`).
4. Response becomes `NextResponse.json({ approval, actor: ctx.actor, isAdmin: admin, names, timeline })` — additive fields only.

- [ ] **Step 2: Verify** — `npx tsc --noEmit` clean; run any existing ad-approvals API tests (`npx vitest run __tests__/api/ad-approvals-submit.test.ts`) unchanged-green. Commit: `feat(ad-approval): detail API returns unified timeline + resolved names`.

---

### Task 4: List API — names map + campaignLabel enrichment

**Files:**
- Modify: `app/api/ad-approvals/route.ts` (GET only)

- [ ] **Step 1: Extend the GET handler** after the existing `findMany`:

1. Names: collect submitter + assigned ids across the page of approvals → one `appUser.findMany` → `names` map (same fallback rule as Task 3).
2. `campaignLabel`: load the latest meta snapshot once — `prisma.rawSnapshot.findFirst({ where: { source: "meta" }, orderBy: { fetchedAt: "desc" }, select: { payload: true } })`; build `campaignNames[id] = name` from `payload.campaigns` (tolerate absence — the payload shape is `Array<{ id, name }>`-ish; **read one live payload shape via an existing consumer** — `lib/dashboard/jobs-status.ts` or `lib/recommendations/guardrail-inputs.ts` both walk `payload.campaigns` — and match their access pattern). Attach per-approval `campaignLabel: campaignNames[a.campaignId] ?? a.campaignId`.
3. Response: `{ approvals: approvalsWithLabel, names, total, offset, limit, isAdmin: admin, actor }` — additive.

- [ ] **Step 2: Verify + commit** — `npx tsc --noEmit`, relevant API suites green. `feat(ad-approval): list API resolves display names and campaign labels`.

---

### Task 5: Detail page — stepper + timeline + names

**Files:**
- Modify: `app/(embedded)/(ad-pilot)/ad-approvals/[id]/page.tsx`

- [ ] **Step 1: Read the page top-to-bottom first** (10.2K — component state, the fetch call, the `Page` header at ~line 125, the Reviews section at ~line 228, Revisions at ~line 264). Then:

1. Extend the page's approval-payload type with `names: Record<string, string>` and `timeline: Array<{ at: string; actor: string; kind: string; summary: string }>` (both optional-safe: `?? {}` / `?? []` so the page renders against a not-yet-updated API during rollout).
2. **Stepper** directly under the `Page` header (first element in the main `Layout.Section`): compute `stageProgress(a.status, a.stage)` client-side (import from `@/lib/ad-approval/stage-progress` — it's pure and isomorphic) and render the steps generically:

```tsx
<Card>
  <InlineStack gap="200" wrap>
    {stageProgress(a.status, a.stage).steps.map((s) => (
      <InlineStack key={s.key} gap="100" blockAlign="center">
        <Badge tone={s.state === "done" ? "success" : s.state === "current" ? "info" : s.state === "blocked" ? "critical" : undefined}>
          {s.label}
        </Badge>
        {s.key !== "approved" && <Text as="span" tone="subdued">›</Text>}
      </InlineStack>
    ))}
  </InlineStack>
</Card>
```

(Adapt the separator condition to "not the last element" rather than a hardcoded key if simpler — the Phase 7 rule is: never hardcode the step count or final key.)
3. **Timeline card** (new section, placed above the existing Reviews card; keep Reviews and Revisions cards as-is — they show full detail, the timeline is the chronological digest): render `timeline` entries as rows — `timeAgo(entry.at)` (from `@/lib/format`), actor, summary, with a small kind Badge. Empty state: subdued "No activity yet".
4. **Names**: in the subtitle line, show the submitter as `names[a.submitterId] ?? a.submitterId`; where assigned reviewer ids render (if anywhere on this page), apply the same map.

- [ ] **Step 2: Verify + commit** — `npx tsc --noEmit`, `npm run build` clean. `feat(ad-approval): stepper + unified timeline + human names on the detail page`.

---

### Task 6: List page names, ROUTER, final gate

**Files:**
- Modify: `app/(embedded)/(ad-pilot)/ad-approvals/page.tsx`, `.mex/ROUTER.md`

- [ ] **Step 1: List page** — read the row-rendering block first. Extend the local type with `names`/`campaignLabel`; render `campaignLabel` where `campaignId` displays today, and submitter/assignee ids through the `names` map with raw-id fallback. No layout restructuring.

- [ ] **Step 2: `.mex/ROUTER.md`** — Current Project State bullet (bump `last_updated`): stageProgress (7 steps, Phase 7 appends `launched`), buildApprovalTimeline (three merged sources), names maps on both APIs (AppUser join, raw-id fallback), campaignLabel meta-snapshot enrichment; state machine untouched.

- [ ] **Step 3: Final gate + push**

Run: `npx tsc --noEmit`, `npm test` (record counts), `npm run build` — clean/green.

```bash
git add "app/(embedded)/(ad-pilot)/ad-approvals/page.tsx" .mex/ROUTER.md
git commit -m "feat(ad-approval): human names on the list page; docs(mex): Phase 5 state"
git push origin main
```

Acceptance (from the roadmap, all verifiable in tests + build): the detail page shows where an ad sits and what's next (stepper renders for every one of the 15 statuses — guaranteed by Task 1's exhaustive test); the list shows names not ids; stepper states unit-tested for all statuses.

---

## Self-review notes

- Roadmap coverage: stepper via pure `stageProgress` in the exact file the roadmap named, unit-tested against all statuses **programmatically** (`Object.values(STATUS) × Object.values(STAGE)`) so future status additions fail loudly (Task 1); unified timeline merged server-side in the detail route from the three named sources (Tasks 2–3); list API AppUser join with raw-id fallback + `campaignLabel` verbatim-with-meta-name-enrichment (Task 4); UI on both pages (Tasks 5–6). ✔
- Contradictions documented in Architecture: reviewerName already denormalized; campaignId already the title; `stageProgress` needs the `stage` argument; AppUser directory already populated by `captureAppUser`.
- Phase 7 forward-compat is a stated constraint (stable keys, generic rendering, no hardcoded step count) and appears at both the type definition and the UI step.
- No placeholders: full code for the two pure modules and the stepper render; the four read-before-edit spots (detail GET handler, meta payload campaigns shape, detail page structure, list row block) name exactly what to look for and where.
- Type consistency: `StepState`/`StepKey` shapes identical across module, test, and UI; `TimelineEntry` identical across module, route response, and page type; `names` fallback rule stated once and reused verbatim in Tasks 3, 4, 5, 6.
- Boundaries held: read-only phase (no state-machine edits, no external writes, no migration); Keyword Planner surface untouched by every task.
