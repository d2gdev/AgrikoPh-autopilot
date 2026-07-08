# Organic Skill Source Independence And Prioritization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SEO, keyword, content, and market-intelligence skills run from their own required data sources instead of Meta, fetch missing required organic data once per run when possible, and rank organic work by deterministic value, confidence, and effort.

**Architecture:** Add a source registry for organic skill data, extend skill metadata with required/optional source contracts, and refactor `run-skills` to select a base evidence snapshot per skill. Add a shared organic prioritization scorer, then reuse it from Content Pilot and Opportunities so the operator sees higher-value organic work first.

**Tech Stack:** Next.js job handlers, TypeScript, Prisma/PostgreSQL, RawSnapshot evidence rows, markdown skill frontmatter, Vitest tests.

## Global Constraints

- Do not change live ad execution behavior.
- Do not add Google Ads campaign management or writes; Google Ads remains keyword-research-only.
- Do not attach organic skill output to a Meta snapshot for convenience.
- Use `import { prisma } from "@/lib/db"` for database access.
- Keep missing required data visible in `JobRun.summary`; do not silently collapse it into zero recommendations.
- Keep refresh attempts bounded: each missing or stale required source may be refreshed at most once per `run-skills` execution.
- Preserve existing skill hash behavior: deterministic pre-AI input fingerprint, deferred hash preservation, failed/truncated hash removal.
- Prefer deterministic TypeScript scoring over LLM-provided priority for the first prioritization pass.
- Runtime source availability and skill payloads must use real persisted connector data from PostgreSQL (`RawSnapshot`, `KeywordResearchResult`, `ArticleSnapshot`, `MarketInsight`, etc.). Mocks are acceptable only in unit tests.
- Before completion, run or add a real-data verification that reads the configured database and proves organic source statuses/base snapshots come from real rows, not mocked fixtures.
- No schema migration unless implementation proves the existing `RawSnapshot`, `JobRun.summary`, `Opportunity`, and `ContentProposal` fields are insufficient.

---

## File Structure

### New Files

- `lib/skills/source-registry.ts`
  - Owns source ids, source status checks, bounded refresh dispatch, and base snapshot selection for organic skill data.
- `lib/organic/prioritization.ts`
  - Owns deterministic scoring for organic opportunities and converts numeric score into P0-P3, impact, and effort.
- `__tests__/lib/skills/source-registry.test.ts`
  - Tests source status checks, refresh fan-out, and base snapshot selection.
- `__tests__/jobs/run-skills-source-requirements.test.ts`
  - Tests SEO/keyword skills running without Meta and missing-source diagnostics.
- `__tests__/lib/organic/prioritization.test.ts`
  - Tests scoring behavior independently from proposal generation.

### Modified Files

- `lib/skills/loader.ts`
  - Parse `requiredSources`, `optionalSources`, `primarySource`, and `freshnessHours` from skill frontmatter.
- `lib/skills/extra-context.ts`
  - Reuse the source list derived from required + optional sources.
- `jobs/run-skills.ts`
  - Replace Meta-gated SEO eligibility with source-gated eligibility and source diagnostics.
- `jobs/fetch-keyword-research.ts`
  - Upsert a small `RawSnapshot("keyword_research")` evidence record for keyword-only skills.
- `lib/content-pilot/generate-proposals.ts`
  - Use shared organic scoring for organic proposal priority.
- `lib/opportunities/generate.ts`
  - Use shared organic scoring when turning SEO/content/keyword evidence into `Opportunity` rows.
- `app/api/growth-brief/route.ts`
  - Surface score/evidence details where useful and preserve priority sorting.
- `skills-source/**/*.md`
  - Add source contracts to organic skills without rewriting prompt bodies.
- `.mex/ROUTER.md`
  - Record the final behavior after implementation.
- `.mex/context/skills-recommendations.md`
  - Document source-gated skills and source diagnostics.
- `.mex/context/data-pipeline.md`
  - Document bounded on-demand source refresh from `run-skills`.
- `.mex/patterns/debug-pipeline.md`
  - Add troubleshooting notes for source-unavailable skill skips.

---

## Task 1: Source Contract Metadata

**Files:**
- Modify: `lib/skills/loader.ts`
- Test: `__tests__/lib/skills/loader.test.ts` if present; otherwise add coverage in `__tests__/jobs/run-skills-source-requirements.test.ts`

**Interfaces:**
- Consumes: existing `ExtraSource` and `SkillDefinition`.
- Produces:

```ts
export type SkillDataSource =
  | "gsc"
  | "gsc_query_page"
  | "ga4"
  | "blog"
  | "market_intel"
  | "keyword_research"
  | "dataforseo_ranked"
  | "shopify_catalog"
  | "shopify_orders";

export interface SkillDefinition {
  requiredSources?: SkillDataSource[];
  optionalSources?: SkillDataSource[];
  primarySource?: SkillDataSource;
  freshnessHours?: number;
}
```

- [ ] **Step 1: Write the failing parser test**

Add or extend a loader test with a fixture equivalent to:

```ts
const raw = `---
name: organic-gap
metadata:
  platform: seo
  extraSources:
    - gsc
  requiredSources:
    - gsc
  optionalSources:
    - ga4
    - keyword_research
  primarySource: gsc
  freshnessHours: 72
---
Prompt body`;

const skill = parseSkillFixture(raw);
expect(skill.requiredSources).toEqual(["gsc"]);
expect(skill.optionalSources).toEqual(["ga4", "keyword_research"]);
expect(skill.primarySource).toBe("gsc");
expect(skill.freshnessHours).toBe(72);
expect(skill.extraSources).toEqual(["gsc"]);
```

If no parser helper exists, create the assertion through `loadAllSkillsSync()` by mocking the skill directory in the same style as existing loader tests.

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- loader
```

Expected: FAIL because `requiredSources`, `optionalSources`, `primarySource`, or `freshnessHours` are not parsed.

- [ ] **Step 3: Implement metadata parsing**

In `lib/skills/loader.ts`, add `SkillDataSource`, valid source parsing, and fields:

```ts
export type SkillDataSource =
  | "gsc"
  | "gsc_query_page"
  | "ga4"
  | "blog"
  | "market_intel"
  | "keyword_research"
  | "dataforseo_ranked"
  | "shopify_catalog"
  | "shopify_orders";

const VALID_SKILL_DATA_SOURCES: SkillDataSource[] = [
  "gsc",
  "gsc_query_page",
  "ga4",
  "blog",
  "market_intel",
  "keyword_research",
  "dataforseo_ranked",
  "shopify_catalog",
  "shopify_orders",
];

function parseSkillDataSources(raw: unknown, fieldName: string): SkillDataSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: SkillDataSource[] = [];
  for (const value of raw) {
    if (typeof value === "string" && (VALID_SKILL_DATA_SOURCES as string[]).includes(value)) {
      result.push(value as SkillDataSource);
    } else {
      console.warn(`[skills/loader] Unknown ${fieldName} value ignored: ${String(value)}`);
    }
  }
  return result.length > 0 ? Array.from(new Set(result)) : undefined;
}

function parsePrimarySource(raw: unknown): SkillDataSource | undefined {
  if (typeof raw !== "string") return undefined;
  if ((VALID_SKILL_DATA_SOURCES as string[]).includes(raw)) return raw as SkillDataSource;
  console.warn(`[skills/loader] Unknown primarySource value ignored: ${raw}`);
  return undefined;
}

function parseFreshnessHours(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}
```

Extend `SkillFrontmatter.metadata`:

```ts
requiredSources?: string[];
optionalSources?: string[];
primarySource?: string;
freshnessHours?: number;
```

Extend the returned `SkillDefinition`:

```ts
requiredSources: parseSkillDataSources(data.metadata?.requiredSources, "requiredSources"),
optionalSources: parseSkillDataSources(data.metadata?.optionalSources, "optionalSources"),
primarySource: parsePrimarySource(data.metadata?.primarySource),
freshnessHours: parseFreshnessHours(data.metadata?.freshnessHours),
```

- [ ] **Step 4: Run the parser test**

Run:

```bash
npm test -- loader
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/loader.ts __tests__/lib/skills/loader.test.ts __tests__/jobs/run-skills-source-requirements.test.ts
git commit -m "feat: parse organic skill source contracts"
```

---

## Task 2: Source Registry

**Files:**
- Create: `lib/skills/source-registry.ts`
- Test: `__tests__/lib/skills/source-registry.test.ts`

**Interfaces:**
- Consumes: `SkillDataSource` from `lib/skills/loader.ts`.
- Produces:

```ts
export type SourceState = "fresh" | "stale" | "missing" | "disabled" | "error";

export type SourceStatus = {
  source: SkillDataSource;
  state: SourceState;
  latestAt: Date | null;
  evidenceId?: string;
  rowCount?: number;
  reason?: string;
};

export type SourceRefreshResult = {
  attempted: boolean;
  status: "success" | "partial" | "failed" | "skipped";
  errors: string[];
};

export async function checkSourceStatus(source: SkillDataSource, freshnessHours?: number): Promise<SourceStatus>;
export async function refreshSourcesOnce(sources: SkillDataSource[]): Promise<Record<string, SourceRefreshResult>>;
export async function selectBaseSnapshotForSource(source: SkillDataSource): Promise<{ id: string; source: string; payload: unknown } | null>;
```

- [ ] **Step 1: Write failing status tests**

Create tests that mock `prisma.rawSnapshot.findFirst`, `prisma.keywordResearchResult.findFirst`, and `prisma.keywordResearchResult.count`:

```ts
it("returns fresh for a recent gsc snapshot", async () => {
  mockRawSnapshotFindFirst.mockResolvedValue({
    id: "snap-gsc",
    source: "gsc",
    fetchedAt: new Date("2026-07-09T01:00:00Z"),
    payload: { topQueries: [{ query: "organic rice" }] },
  });
  vi.setSystemTime(new Date("2026-07-09T02:00:00Z"));

  await expect(checkSourceStatus("gsc", 72)).resolves.toMatchObject({
    source: "gsc",
    state: "fresh",
    evidenceId: "snap-gsc",
    rowCount: 1,
  });
});

it("returns missing for keyword_research when no rows exist", async () => {
  mockKeywordFindFirst.mockResolvedValue(null);
  mockKeywordCount.mockResolvedValue(0);

  await expect(checkSourceStatus("keyword_research", 168)).resolves.toMatchObject({
    source: "keyword_research",
    state: "missing",
    latestAt: null,
    rowCount: 0,
  });
});
```

- [ ] **Step 2: Run status tests to verify failure**

Run:

```bash
npm test -- source-registry
```

Expected: FAIL because `lib/skills/source-registry.ts` does not exist.

- [ ] **Step 3: Implement source status checks**

Create `lib/skills/source-registry.ts` with:

```ts
import { prisma } from "@/lib/db";
import type { SkillDataSource } from "@/lib/skills/loader";

export type SourceState = "fresh" | "stale" | "missing" | "disabled" | "error";

export type SourceStatus = {
  source: SkillDataSource;
  state: SourceState;
  latestAt: Date | null;
  evidenceId?: string;
  rowCount?: number;
  reason?: string;
};

export type SourceRefreshResult = {
  attempted: boolean;
  status: "success" | "partial" | "failed" | "skipped";
  errors: string[];
};

type SnapshotSource =
  | "gsc"
  | "gsc_query_page"
  | "ga4"
  | "blog"
  | "market_intel"
  | "dataforseo_ranked"
  | "shopify_catalog"
  | "shopify_orders"
  | "keyword_research";

const SNAPSHOT_SOURCE: Record<SkillDataSource, SnapshotSource> = {
  gsc: "gsc",
  gsc_query_page: "gsc_query_page",
  ga4: "ga4",
  blog: "blog",
  market_intel: "market_intel",
  keyword_research: "keyword_research",
  dataforseo_ranked: "dataforseo_ranked",
  shopify_catalog: "shopify_catalog",
  shopify_orders: "shopify_orders",
};

function isFresh(latestAt: Date | null, freshnessHours: number): boolean {
  if (!latestAt) return false;
  return Date.now() - latestAt.getTime() <= freshnessHours * 60 * 60 * 1000;
}

function countRows(source: SkillDataSource, payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  if (source === "gsc" && Array.isArray(p.topQueries)) return p.topQueries.length;
  if (source === "gsc_query_page" && Array.isArray(p.pairs)) return p.pairs.length;
  if (source === "ga4" && Array.isArray(p.topPages)) return p.topPages.length;
  if (source === "dataforseo_ranked" && Array.isArray(p.topQueries)) return p.topQueries.length;
  if (source === "keyword_research" && Array.isArray(p.keywords)) return p.keywords.length;
  return undefined;
}

export async function selectBaseSnapshotForSource(source: SkillDataSource) {
  return prisma.rawSnapshot.findFirst({
    where: { source: SNAPSHOT_SOURCE[source] },
    orderBy: [{ dateRangeEnd: "desc" }, { fetchedAt: "desc" }],
    select: { id: true, source: true, payload: true },
  });
}

export async function checkSourceStatus(source: SkillDataSource, freshnessHours = 72): Promise<SourceStatus> {
  const snapshot = await prisma.rawSnapshot.findFirst({
    where: { source: SNAPSHOT_SOURCE[source] },
    orderBy: [{ dateRangeEnd: "desc" }, { fetchedAt: "desc" }],
    select: { id: true, fetchedAt: true, payload: true },
  });

  if (snapshot) {
    return {
      source,
      state: isFresh(snapshot.fetchedAt, freshnessHours) ? "fresh" : "stale",
      latestAt: snapshot.fetchedAt,
      evidenceId: snapshot.id,
      rowCount: countRows(source, snapshot.payload),
    };
  }

  if (source === "keyword_research") {
    const latest = await prisma.keywordResearchResult.findFirst({
      orderBy: { capturedAt: "desc" },
      select: { capturedAt: true },
    });
    const rowCount = await prisma.keywordResearchResult.count();
    return {
      source,
      state: latest && isFresh(latest.capturedAt, freshnessHours) ? "fresh" : latest ? "stale" : "missing",
      latestAt: latest?.capturedAt ?? null,
      rowCount,
      reason: latest ? "keyword rows exist but no keyword_research snapshot exists yet" : "no keyword research rows found",
    };
  }

  return { source, state: "missing", latestAt: null, reason: `no ${SNAPSHOT_SOURCE[source]} snapshot found` };
}
```

- [ ] **Step 4: Run status tests**

Run:

```bash
npm test -- source-registry
```

Expected: PASS for source status tests.

- [ ] **Step 5: Write failing refresh tests**

Add a test that mocks refresh handler imports:

```ts
it("refreshes each requested source once", async () => {
  mockFetchSeoDataHandler.mockResolvedValue({ status: "success", errors: [] });
  mockFetchKeywordResearchHandler.mockResolvedValue({ status: "partial", errors: ["low seed count"] });

  const result = await refreshSourcesOnce(["gsc", "ga4", "keyword_research", "gsc"]);

  expect(mockFetchSeoDataHandler).toHaveBeenCalledTimes(1);
  expect(mockFetchKeywordResearchHandler).toHaveBeenCalledTimes(1);
  expect(result.gsc).toMatchObject({ attempted: true, status: "success" });
  expect(result.ga4).toMatchObject({ attempted: true, status: "success" });
  expect(result.keyword_research).toMatchObject({ attempted: true, status: "partial" });
});
```

- [ ] **Step 6: Implement `refreshSourcesOnce`**

Add to `source-registry.ts`:

```ts
async function refreshSeo(): Promise<SourceRefreshResult> {
  try {
    const { fetchSeoDataHandler } = await import("@/jobs/fetch-seo-data");
    const result = await fetchSeoDataHandler();
    return { attempted: true, status: result.status, errors: result.errors };
  } catch (err) {
    return { attempted: true, status: "failed", errors: [String(err)] };
  }
}

async function refreshKeywordResearch(): Promise<SourceRefreshResult> {
  try {
    const { fetchKeywordResearchHandler } = await import("@/jobs/fetch-keyword-research");
    const result = await fetchKeywordResearchHandler();
    return { attempted: true, status: result.status, errors: result.errors };
  } catch (err) {
    return { attempted: true, status: "failed", errors: [String(err)] };
  }
}

async function refreshBlog(): Promise<SourceRefreshResult> {
  try {
    const { fetchBlogContentHandler } = await import("@/jobs/fetch-blog-content");
    const result = await fetchBlogContentHandler();
    return { attempted: true, status: result.status, errors: result.errors };
  } catch (err) {
    return { attempted: true, status: "failed", errors: [String(err)] };
  }
}

async function refreshMarketIntel(): Promise<SourceRefreshResult> {
  try {
    const { fetchMarketIntelHandler } = await import("@/jobs/fetch-market-intel");
    const result = await fetchMarketIntelHandler({ profile: "smoke" });
    return { attempted: true, status: result.status, errors: result.errors };
  } catch (err) {
    return { attempted: true, status: "failed", errors: [String(err)] };
  }
}

async function refreshOrders(): Promise<SourceRefreshResult> {
  try {
    const { fetchOrdersHandler } = await import("@/jobs/fetch-orders");
    const result = await fetchOrdersHandler();
    return { attempted: true, status: result.status, errors: result.errors };
  } catch (err) {
    return { attempted: true, status: "failed", errors: [String(err)] };
  }
}

export async function refreshSourcesOnce(sources: SkillDataSource[]): Promise<Record<string, SourceRefreshResult>> {
  const unique = Array.from(new Set(sources));
  const result: Record<string, SourceRefreshResult> = {};
  const needsSeo = unique.some((s) => s === "gsc" || s === "gsc_query_page" || s === "ga4");
  const needsMarket = unique.some((s) => s === "market_intel" || s === "dataforseo_ranked" || s === "shopify_catalog");

  if (needsSeo) {
    const refreshed = await refreshSeo();
    for (const source of unique.filter((s) => s === "gsc" || s === "gsc_query_page" || s === "ga4")) result[source] = refreshed;
  }
  if (needsMarket) {
    const refreshed = await refreshMarketIntel();
    for (const source of unique.filter((s) => s === "market_intel" || s === "dataforseo_ranked" || s === "shopify_catalog")) result[source] = refreshed;
  }
  if (unique.includes("blog")) result.blog = await refreshBlog();
  if (unique.includes("keyword_research")) result.keyword_research = await refreshKeywordResearch();
  if (unique.includes("shopify_orders")) result.shopify_orders = await refreshOrders();

  for (const source of unique) {
    result[source] ??= { attempted: false, status: "skipped", errors: [`no refresh configured for ${source}`] };
  }
  return result;
}
```

- [ ] **Step 7: Run source registry tests**

Run:

```bash
npm test -- source-registry
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/skills/source-registry.ts __tests__/lib/skills/source-registry.test.ts
git commit -m "feat: add organic skill source registry"
```

---

## Task 3: Keyword Research Snapshot Evidence

**Files:**
- Modify: `jobs/fetch-keyword-research.ts`
- Test: `__tests__/jobs/fetch-keyword-research.test.ts`

**Interfaces:**
- Consumes: stored `KeywordResearchResult` rows.
- Produces: latest `RawSnapshot` with `source: "keyword_research"` and payload shape:

```ts
{
  capturedAt: string;
  keywords: Array<{
    keyword: string;
    avgMonthlySearches: number | null;
    competition: string | null;
    competitionIndex: number | null;
  }>;
}
```

- [ ] **Step 1: Write the failing snapshot test**

Add:

```ts
it("upserts a keyword_research RawSnapshot for skill evidence", async () => {
  mockMarketKeywordFindMany.mockResolvedValue([{ id: "seed-1", keyword: "organic rice", active: true }]);
  mockFetchGoogleAdsKeywordResearch.mockResolvedValue({
    disabled: false,
    results: [{
      keyword: "organic rice",
      closeVariants: [],
      avgMonthlySearches: 900,
      competition: "MEDIUM",
      competitionIndex: 55,
      lowTopOfPageBidMicros: null,
      highTopOfPageBidMicros: null,
      monthlySearchVolumes: [],
      rawPayload: {},
    }],
  });

  await fetchKeywordResearchHandler({ runId: "run-1" });

  expect(mockRawSnapshotUpsert).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      source_dateRangeStart_dateRangeEnd: expect.objectContaining({ source: "keyword_research" }),
    }),
    create: expect.objectContaining({
      source: "keyword_research",
      jobRunId: "run-1",
      payload: expect.objectContaining({
        keywords: [expect.objectContaining({ keyword: "organic rice", avgMonthlySearches: 900 })],
      }),
    }),
  }));
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- fetch-keyword-research
```

Expected: FAIL because no `keyword_research` snapshot is written.

- [ ] **Step 3: Implement snapshot upsert**

In `jobs/fetch-keyword-research.ts`, after result rows are stored and before the final `JobRun` update, add:

```ts
const snapshotRows = await prisma.keywordResearchResult.findMany({
  orderBy: [{ capturedAt: "desc" }, { keyword: "asc" }],
  take: 100,
});

const start = new Date(Date.UTC(capturedAt.getUTCFullYear(), capturedAt.getUTCMonth(), capturedAt.getUTCDate()));
const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

await prisma.rawSnapshot.upsert({
  where: {
    source_dateRangeStart_dateRangeEnd: {
      source: "keyword_research",
      dateRangeStart: start,
      dateRangeEnd: end,
    },
  },
  create: {
    source: "keyword_research",
    dateRangeStart: start,
    dateRangeEnd: end,
    jobRunId: runId,
    payload: {
      capturedAt: capturedAt.toISOString(),
      keywords: snapshotRows.map((row) => ({
        keyword: row.keyword,
        avgMonthlySearches: row.avgMonthlySearches,
        competition: row.competition,
        competitionIndex: row.competitionIndex,
      })),
    },
  },
  update: {
    jobRunId: runId,
    fetchedAt: new Date(),
    payload: {
      capturedAt: capturedAt.toISOString(),
      keywords: snapshotRows.map((row) => ({
        keyword: row.keyword,
        avgMonthlySearches: row.avgMonthlySearches,
        competition: row.competition,
        competitionIndex: row.competitionIndex,
      })),
    },
  },
});
```

- [ ] **Step 4: Run keyword research tests**

Run:

```bash
npm test -- fetch-keyword-research
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add jobs/fetch-keyword-research.ts __tests__/jobs/fetch-keyword-research.test.ts
git commit -m "feat: snapshot keyword research evidence"
```

---

## Task 4: Source-Aware Run-Skills Eligibility

**Files:**
- Modify: `jobs/run-skills.ts`
- Modify: `lib/skills/extra-context.ts`
- Test: `__tests__/jobs/run-skills-source-requirements.test.ts`
- Update existing tests: `__tests__/jobs/run-skills.test.ts`, `__tests__/jobs/run-skills.filtering.test.ts`, `__tests__/jobs/run-skills.rotation.test.ts`, `__tests__/jobs/run-skills-hash.test.ts`

**Interfaces:**
- Consumes:

```ts
checkSourceStatus(source, freshnessHours)
refreshSourcesOnce(sources)
selectBaseSnapshotForSource(source)
```

- Produces `RunSkillsSummary` additions:

```ts
sourceStatus: Record<string, SourceStatus>;
sourceRefreshes: Record<string, SourceRefreshResult>;
skillsUnavailable: Array<{
  skillId: string;
  missingRequiredSources: string[];
  staleRequiredSources: string[];
  reason: string;
}>;
```

- [ ] **Step 1: Write failing test for SEO skill without Meta**

Add:

```ts
it("runs a seo skill from gsc without requiring a meta snapshot", async () => {
  mockRawSnapshotFindFirst.mockImplementation(async (args) => {
    if (args.where?.source === "meta") return null;
    if (args.where?.source === "gsc") return {
      id: "gsc-snap",
      source: "gsc",
      payload: { topQueries: [{ query: "organic rice", impressions: 100 }] },
      fetchedAt: new Date(),
      dateRangeStart: new Date(),
      dateRangeEnd: new Date(),
    };
    return null;
  });
  mockLoadAllSkillsSync.mockReturnValue([{
    id: "organic-gap",
    name: "Organic Gap",
    description: "",
    platform: "seo",
    pilotGroup: "seo",
    enabled: true,
    fullPrompt: "Find organic gaps",
    extraSources: ["gsc"],
    requiredSources: ["gsc"],
    primarySource: "gsc",
  }]);
  mockCheckSourceStatus.mockResolvedValue({ source: "gsc", state: "fresh", latestAt: new Date(), evidenceId: "gsc-snap" });
  mockSelectBaseSnapshotForSource.mockResolvedValue({ id: "gsc-snap", source: "gsc", payload: { topQueries: [] } });

  const result = await runSkillsHandler();

  expect(result.status).toBe("success");
  expect(mockRunSkill).toHaveBeenCalledWith(expect.objectContaining({ id: "organic-gap" }), expect.objectContaining({ id: "gsc-snap" }), expect.any(Object));
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- run-skills-source-requirements
```

Expected: FAIL because `run-skills` fails early when Meta is missing.

- [ ] **Step 3: Implement source contract derivation**

In `jobs/run-skills.ts`, add local helpers:

```ts
function requiredSourcesForSkill(skill: SkillDefinition): SkillDataSource[] {
  if (skill.requiredSources?.length) return skill.requiredSources;
  if (skill.platform === "seo") return skill.extraSources ?? [];
  return [];
}

function optionalSourcesForSkill(skill: SkillDefinition): SkillDataSource[] {
  const required = new Set(requiredSourcesForSkill(skill));
  const optional = [...(skill.optionalSources ?? []), ...(skill.extraSources ?? [])];
  return Array.from(new Set(optional.filter((source) => !required.has(source))));
}

function allContextSourcesForSkill(skill: SkillDefinition): SkillDataSource[] {
  return Array.from(new Set([...requiredSourcesForSkill(skill), ...optionalSourcesForSkill(skill)]));
}
```

- [ ] **Step 4: Remove early Meta hard failure**

Replace the early `if (!metaSnap) { ... failed ... }` branch with a design where Meta absence only makes `platform: "meta"` and `platform: "both"` unavailable. The job should only fail if no enabled dispatchable skill can run and there are no source diagnostics explaining skipped skills.

- [ ] **Step 5: Build source status map and refresh missing required sources**

Add flow before selecting `applicableSkills`:

```ts
const allRequiredSources = Array.from(new Set(
  allSkills.flatMap((skill) => requiredSourcesForSkill(skill))
));

const sourceStatus: Record<string, SourceStatus> = {};
for (const source of allRequiredSources) {
  sourceStatus[source] = await checkSourceStatus(source, undefined);
}

const sourcesToRefresh = allRequiredSources.filter((source) =>
  sourceStatus[source]?.state === "missing" || sourceStatus[source]?.state === "stale"
);
const sourceRefreshes = sourcesToRefresh.length > 0 ? await refreshSourcesOnce(sourcesToRefresh) : {};

for (const source of sourcesToRefresh) {
  sourceStatus[source] = await checkSourceStatus(source, undefined);
}
```

- [ ] **Step 6: Filter runnable skills by source status**

Replace SEO eligibility with:

```ts
const skillsUnavailable: RunSkillsSummary["skillsUnavailable"] = [];

const eligibleSkills = allSkills.filter((skill) => {
  if (!DISPATCHABLE_PLATFORMS.includes(skill.platform)) return false;
  if ((skill.platform === "meta" || skill.platform === "both") && !metaSnap) return false;

  const required = requiredSourcesForSkill(skill);
  const missing = required.filter((source) => sourceStatus[source]?.state === "missing" || sourceStatus[source]?.state === "error" || sourceStatus[source]?.state === "disabled");
  const stale = required.filter((source) => sourceStatus[source]?.state === "stale");
  if (missing.length > 0 || stale.length > 0) {
    skillsUnavailable.push({
      skillId: skill.id,
      missingRequiredSources: missing,
      staleRequiredSources: stale,
      reason: "required data unavailable after refresh attempt",
    });
    return false;
  }
  return true;
});
```

- [ ] **Step 7: Select base snapshot per skill**

Inside the skill execution callback, replace `const snapshot = metaSnap;` with:

```ts
const primarySource = skill.primarySource ?? requiredSourcesForSkill(skill)[0] ?? optionalSourcesForSkill(skill)[0];
const snapshot = primarySource
  ? await selectBaseSnapshotForSource(primarySource)
  : metaSnap;

if (!snapshot) {
  return {
    count: 0,
    skillId: skill.id,
    skillName: skill.name,
    snapshotId: "",
    hash: "",
    insights: [],
    wasSkipped: true,
    unsupportedCount: 0,
    unavailableReason: "missing_base_snapshot",
  };
}
```

Extend `SkillResult` with `unavailableReason?: string` and record this into `skillsUnavailable`.

- [ ] **Step 8: Use required + optional source union for extra context**

Replace:

```ts
new Set(applicableSkills.flatMap((s) => s.extraSources ?? []))
```

with:

```ts
new Set(applicableSkills.flatMap(allContextSourcesForSkill))
```

And in `extraContextForSkill`, iterate `allContextSourcesForSkill(skill)`.

- [ ] **Step 9: Add diagnostics to summary**

Extend `RunSkillsSummary` and final summary:

```ts
sourceStatus,
sourceRefreshes,
skillsUnavailable,
```

- [ ] **Step 10: Run source requirement tests**

Run:

```bash
npm test -- run-skills-source-requirements
```

Expected: PASS.

- [ ] **Step 11: Run all run-skills tests**

Run:

```bash
npm test -- run-skills
```

Expected: PASS. Update existing test fixtures to include empty `sourceStatus`, `sourceRefreshes`, and `skillsUnavailable` expectations where needed.

- [ ] **Step 12: Commit**

```bash
git add jobs/run-skills.ts lib/skills/extra-context.ts __tests__/jobs/run-skills-source-requirements.test.ts __tests__/jobs/run-skills.test.ts __tests__/jobs/run-skills.filtering.test.ts __tests__/jobs/run-skills.rotation.test.ts __tests__/jobs/run-skills-hash.test.ts
git commit -m "feat: run organic skills from required sources"
```

---

## Task 5: Organic Skill Frontmatter Migration

**Files:**
- Modify: `skills-source/**/*.md`
- Test: covered by `npm test -- run-skills` and loader tests

**Interfaces:**
- Consumes: `requiredSources`, `optionalSources`, `primarySource`, `freshnessHours`.
- Produces: organic skills with explicit source contracts.

- [ ] **Step 1: List organic skill files**

Run:

```bash
rg -n "platform:.*(seo|google)|extraSources|keyword_research|gsc|ga4|market_intel" skills-source
```

Expected: list of organic or mixed skills needing contracts.

- [ ] **Step 2: Add contracts to GSC-first skills**

For GSC query/page skills, use:

```yaml
metadata:
  platform: seo
  requiredSources:
    - gsc
  optionalSources:
    - ga4
    - keyword_research
  primarySource: gsc
  freshnessHours: 96
```

Keep existing `extraSources` until all callers use required/optional source fields reliably:

```yaml
  extraSources:
    - gsc
    - ga4
    - keyword_research
```

- [ ] **Step 3: Add contracts to keyword-gap skills**

For keyword gap skills, use:

```yaml
metadata:
  platform: seo
  requiredSources:
    - keyword_research
  optionalSources:
    - gsc
    - dataforseo_ranked
  primarySource: keyword_research
  freshnessHours: 168
  extraSources:
    - keyword_research
    - gsc
```

- [ ] **Step 4: Add contracts to market-intel organic skills**

For market-intel content angle skills, use:

```yaml
metadata:
  platform: seo
  requiredSources:
    - market_intel
  optionalSources:
    - keyword_research
    - dataforseo_ranked
  primarySource: market_intel
  freshnessHours: 168
  extraSources:
    - market_intel
    - keyword_research
```

- [ ] **Step 5: Run loader and run-skills tests**

Run:

```bash
npm test -- loader
npm test -- run-skills
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills-source
git commit -m "chore: declare organic skill source contracts"
```

---

## Task 6: Organic Prioritization Scorer

**Files:**
- Create: `lib/organic/prioritization.ts`
- Test: `__tests__/lib/organic/prioritization.test.ts`

**Interfaces:**
- Produces:

```ts
export type OrganicOpportunityType =
  | "ctr_gap"
  | "content_gap"
  | "metadata_fix"
  | "internal_link"
  | "schema_fix"
  | "keyword_gap"
  | "refresh"
  | "new_content";

export type OrganicOpportunityInput = {
  type: OrganicOpportunityType;
  impressions?: number | null;
  clicks?: number | null;
  position?: number | null;
  expectedCtr?: number | null;
  searchVolume?: number | null;
  ga4Sessions?: number | null;
  ga4Conversions?: number | null;
  revenueSignal?: number | null;
  businessRelevance?: "high" | "medium" | "low" | null;
  confidence?: number | null;
  effort?: "low" | "medium" | "high" | null;
  sourceFreshnessHours?: number | null;
};

export type OrganicPriority = {
  score: number;
  priority: "P0" | "P1" | "P2" | "P3";
  impact: "High" | "Medium" | "Low";
  effort: "Low" | "Medium" | "High";
  components: Record<string, number>;
};

export function scoreOrganicOpportunity(input: OrganicOpportunityInput): OrganicPriority;
```

- [ ] **Step 1: Write failing scoring tests**

Add tests:

```ts
it("scores high-impression CTR gaps above low-volume metadata fixes", () => {
  const ctrGap = scoreOrganicOpportunity({
    type: "ctr_gap",
    impressions: 2000,
    clicks: 20,
    position: 8,
    expectedCtr: 0.05,
    confidence: 0.85,
    effort: "low",
    businessRelevance: "high",
    sourceFreshnessHours: 24,
  });
  const metadata = scoreOrganicOpportunity({
    type: "metadata_fix",
    impressions: 30,
    confidence: 0.9,
    effort: "low",
    businessRelevance: "medium",
    sourceFreshnessHours: 24,
  });

  expect(ctrGap.score).toBeGreaterThan(metadata.score);
  expect(ctrGap.priority).toMatch(/P0|P1/);
});

it("penalizes stale data and high effort", () => {
  const fresh = scoreOrganicOpportunity({ type: "new_content", searchVolume: 1000, confidence: 0.8, effort: "medium", sourceFreshnessHours: 24 });
  const stale = scoreOrganicOpportunity({ type: "new_content", searchVolume: 1000, confidence: 0.8, effort: "high", sourceFreshnessHours: 400 });
  expect(fresh.score).toBeGreaterThan(stale.score);
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test -- organic/prioritization
```

Expected: FAIL because scorer file does not exist.

- [ ] **Step 3: Implement scorer**

Create `lib/organic/prioritization.ts`:

```ts
export type OrganicOpportunityType =
  | "ctr_gap"
  | "content_gap"
  | "metadata_fix"
  | "internal_link"
  | "schema_fix"
  | "keyword_gap"
  | "refresh"
  | "new_content";

export type OrganicOpportunityInput = {
  type: OrganicOpportunityType;
  impressions?: number | null;
  clicks?: number | null;
  position?: number | null;
  expectedCtr?: number | null;
  searchVolume?: number | null;
  ga4Sessions?: number | null;
  ga4Conversions?: number | null;
  revenueSignal?: number | null;
  businessRelevance?: "high" | "medium" | "low" | null;
  confidence?: number | null;
  effort?: "low" | "medium" | "high" | null;
  sourceFreshnessHours?: number | null;
};

export type OrganicPriority = {
  score: number;
  priority: "P0" | "P1" | "P2" | "P3";
  impact: "High" | "Medium" | "Low";
  effort: "Low" | "Medium" | "High";
  components: Record<string, number>;
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function logScore(value: number | null | undefined, divisor: number): number {
  const n = Math.max(0, Number(value ?? 0));
  return clamp(Math.log10(n + 1) * divisor);
}

function positionScore(position: number | null | undefined): number {
  if (!position || !Number.isFinite(position)) return 0;
  if (position >= 5 && position <= 20) return 18;
  if (position > 20 && position <= 40) return 10;
  if (position > 0 && position < 5) return 6;
  return 0;
}

function ctrUpside(input: OrganicOpportunityInput): number {
  const impressions = Number(input.impressions ?? 0);
  if (!impressions || !input.expectedCtr) return 0;
  const actualCtr = Number(input.clicks ?? 0) / Math.max(impressions, 1);
  return clamp((input.expectedCtr - actualCtr) * 500, 0, 20);
}

function relevanceScore(value: OrganicOpportunityInput["businessRelevance"]): number {
  if (value === "high") return 12;
  if (value === "medium") return 7;
  if (value === "low") return 2;
  return 5;
}

function effortPenalty(value: OrganicOpportunityInput["effort"]): number {
  if (value === "high") return 14;
  if (value === "medium") return 7;
  return 0;
}

function freshnessPenalty(hours: number | null | undefined): number {
  if (hours == null) return 4;
  if (hours <= 96) return 0;
  if (hours <= 168) return 4;
  return 10;
}

function confidenceScore(confidence: number | null | undefined): number {
  const c = confidence == null ? 0.6 : clamp(confidence, 0, 1);
  return c * 12;
}

function classify(score: number): OrganicPriority["priority"] {
  if (score >= 80) return "P0";
  if (score >= 60) return "P1";
  if (score >= 35) return "P2";
  return "P3";
}

function impact(score: number): OrganicPriority["impact"] {
  if (score >= 60) return "High";
  if (score >= 35) return "Medium";
  return "Low";
}

function effortLabel(value: OrganicOpportunityInput["effort"]): OrganicPriority["effort"] {
  if (value === "high") return "High";
  if (value === "medium") return "Medium";
  return "Low";
}

export function scoreOrganicOpportunity(input: OrganicOpportunityInput): OrganicPriority {
  const demand = Math.max(logScore(input.impressions, 12), logScore(input.searchVolume, 10), logScore(input.ga4Sessions, 8));
  const ranking = positionScore(input.position);
  const ctr = input.type === "ctr_gap" ? ctrUpside(input) : 0;
  const revenue = clamp(Number(input.ga4Conversions ?? 0) * 5 + Math.log10(Math.max(0, Number(input.revenueSignal ?? 0)) + 1) * 6, 0, 15);
  const relevance = relevanceScore(input.businessRelevance);
  const confidence = confidenceScore(input.confidence);
  const typeBoost = input.type === "metadata_fix" || input.type === "internal_link" ? 6 : input.type === "content_gap" || input.type === "keyword_gap" ? 8 : 4;
  const effort = effortPenalty(input.effort);
  const freshness = freshnessPenalty(input.sourceFreshnessHours);

  const raw = demand + ranking + ctr + revenue + relevance + confidence + typeBoost - effort - freshness;
  const score = Math.round(clamp(raw));
  return {
    score,
    priority: classify(score),
    impact: impact(score),
    effort: effortLabel(input.effort),
    components: {
      demand: Math.round(demand),
      ranking: Math.round(ranking),
      ctr: Math.round(ctr),
      revenue: Math.round(revenue),
      relevance: Math.round(relevance),
      confidence: Math.round(confidence),
      typeBoost,
      effortPenalty: effort,
      freshnessPenalty: freshness,
    },
  };
}
```

- [ ] **Step 4: Run scorer tests**

Run:

```bash
npm test -- organic/prioritization
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/organic/prioritization.ts __tests__/lib/organic/prioritization.test.ts
git commit -m "feat: score organic opportunities deterministically"
```

---

## Task 7: Apply Organic Scoring To Proposals And Opportunities

**Files:**
- Modify: `lib/content-pilot/generate-proposals.ts`
- Modify: `lib/opportunities/generate.ts`
- Modify: `lib/opportunities/route.ts` if priority mapping needs adjustment
- Test: `__tests__/lib/content-pilot/generate-proposals.test.ts`
- Test: `__tests__/lib/opportunities/generate.test.ts`
- Test: `__tests__/lib/opportunities/route.test.ts`

**Interfaces:**
- Consumes: `scoreOrganicOpportunity(input)`.
- Produces: proposal `priorityScore`, proposal `priority`, `Opportunity.score`, `Opportunity.priority`, and evidence component data.

- [ ] **Step 1: Write failing proposal scoring test**

Add:

```ts
it("prioritizes high-impression CTR gaps over low-volume generic content gaps", async () => {
  mockGscQueries([
    { query: "organic rice philippines", page: "/blogs/rice", impressions: 2000, clicks: 20, position: "8.0" },
    { query: "rice trivia", page: "/blogs/trivia", impressions: 20, clicks: 0, position: "30.0" },
  ]);

  const proposals = await generateProposals(mockPrisma as any);

  expect(proposals[0]?.sourceData).toMatchObject({ query: "organic rice philippines" });
  expect(proposals[0]?.priorityScore).toBeGreaterThan(proposals[1]?.priorityScore ?? 0);
});
```

- [ ] **Step 2: Run failing content proposal test**

Run:

```bash
npm test -- generate-proposals
```

Expected: FAIL until proposal generation uses shared scorer.

- [ ] **Step 3: Replace overlapping local score formulas**

In CTR gap creation, call:

```ts
const priority = scoreOrganicOpportunity({
  type: "ctr_gap",
  impressions: q.impressions,
  clicks: q.clicks,
  position: q.position,
  expectedCtr: expectedCtr(q.position),
  confidence: 0.85,
  effort: "low",
  businessRelevance: isCommercialQuery(q.query) ? "high" : "medium",
  sourceFreshnessHours: latestGscAgeHours,
});
```

Use:

```ts
priorityScore: priority.score,
priority: priority.impact.toLowerCase(),
impact: priority.impact,
effort: priority.effort,
sourceData: { ...existingSourceData, organicPriority: priority },
```

For content gaps and keyword gaps, use `type: "content_gap"` or `type: "keyword_gap"` and map search volume/impressions accordingly.

- [ ] **Step 4: Apply scoring in `lib/opportunities/generate.ts`**

For SEO/content/keyword opportunities, set:

```ts
const priority = scoreOrganicOpportunity({
  type: mappedType,
  impressions,
  clicks,
  position,
  searchVolume,
  confidence,
  effort,
  businessRelevance,
  sourceFreshnessHours,
});

return {
  ...baseOpportunity,
  score: priority.score,
  priority: priority.priority,
  impact: priority.impact,
  effort: priority.effort,
  evidence: { ...baseEvidence, organicPriority: priority },
};
```

- [ ] **Step 5: Preserve routing behavior**

If `lib/opportunities/route.ts` maps P0 to P1 for ContentProposal priority, keep that behavior unless tests prove the UI supports P0 proposals. Preserve the original `Opportunity.score` in `sourceData.score`.

- [ ] **Step 6: Run proposal and opportunity tests**

Run:

```bash
npm test -- content-pilot
npm test -- opportunities
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/content-pilot/generate-proposals.ts lib/opportunities/generate.ts lib/opportunities/route.ts __tests__/lib/content-pilot/generate-proposals.test.ts __tests__/lib/opportunities/generate.test.ts __tests__/lib/opportunities/route.test.ts
git commit -m "feat: apply organic priority scoring"
```

---

## Task 8: Operator-Facing Diagnostics And Sorting

**Files:**
- Modify: `app/api/growth-brief/route.ts`
- Modify: SEO/content UI files only if current API output is insufficient
- Test: existing API tests for Growth Brief, SEO, and Content Pilot where present

**Interfaces:**
- Consumes: `Opportunity.score`, `ContentProposal.priorityScore`, `JobRun.summary.sourceStatus`, `JobRun.summary.skillsUnavailable`.
- Produces: sorted organic work queues and concise evidence strings.

- [ ] **Step 1: Write failing sorting/detail test**

Add or extend an API test:

```ts
it("sorts organic opportunities by priority rank then score evidence", async () => {
  mockOpportunities([
    { id: "low", priority: "P2", score: 45, title: "Low", impact: "Medium", effort: "Low" },
    { id: "high", priority: "P1", score: 72, title: "High", impact: "High", effort: "Low" },
  ]);

  const response = await GET(mockRequest());
  const body = await response.json();

  expect(body.sections.organic.items[0].id).toBe("high");
  expect(body.sections.organic.items[0].details.join(" ")).toContain("Score 72");
});
```

- [ ] **Step 2: Run the failing API test**

Run:

```bash
npm test -- growth-brief
```

Expected: FAIL if score detail or sorting is not present.

- [ ] **Step 3: Implement score-aware detail text**

In `app/api/growth-brief/route.ts`, when mapping opportunities or content proposals, include:

```ts
details: [
  `Score ${Math.round(score)}`,
  impact ? `Impact ${impact}` : "",
  effort ? `Effort ${effort}` : "",
].filter(Boolean)
```

Sort by:

```ts
.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (b.score ?? 0) - (a.score ?? 0))
```

- [ ] **Step 4: Add source-unavailable summary exposure if job details exist**

Where job details are already shown, render `skillsUnavailable.length` and the first few `missingRequiredSources` values. If there is no suitable UI location, keep this in API/job summary only and document it in Task 10.

- [ ] **Step 5: Run UI/API tests**

Run:

```bash
npm test -- growth-brief
npm test -- seo
npm test -- content-pilot
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/growth-brief/route.ts app __tests__
git commit -m "feat: surface organic priority evidence"
```

---

## Task 9: Verification

**Files:**
- No source files unless fixes are needed.

**Interfaces:**
- Consumes all prior tasks.
- Produces verified implementation.

- [ ] **Step 1: Run focused run-skills tests**

Run:

```bash
npm test -- run-skills
```

Expected: PASS.

- [ ] **Step 2: Run skill and source tests**

Run:

```bash
npm test -- skills
```

Expected: PASS.

- [ ] **Step 3: Run organic proposal/opportunity tests**

Run:

```bash
npm test -- content-pilot
npm test -- opportunities
npm test -- organic/prioritization
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Run real-data source verification**

Run a read-only verification against the configured database. If an existing script covers this exact behavior, use it. Otherwise add a small temporary or committed script that calls the production source-registry functions and prints statuses for `gsc`, `gsc_query_page`, `ga4`, `blog`, `market_intel`, `keyword_research`, `dataforseo_ranked`, `shopify_catalog`, and `shopify_orders`.

Expected: the command reads real PostgreSQL data through `import { prisma } from "@/lib/db"` and reports actual source states/evidence ids. Do not satisfy this step with mocked Prisma data.

- [ ] **Step 6: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 7: Attempt lint**

Run:

```bash
npm run lint
```

Expected: PASS, or document the known `next lint` interactive setup prompt as a tooling blocker if it appears.

- [ ] **Step 8: Commit verification fixes**

If fixes were needed:

```bash
git add .
git commit -m "test: verify organic skill source prioritization"
```

If no fixes were needed, do not create an empty commit.

---

## Task 10: Project Memory

**Files:**
- Modify: `.mex/ROUTER.md`
- Modify: `.mex/context/skills-recommendations.md`
- Modify: `.mex/context/data-pipeline.md`
- Modify: `.mex/patterns/debug-pipeline.md`

**Interfaces:**
- Consumes final implementation behavior.
- Produces project memory for future sessions.

- [ ] **Step 1: Update router current state**

Add one concise bullet to `.mex/ROUTER.md`:

```md
- **Organic skill source independence + prioritization (2026-07-09)**: SEO/keyword/content skills now declare required/optional data sources and run from their own base evidence snapshots instead of requiring Meta. `run-skills` refreshes missing/stale required organic sources once per run, records source diagnostics and unavailable-skill reasons in `JobRun.summary`, and organic proposals/opportunities use deterministic scoring for demand, CTR upside, business relevance, confidence, freshness, and effort.
```

- [ ] **Step 2: Update skills context**

In `.mex/context/skills-recommendations.md`, add:

```md
SEO skills are source-gated, not Meta-gated. A skill can declare `requiredSources`, `optionalSources`, `primarySource`, and `freshnessHours` in frontmatter. Missing/stale required sources trigger one bounded refresh attempt per `run-skills` execution; if still unavailable, the skip reason is recorded in `JobRun.summary.skillsUnavailable`.
```

- [ ] **Step 3: Update data-pipeline context**

In `.mex/context/data-pipeline.md`, document that `run-skills` may invoke bounded refresh handlers for organic sources and that keyword research writes `RawSnapshot("keyword_research")`.

- [ ] **Step 4: Update debug pattern**

In `.mex/patterns/debug-pipeline.md`, add troubleshooting instructions:

```md
When SEO/content skills do not run, inspect the latest `run-skills` `JobRun.summary.sourceStatus`, `sourceRefreshes`, and `skillsUnavailable` before checking model output. A missing required source is a data availability problem, not an LLM problem.
```

- [ ] **Step 5: Log the decision**

Run:

```bash
mex log --type decision "SEO and keyword skills are now source-gated, with bounded refresh attempts for missing required organic data and deterministic organic prioritization."
```

Expected: decision appended to `.mex/events/decisions.jsonl`.

- [ ] **Step 6: Commit project memory**

```bash
git add .mex/ROUTER.md .mex/context/skills-recommendations.md .mex/context/data-pipeline.md .mex/patterns/debug-pipeline.md .mex/events/decisions.jsonl
git commit -m "docs: record organic skill source behavior"
```

---

## Self-Review

### 1. Spec Coverage

- Decouple organic skills from Meta: Task 4.
- Fetch missing required data if possible: Task 2 and Task 4.
- Make unavailable data visible: Task 4 and Task 8.
- Add issue #5 prioritization: Task 6, Task 7, and Task 8.
- Preserve Google Ads keyword-research-only rule: Global Constraints and Task 3.
- Avoid hidden schema dependency: Global Constraints and Task 3's RawSnapshot approach.

### 2. Placeholder Scan

This plan intentionally avoids placeholder tokens, open-ended validation instructions, and unspecific test instructions. Every task has file paths, interfaces, concrete test examples, commands, and expected outcomes.

### 3. Type Consistency

The plan uses `SkillDataSource`, `SourceStatus`, `SourceRefreshResult`, `OrganicOpportunityInput`, and `OrganicPriority` consistently across producer and consumer tasks. `requiredSources`, `optionalSources`, `primarySource`, and `freshnessHours` are defined in Task 1 before being consumed in Task 4.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-organic-skill-source-priority-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
