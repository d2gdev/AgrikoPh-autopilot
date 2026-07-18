# Content Pilot Exact Topical-Map Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Content Pilot suggestion originate from an exact URL and permitted decision in the active topical map.

**Architecture:** Reuse the existing strategy-bound `seo_analysis` snapshot as the suggestion authority. Content Pilot will project actionable content candidates and mapped research-only suppressions from that snapshot, while its automatic proposal generator receives a final exact-map filter before persistence.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, Zod, Shopify Polaris, Vitest.

## Global Constraints

- Never invent a topic, title, or URL from raw GSC queries in Content Pilot.
- Actionable suggestions require an exact active-map URL and currently actionable content decision.
- Mapped gated items are research-only and cannot be drafted, approved, or published.
- Keep all existing proposal approval and Shopify publishing safeguards unchanged.
- No schema change, new planning subsystem, topical-map revision, deployment, or unrelated refactor.
- Use `import { prisma } from "@/lib/db"` for database access.
- Every embedded API handler must call `await requireAppAuth(req)` first.

---

### Task 1: Gate automatic proposals against exact map decisions

**Files:**
- Create: `lib/content-pilot/exact-map-suggestions.ts`
- Modify: `lib/content-pilot/generate-proposals.ts`
- Modify: `app/api/content-pilot/proposals/generate/route.ts`
- Modify: `app/api/cron/daily/route.ts`
- Modify: `lib/opportunities/generate.ts`
- Test: `__tests__/lib/content-pilot/exact-map-suggestions.test.ts`

**Interfaces:**
- Consumes: `loadActiveTopicalMapCommandCenter(prismaClient)` and raw `ProposalInput[]`.
- Produces:

```ts
export async function generateExactMapProposals(
  prismaClient: PrismaClient,
): Promise<ProposalInput[]>;
```

- [ ] **Step 1: Write focused failing tests**

Cover four exact outcomes:

```ts
expect(filterExactMapProposals([mappedRefresh], commandCenter))
  .toEqual([expect.objectContaining({
    sourceData: expect.objectContaining({
      strategyVersionId: "strategy-1",
      packageSha256: "a".repeat(64),
      targetUrl: "/blogs/news/rice-guide",
      ruleIds: ["content-rule-1"],
    }),
  })]);

expect(filterExactMapProposals([unmappedNewArticle], commandCenter)).toEqual([]);
expect(filterExactMapProposals([mappedManualGate], commandCenter)).toEqual([]);
expect(filterExactMapProposals([mappedKeepOnly], commandCenter)).toEqual([]);
```

- [ ] **Step 2: Run the new test and confirm failure**

Run:

```bash
npx vitest run __tests__/lib/content-pilot/exact-map-suggestions.test.ts
```

Expected: failure because the exact-map filter does not exist.

- [ ] **Step 3: Implement one pure filter and one loading wrapper**

The pure filter must:

```ts
export function filterExactMapProposals(
  proposals: ProposalInput[],
  commandCenter: TopicalMapCommandCenter | null,
): ProposalInput[] {
  if (!commandCenter) return [];
  // Require exact candidate URL or exact internal-link pair.
  // Require topicalMapActionEligibility(...).actionable.
  // Require an explicit matching create/refresh/metadata/link instruction.
  // Reject prohibited, keep-only, conditional, manual-gate, activation-blocking,
  // stale, unmapped, and handle-less generic new-content candidates.
  // Attach strategy identity, exact target URL, rule IDs, mapped title,
  // intent, decision, and priority to sourceData.
}
```

`generateExactMapProposals()` loads the active command center, calls the existing raw generator, and returns the filtered result. Do not change proposal persistence or approval logic.

- [ ] **Step 4: Route all automatic Content Pilot generation through the wrapper**

Replace direct `generateProposals(...)` calls in the three production call sites with `generateExactMapProposals(...)`. Retain `generateProposals()` as the raw finding builder for its existing focused tests.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run \
  __tests__/lib/content-pilot/exact-map-suggestions.test.ts \
  __tests__/lib/content-pilot/generate-proposals.test.ts \
  __tests__/lib/content-pilot/proposal-eligibility.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/content-pilot/exact-map-suggestions.ts \
  lib/content-pilot/generate-proposals.ts \
  app/api/content-pilot/proposals/generate/route.ts \
  app/api/cron/daily/route.ts \
  lib/opportunities/generate.ts \
  __tests__/lib/content-pilot/exact-map-suggestions.test.ts
git commit -m "fix(content): gate suggestions to exact topical map"
```

### Task 2: Replace free-form Brief suggestions with mapped work

**Files:**
- Create: `app/api/content-pilot/map-suggestions/route.ts`
- Modify: `app/api/content-pilot/brief/route.ts`
- Modify: `app/(embedded)/(content-pilot)/content-pilot/components/BriefTab.tsx`
- Modify: `app/(embedded)/(content-pilot)/content-pilot/page.tsx`
- Modify: `app/(embedded)/(content-pilot)/content-pilot/components/types.ts`
- Test: `__tests__/api/content-pilot-map-suggestions-route.test.ts`
- Test: `__tests__/api/content-pilot-brief-route.test.ts`
- Test: `__tests__/components/content-pilot-brief-tab.test.ts`

**Interfaces:**
- `GET /api/content-pilot/map-suggestions` returns:

```ts
type ContentPilotMapSuggestions = {
  strategy: {
    versionId: string;
    packageSha256: string;
    analysisGeneratedAt: string;
  };
  actionable: Array<{
    candidateId: string;
    targetUrl: string;
    title: string;
    action: "create" | "refresh";
    priority: string;
    decision: string;
    ruleIds: string[];
  }>;
  research: Array<{
    targetUrl: string;
    title: string;
    priority: string;
    decision: string;
    reason: string;
    ruleIds: string[];
  }>;
};
```

- `POST /api/content-pilot/brief` accepts only:

```ts
{
  strategyVersionId: string;
  packageSha256: string;
  analysisGeneratedAt: string;
  candidateId: string;
}
```

- [ ] **Step 1: Write route and UI contract tests**

Prove that:

```ts
expect(body.actionable[0].targetUrl).toBe("/blogs/news/rice-guide");
expect(body.research[0].reason).toBe("manual_gate");
expect(body).not.toHaveProperty("unmappedQueries");
expect(await POST(freeFormTopicRequest)).toHaveProperty("status", 400);
```

The UI source test must verify that the custom-topic input and computed cluster chips are absent, actionable items can request a brief, and research items expose no brief/proposal action.

- [ ] **Step 2: Run the three focused test files and confirm failure**

Run:

```bash
npx vitest run \
  __tests__/api/content-pilot-map-suggestions-route.test.ts \
  __tests__/api/content-pilot-brief-route.test.ts \
  __tests__/components/content-pilot-brief-tab.test.ts
```

Expected: failure because the mapped route and strict UI do not exist.

- [ ] **Step 3: Implement the authenticated read route**

The route must call `await requireAppAuth(req)` first, load the active command center and latest `seo_analysis` snapshot, require matching active strategy identity, and use `analysisEvidenceState()` plus `readAnalysisForStrategy()`.

Only `analysis.gaps` where `kind === "content"` enter `actionable`. Only exact command-center pages joined to content-related `analysis.suppressed` rows enter `research`. Return `409` with a bounded message when strategy-bound analysis is unavailable or stale.

- [ ] **Step 4: Bind brief generation to one current candidate**

Replace free-form `topic` input with the strict candidate identity. Re-read the same snapshot and active command center server-side, reject stale or unknown candidates with `409`, and build the AI prompt from the mapped title, target keyword, URL, decision, secondary variants, and observed evidence.

No operator text or generic GSC list may select the subject.

- [ ] **Step 5: Simplify the Brief tab**

The tab loads `/api/content-pilot/map-suggestions` and renders:

- “Mapped content work” with brief actions for actionable candidates;
- “Mapped research only” with the gate reason and no mutation action.

“Send to Queue” posts the selected `candidateId` and exact strategy identity to the existing `/api/seo/gaps/promote-selected` endpoint. Remove custom topic entry, generic cluster chips, blog selection, and `/api/content-pilot/proposals/manual` usage from this screen.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx vitest run \
  __tests__/api/content-pilot-map-suggestions-route.test.ts \
  __tests__/api/content-pilot-brief-route.test.ts \
  __tests__/components/content-pilot-brief-tab.test.ts \
  __tests__/api/seo-pilot-routes.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/api/content-pilot/map-suggestions/route.ts \
  app/api/content-pilot/brief/route.ts \
  app/'(embedded)'/'(content-pilot)'/content-pilot/components/BriefTab.tsx \
  app/'(embedded)'/'(content-pilot)'/content-pilot/page.tsx \
  app/'(embedded)'/'(content-pilot)'/content-pilot/components/types.ts \
  __tests__/api/content-pilot-map-suggestions-route.test.ts \
  __tests__/api/content-pilot-brief-route.test.ts \
  __tests__/components/content-pilot-brief-tab.test.ts
git commit -m "feat(content): show exact-map content work"
```

### Task 3: Verify the bounded change

**Files:**
- Modify: `.mex/ROUTER.md`
- Modify: `.mex/events/decisions.jsonl`

- [ ] **Step 1: Run one proportional verification pass**

Run:

```bash
npx vitest run \
  __tests__/lib/content-pilot/exact-map-suggestions.test.ts \
  __tests__/lib/content-pilot/generate-proposals.test.ts \
  __tests__/lib/content-pilot/proposal-eligibility.test.ts \
  __tests__/api/content-pilot-map-suggestions-route.test.ts \
  __tests__/api/content-pilot-brief-route.test.ts \
  __tests__/components/content-pilot-brief-tab.test.ts \
  __tests__/api/seo-pilot-routes.test.ts
npx tsc --noEmit --incremental false
npm run lint
git diff --check
```

Expected: all focused tests, typecheck, lint, and diff hygiene pass.

- [ ] **Step 2: Record reality**

Update `.mex/ROUTER.md` with only the verified behavior and run:

```bash
mex log --type decision "Content Pilot suggestions now require exact active topical-map URLs and decisions; mapped gated items remain research-only."
```

- [ ] **Step 3: Commit the evidence record**

```bash
git add .mex/ROUTER.md .mex/events/decisions.jsonl
git commit -m "docs: record exact-map content suggestions"
```
