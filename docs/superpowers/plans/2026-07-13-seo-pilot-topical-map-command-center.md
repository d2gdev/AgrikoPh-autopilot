# SEO Pilot Topical Map Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active topical map the sole strategy authority and complete operating model for SEO Pilot, while removing the June strategy and preserving operator-controlled execution.

**Architecture:** Add a server-only projection that turns immutable compiled rules into a bounded command-center model, then join that model with current site/search observations for map-aware analysis and actions. SEO Pilot consumes one active strategy identity across overview, page ownership, gaps, link/technical work, and governed actions; cached analysis is usable only for that exact strategy version and package hash.

**Tech Stack:** Next.js App Router, React, TypeScript, Shopify Polaris, Prisma/PostgreSQL, Zod, Vitest.

## Global Constraints

- The active validated strategy package is the only strategy authority shown or used by SEO Pilot.
- Remove the June strategy completely; do not retain an archive view or fallback.
- Represent all eleven rule domains: `clusters`, `page_roles`, `url_intent_ownership`, `content_decisions`, `prohibited_content`, `internal_links`, `redirects`, `canonicalization`, `indexation`, `evidence_gates`, and `high_stakes_reviews`.
- Every map-derived action identifies the strategy version and applicable rule IDs.
- Older analysis becomes unavailable immediately when active strategy identity changes.
- Live changes still require approved status and `EXECUTE_APPROVED_LIVE_ENABLED=true`.
- Canonical/indexation live execution remains prohibited by the active contract.
- Every embedded API route calls `await requireAppAuth(req)` as its first statement.
- All database access uses `import { prisma } from "@/lib/db"`.
- No raw strategy artifact bytes are exposed to the client.
- Preserve existing proposal normalization, compliance, idempotency, and approval paths.

## File structure

- Create `lib/topical-map/command-center.ts`: pure rule-to-view-model projection and map/observation joins.
- Create `app/api/topical-map/command-center/route.ts`: authenticated active-map projection endpoint.
- Create `app/(embedded)/(seo-pillar)/seo-pillar/components/map-types.ts`: client-facing command-center and freshness types.
- Create focused panels under `components/panels/`: `MapOverviewPanel.tsx`, `MapPagesPanel.tsx`, and `MapWorkPanel.tsx`.
- Modify `lib/seo/analysis.ts` and SEO analysis routes to create strategy-bound analysis.
- Modify `useSeoData.ts`, `types.ts`, navigation, and `page.tsx` to make the command center the surface model.
- Remove `StrategyPanel.tsx` and delete `lib/seo/keyword-strategy.ts` once repository-wide imports are zero.

---

### Task 1: Project all compiled map domains into one bounded command-center model

**Files:**
- Create: `lib/topical-map/command-center.ts`
- Test: `__tests__/lib/topical-map/command-center.test.ts`

**Interfaces:**
- Consumes: stored active version fields and compiled rules shaped as `{ ruleId, ruleType, payload, sourceArtifactId, sourceReferences }`.
- Produces: `projectTopicalMapCommandCenter(input): TopicalMapCommandCenter` and exported command-center types.

- [ ] **Step 1: Write failing projection tests**

Cover a fixture containing at least one rule from each of the eleven domains. Assert strategy identity, domain counts, cluster membership, merged per-URL ownership/role/decision data, prohibited items, link/redirect/technical work, evidence/review blockers, and rule provenance. Assert that unknown payload fields and raw artifact content do not appear in serialized output.

```ts
const projected = projectTopicalMapCommandCenter({
  strategy: { id: "v3", strategyVersion: "2026-07-12", contractRevision: "3", packageSha256: "abc", activatedAt: new Date("2026-07-12T00:00:00Z") },
  rules: rulesForAllElevenDomains,
});
expect(projected.identity).toMatchObject({ versionId: "v3", contractRevision: "3", packageSha256: "abc" });
expect(Object.keys(projected.domainCounts).sort()).toEqual(ALL_TOPICAL_MAP_DOMAINS.slice().sort());
expect(projected.pages[0]).toMatchObject({ url: "/blogs/news/black-rice", cluster: "Black rice", role: "supporting", dominantIntent: "informational" });
expect(projected.work.internalLinks[0].ruleIds).toEqual(["rule:link:1"]);
expect(JSON.stringify(projected)).not.toContain("rawContent");
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- __tests__/lib/topical-map/command-center.test.ts`

Expected: FAIL because `@/lib/topical-map/command-center` does not exist.

- [ ] **Step 3: Implement strict projection types and deterministic reducers**

Define the domain tuple and output types, validate each domain payload by selecting only contract-approved fields, normalize URLs with the existing topical-map URL normalizer, merge URL rules by normalized URL, and sort every collection deterministically by priority then URL/rule ID.

```ts
export const ALL_TOPICAL_MAP_DOMAINS = [
  "clusters", "page_roles", "url_intent_ownership", "content_decisions",
  "prohibited_content", "internal_links", "redirects", "canonicalization",
  "indexation", "evidence_gates", "high_stakes_reviews",
] as const;

export function projectTopicalMapCommandCenter(input: ProjectionInput): TopicalMapCommandCenter {
  const domainCounts = Object.fromEntries(ALL_TOPICAL_MAP_DOMAINS.map((domain) => [domain, 0])) as DomainCounts;
  for (const rule of input.rules) domainCounts[assertDomain(rule.ruleType)] += 1;
  return {
    identity: toIdentity(input.strategy),
    domainCounts,
    clusters: projectClusters(input.rules),
    pages: projectPages(input.rules),
    prohibited: projectProhibited(input.rules),
    work: projectWork(input.rules),
    blockers: projectBlockers(input.rules),
  };
}
```

- [ ] **Step 4: Run focused and existing topical-map tests**

Run: `npm test -- __tests__/lib/topical-map/command-center.test.ts __tests__/lib/topical-map/evaluator.test.ts __tests__/lib/topical-map/contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the projection**

```bash
git add lib/topical-map/command-center.ts __tests__/lib/topical-map/command-center.test.ts
git commit -m "feat(topical-map): project command center model"
```

### Task 2: Expose the active command-center model through an authenticated API

**Files:**
- Create: `app/api/topical-map/command-center/route.ts`
- Test: `__tests__/api/topical-map-command-center-route.test.ts`

**Interfaces:**
- Consumes: `projectTopicalMapCommandCenter` from Task 1 and Prisma active-version relations.
- Produces: `GET /api/topical-map/command-center` returning `{ state, generatedAt, commandCenter }`.

- [ ] **Step 1: Write failing route tests**

Assert `requireAppAuth` is the first operation, unauthenticated requests stop before Prisma, no active map returns `{ state: "no_active_strategy", commandCenter: null }`, database failure returns a bounded 500 response, and an active map returns all eleven domain counts without artifacts/raw bytes.

```ts
expect(await response.json()).toEqual({
  state: "ready",
  generatedAt: expect.any(String),
  commandCenter: expect.objectContaining({ identity: expect.objectContaining({ versionId: "v3" }) }),
});
expect(prisma.topicalMapStrategyVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }));
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- __tests__/api/topical-map-command-center-route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the authenticated route**

Use one Prisma query selecting only identity and compiled-rule projection fields. Keep `await requireAppAuth(req)` as the first statement and return `Cache-Control: private, no-store`.

```ts
export async function GET(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const active = await prisma.topicalMapStrategyVersion.findFirst({
    where: { active: true },
    select: { id: true, strategyVersion: true, contractRevision: true, packageSha256: true, activatedAt: true,
      compiledRules: { select: { ruleId: true, ruleType: true, payload: true, sourceArtifactId: true, sourceReferences: true } } },
  });
  if (!active) return NextResponse.json({ state: "no_active_strategy", generatedAt: new Date().toISOString(), commandCenter: null });
  return NextResponse.json({ state: "ready", generatedAt: new Date().toISOString(), commandCenter: projectTopicalMapCommandCenter({ strategy: active, rules: active.compiledRules }) });
}
```

- [ ] **Step 4: Run API and projection tests**

Run: `npm test -- __tests__/api/topical-map-command-center-route.test.ts __tests__/lib/topical-map/command-center.test.ts __tests__/api/topical-map-routes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the API**

```bash
git add app/api/topical-map/command-center/route.ts __tests__/api/topical-map-command-center-route.test.ts
git commit -m "feat(api): expose active topical map command center"
```

### Task 3: Bind SEO analysis and gaps to the active strategy identity

**Files:**
- Modify: `lib/seo/analysis.ts`
- Modify: `app/api/seo/analyze/route.ts`
- Modify: `app/api/seo/analysis/route.ts`
- Modify: `app/api/seo/gaps/promote/route.ts`
- Test: `__tests__/lib/seo/analysis.test.ts`
- Test: `__tests__/api/seo-pilot-routes.test.ts`

**Interfaces:**
- Consumes: active command-center pages/work plus current GSC/article observations.
- Produces: `buildMapAwareSeoGaps(input)`, strategy-bound analysis payloads, and promotion requests containing `strategyVersionId` and `ruleIds`.

- [ ] **Step 1: Write failing freshness and map-join tests**

Assert an unmapped high-impression query is an observation but not a governed content proposal; a missing mapped page becomes a content gap with rule IDs; a required absent link becomes a link gap; prohibited content is suppressed with its reason; and cached analysis is returned only when both strategy version ID and package hash match the active map.

```ts
expect(buildMapAwareSeoGaps(input)).toContainEqual(expect.objectContaining({
  kind: "content", strategyVersionId: "v3", ruleIds: ["rule:decision:1"], state: "candidate",
}));
expect(readAnalysisForStrategy(staleSnapshot, activeIdentity)).toBeNull();
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- __tests__/lib/seo/analysis.test.ts __tests__/api/seo-pilot-routes.test.ts`

Expected: FAIL on missing strategy identity and map-aware gap behavior.

- [ ] **Step 3: Implement the map-aware join and versioned snapshot envelope**

Persist a payload envelope rather than relying on the timeless snapshot row identity. The existing upsert key can remain; correctness comes from rejecting mismatched envelope identity.

```ts
interface StrategyBoundAnalysisEnvelope {
  schemaVersion: "2";
  strategy: { versionId: string; packageSha256: string };
  generatedAt: string;
  analysis: MapAwareSeoAnalysis;
}

export function readAnalysisForStrategy(payload: unknown, active: StrategyIdentity) {
  const parsed = StrategyBoundAnalysisEnvelopeSchema.safeParse(payload);
  return parsed.success && parsed.data.strategy.versionId === active.versionId && parsed.data.strategy.packageSha256 === active.packageSha256
    ? parsed.data.analysis
    : null;
}
```

Use map page decisions, ownership, prohibited rules, and required links as the candidate boundary. Preserve raw GSC opportunities separately in the response as observations.

- [ ] **Step 4: Require governed context during gap promotion**

Extend the promotion body schema with exact strategy identity and rule IDs; reload the active policy server-side, reject `409 STRATEGY_CHANGED` on identity mismatch, and pass the normalized candidate through the existing topical-map evaluator and proposal creation path.

```ts
const PromotionSchema = z.object({
  strategyVersionId: z.string().min(1),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  gaps: z.array(MapGapSchema.extend({ ruleIds: z.array(z.string().min(1)).min(1) })).min(1),
}).strict();
```

- [ ] **Step 5: Run analysis, route, evaluator, and proposal tests**

Run: `npm test -- __tests__/lib/seo/analysis.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/lib/topical-map/proposal-integration.test.ts __tests__/lib/content-pilot/create-proposal.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit map-bound analysis and promotion**

```bash
git add lib/seo/analysis.ts app/api/seo/analyze/route.ts app/api/seo/analysis/route.ts app/api/seo/gaps/promote/route.ts __tests__/lib/seo/analysis.test.ts __tests__/api/seo-pilot-routes.test.ts
git commit -m "feat(seo): bind analysis to active topical map"
```

### Task 4: Load one coherent active-map state in SEO Pilot

**Files:**
- Create: `app/(embedded)/(seo-pillar)/seo-pillar/components/map-types.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/useSeoData.ts`
- Test: `__tests__/components/use-seo-data.test.ts`

**Interfaces:**
- Consumes: `/api/topical-map/command-center`, `/api/seo/analysis`, and existing raw analytics endpoints.
- Produces: `mapState`, `mapAnalysisState`, `reloadCommandCenter`, and explicit loading/no-map/stale/error/empty states.

- [ ] **Step 1: Write failing hook/helper tests**

Assert command-center identity is loaded before cached analysis is accepted, mismatched analysis becomes `stale`, no active map is not treated as empty findings, refresh reloads map identity before analysis, and a governance API failure does not render old strategy data.

```ts
expect(resolveMapAnalysisState({ active: identityV3, envelope: envelopeV2 })).toEqual({ state: "stale", analysis: null });
expect(resolveMapAnalysisState({ active: identityV3, envelope: envelopeV3 })).toEqual({ state: "ready", analysis: envelopeV3.analysis });
```

- [ ] **Step 2: Run the hook test and verify failure**

Run: `npm test -- __tests__/components/use-seo-data.test.ts`

Expected: FAIL because map-state helpers do not exist.

- [ ] **Step 3: Define client-safe types and implement ordered loading**

Fetch core analytics and the command center concurrently, but resolve cached analysis only after command-center identity is known. Remove the old package-only state as the Strategy tab data source; lifecycle metadata may remain as a nested governance detail.

```ts
export type MapLoadState =
  | { state: "loading" }
  | { state: "no_active_strategy" }
  | { state: "error"; message: string }
  | { state: "ready"; generatedAt: string; commandCenter: TopicalMapCommandCenter };
```

- [ ] **Step 4: Run hook and responsive tests**

Run: `npm test -- __tests__/components/use-seo-data.test.ts __tests__/components/seo-pilot-responsive.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit client state integration**

```bash
git add 'app/(embedded)/(seo-pillar)/seo-pillar/components/map-types.ts' 'app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts' 'app/(embedded)/(seo-pillar)/seo-pillar/components/useSeoData.ts' __tests__/components/use-seo-data.test.ts
git commit -m "feat(seo-ui): load active map command center state"
```

### Task 5: Rebuild SEO Pilot around overview, pages, gaps, and governed work

**Files:**
- Create: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/MapOverviewPanel.tsx`
- Create: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/MapPagesPanel.tsx`
- Create: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/MapWorkPanel.tsx`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/ContentGapsPanel.tsx`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OpportunitiesPanel.tsx`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/SeoPilotNavigation.tsx`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/seo-pilot-responsive.module.css`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx`
- Test: `__tests__/components/topical-map-strategy-panel.test.ts`
- Test: `__tests__/components/seo-pilot-responsive.test.ts`

**Interfaces:**
- Consumes: Task 4 `MapLoadState` and map-bound analysis.
- Produces: accessible command-center navigation and panels with filters and governed proposal callbacks.

- [ ] **Step 1: Write failing structural and behavior tests**

Assert navigation exposes `Map overview`, `Pages & ownership`, `Content gaps`, `Links & technical`, and `Search evidence`; the overview labels the active package; each of eleven domains appears in an intentional section; filters have labels; rule provenance is expandable; canonical/indexation rows say live execution is prohibited; and all five distinct empty/error states render distinct copy.

```ts
expect(source).toContain('label: "Map overview"');
expect(source).toContain('label: "Pages & ownership"');
expect(source).toContain('label: "Links & technical"');
expect(source).not.toContain("June 2026 keyword research report");
```

- [ ] **Step 2: Run component tests and verify failure**

Run: `npm test -- __tests__/components/topical-map-strategy-panel.test.ts __tests__/components/seo-pilot-responsive.test.ts`

Expected: FAIL on missing command-center panels and legacy copy.

- [ ] **Step 3: Implement the map overview and page ownership worklist**

Use Polaris `IndexTable`/`DataTable` patterns for repeated rule data, one identity/health band, explicit totals, and filters for cluster, priority, rule family, state, and blocker. Use progressive disclosure for rule IDs and source references. Do not nest cards inside cards.

- [ ] **Step 4: Implement map-derived gaps and technical queues**

Content gaps must render map requirement, observed evidence, priority, rule provenance, and permitted action. Work queues group internal links, redirects, canonicalization, and indexation while showing evidence/review blockers and current lifecycle state.

- [ ] **Step 5: Keep raw search evidence separate**

Relabel generic GSC opportunities as observations. Their action is disabled until a map rule association exists; the UI explains that ungoverned evidence can inform a future map revision but cannot silently become strategy.

- [ ] **Step 6: Implement responsive and accessibility behavior**

Use a responsive table-to-list treatment under the existing breakpoint, avoid horizontal page overflow, retain keyboard-accessible filters/disclosure/actions, include visible focus, and never encode status by color alone.

- [ ] **Step 7: Run focused UI tests**

Run: `npm test -- __tests__/components/topical-map-strategy-panel.test.ts __tests__/components/seo-pilot-responsive.test.ts __tests__/components/use-seo-data.test.ts __tests__/a11y/no-raw-hex.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the command-center UI**

```bash
git add 'app/(embedded)/(seo-pillar)/seo-pillar' __tests__/components/topical-map-strategy-panel.test.ts __tests__/components/seo-pilot-responsive.test.ts
git commit -m "feat(seo-ui): make topical map the pilot command center"
```

### Task 6: Delete the June strategy and close every fallback path

**Files:**
- Delete: `lib/seo/keyword-strategy.ts`
- Delete: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/StrategyPanel.tsx`
- Modify: any remaining runtime importer found by `rg`
- Test: `__tests__/components/topical-map-strategy-panel.test.ts`

**Interfaces:**
- Consumes: command-center panels from Task 5.
- Produces: zero runtime references to June constants/copy and a regression test enforcing that boundary.

- [ ] **Step 1: Add a failing repository-level legacy scan**

```ts
const forbidden = ["KEYWORD_CLUSTERS", "PRIMARY_TARGETS", "SECONDARY_BANK", "ROADMAP", "June 2026 keyword research report"];
for (const token of forbidden) expect(runtimeSeoSources.join("\n")).not.toContain(token);
```

- [ ] **Step 2: Run the regression test and verify failure**

Run: `npm test -- __tests__/components/topical-map-strategy-panel.test.ts`

Expected: FAIL while legacy files/imports exist.

- [ ] **Step 3: Remove legacy modules, handlers, state, and copy**

Delete the static strategy module and Strategy panel. Remove tracking/planning handlers that existed only for static strategy rows; keep general keyword tracking only where it is driven by observed keywords or explicit operator input.

- [ ] **Step 4: Prove no fallback remains**

Run: `rg -n 'KEYWORD_CLUSTERS|PRIMARY_TARGETS|SECONDARY_BANK|ROADMAP|June 2026 keyword research report|keyword-strategy' app lib __tests__`

Expected: no runtime hits; only the regression test's forbidden-token declarations may match.

- [ ] **Step 5: Run the SEO Pilot suite**

Run: `npm test -- __tests__/components/topical-map-strategy-panel.test.ts __tests__/components/use-seo-data.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/lib/seo/analysis.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit legacy removal**

```bash
git add -A lib/seo/keyword-strategy.ts 'app/(embedded)/(seo-pillar)/seo-pillar' __tests__/components/topical-map-strategy-panel.test.ts
git commit -m "refactor(seo): remove legacy June strategy"
```

### Task 7: Full verification, GROW record, and production deployment

**Files:**
- Modify: `.mex/ROUTER.md`
- Modify: relevant `.mex/context/` topical-map and SEO Pilot files discovered through the router
- Create or modify: relevant `.mex/patterns/` runbook for strategy-bound analysis/UI freshness
- Modify: deployment evidence document selected by the router

**Interfaces:**
- Consumes: completed Tasks 1–6.
- Produces: verified build, durable operational record, and deployed production evidence.

- [ ] **Step 1: Run all focused tests and static gates**

```bash
npm test -- __tests__/lib/topical-map/command-center.test.ts __tests__/api/topical-map-command-center-route.test.ts __tests__/lib/seo/analysis.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/components/use-seo-data.test.ts __tests__/components/topical-map-strategy-panel.test.ts __tests__/components/seo-pilot-responsive.test.ts __tests__/lib/topical-map/proposal-integration.test.ts
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: PASS with no unrelated regression.

- [ ] **Step 3: Perform authenticated local workflow verification**

Verify the active identity matches the API response, each command-center section loads, stale analysis is rejected, a permitted map-derived proposal records rule context, an ungoverned observation cannot promote, and canonical/indexation items cannot execute live.

- [ ] **Step 4: Record GROW context**

Update the router/context/runbook with actual changed files, test/build evidence, analysis freshness contract, legacy removal proof, and proposal-control behavior. Bump `last_updated` and run `mex log` when rationale is required.

- [ ] **Step 5: Commit the operational record**

```bash
git add .mex docs
git commit -m "docs(seo): record topical map command center"
```

- [ ] **Step 6: Deploy using the repository's existing production workflow**

Deploy the verified main commit without changing environment authorization flags or running unrelated data cleanup. Restart the production PM2 process only through the established deployment workflow.

- [ ] **Step 7: Verify fresh production evidence**

Confirm all required gates independently:

1. server `HEAD` equals the intended main commit;
2. active Next.js build artifact was produced from that commit;
3. PM2 process restarted after the build and is healthy;
4. public health endpoint returns healthy;
5. authenticated command-center API reports active version `cmriak0gt00y8s66lxrfkstp6` unless a newer authorized activation occurred;
6. rendered SEO Pilot contains no June strategy copy;
7. all eleven domain counts are present;
8. stale pre-map analysis is absent;
9. no live Shopify change occurred as part of UI verification.

- [ ] **Step 8: Record deployment evidence and commit/persist it through the established production record**

Expected: deployment evidence names the server commit, build identity, PM2 restart timestamp, endpoint result, active map identity, and legacy-content absence.

## Self-review

- Spec coverage: all eleven domains, identity/provenance, page ownership, map-aware gaps, action governance, lifecycle state, freshness, June removal, UI states, security boundaries, accessibility/responsiveness, GROW, and production verification are assigned to explicit tasks.
- Placeholder scan: every task names concrete behavior, files, commands, and expected results; no unresolved implementation markers remain.
- Type consistency: `TopicalMapCommandCenter`, `StrategyIdentity`, `MapLoadState`, strategy envelope identity, and rule-ID promotion context are introduced before their consumers.
