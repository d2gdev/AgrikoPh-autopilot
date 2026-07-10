# SEO Pilot Functional Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix all ten confirmed SEO Pilot functional audit findings while preserving operator approval, Content Pilot publishing safety, and existing working SEO behavior.

**Architecture:** Keep the existing Next.js route/UI boundaries, but centralize opportunity classification and Content Proposal identity in pure helpers. Enforce proposal and keyword idempotency at PostgreSQL boundaries, use the shared AI failover path, and make partial/failing data explicit to the client.

**Tech Stack:** Next.js 15.5 App Router, TypeScript, Prisma 6/PostgreSQL, React 18, Shopify Polaris, OpenAI-compatible DeepSeek/OpenRouter client, Zod, Vitest 4, ESLint 9 flat configuration.

## Global Constraints

- Never execute live ad or Shopify changes during implementation or verification.
- Never approve, generate, schedule, publish, or execute a Content Proposal automatically.
- Preserve `CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES` semantics for rejected, published, approved, and pending decisions.
- All database access must use `import { prisma } from "@/lib/db"`; never instantiate `PrismaClient`.
- Every embedded API route must retain `await requireAppAuth(req)` or the existing permission check as its first statement.
- Validate AI output with Zod before persistence.
- Do not expose API keys, provider response bodies containing secrets, or server-only credentials.
- Keep `pause_ad` outside `CONVERSION_SENSITIVE_ACTIONS`; this plan does not modify ad guardrails.
- Use red-green TDD for every behavior change.
- Do not deploy, run production migrations, or mutate production data as part of this plan.

---

### Task 1: Preserve Landing-Page Attribution and Classify Opportunities Correctly

**Files:**
- Create: `lib/seo/promotion.ts`
- Create: `__tests__/lib/seo/promotion.test.ts`
- Create: `__tests__/lib/seo/opportunities.test.ts`
- Modify: `app/api/seo/route.ts`
- Modify: `app/api/seo/gaps/promote/route.ts`
- Modify: `__tests__/api/seo-pilot-routes.test.ts`

**Interfaces:**
- Consumes: `CtrOpportunity`, `OpportunityType`, and canonical `ArticleRecord` data.
- Produces:

```ts
export type SeoPromotionSkipReason = "missingArticle" | "nonBlogExistingPage";

export type SeoPromotionDecision =
  | { kind: "proposal"; proposalType: "seo-fix" | "content-refresh" | "new-content" }
  | { kind: "skip"; reason: SeoPromotionSkipReason };

export function articleHandleFromBlogPage(page: string | null | undefined): string | null;

export function classifySeoPromotion(input: {
  issue?: "missing-meta" | "thin-content";
  opportunityType?: string;
  page?: string | null;
  requestedHandle?: string | null;
  matchedArticle: { handle: string } | null;
}): SeoPromotionDecision;
```

- Later tasks use `articleHandleFromBlogPage()` and `classifySeoPromotion()` instead of duplicating page parsing and proposal-type branches.

- [x] **Step 1: Write pure classification regressions**

Create `__tests__/lib/seo/promotion.test.ts` with cases equivalent to:

```ts
import { describe, expect, it } from "vitest";
import { articleHandleFromBlogPage, classifySeoPromotion } from "@/lib/seo/promotion";

describe("classifySeoPromotion", () => {
  const article = { handle: "black-rice-benefits" };

  it.each(["low_ctr", "high_impression_no_click"])(
    "maps existing-page %s work to seo-fix",
    (opportunityType) => {
      expect(classifySeoPromotion({
        opportunityType,
        page: "https://agrikoph.com/blogs/news/black-rice-benefits",
        requestedHandle: "black-rice-benefits",
        matchedArticle: article,
      })).toEqual({ kind: "proposal", proposalType: "seo-fix" });
    },
  );

  it("maps an existing-page striking-distance opportunity to content-refresh", () => {
    expect(classifySeoPromotion({
      opportunityType: "striking_distance",
      page: "https://agrikoph.com/blogs/news/black-rice-benefits",
      requestedHandle: "black-rice-benefits",
      matchedArticle: article,
    })).toEqual({ kind: "proposal", proposalType: "content-refresh" });
  });

  it("maps an uncovered query to new-content", () => {
    expect(classifySeoPromotion({ matchedArticle: null })).toEqual({
      kind: "proposal",
      proposalType: "new-content",
    });
  });

  it("skips an existing non-blog landing page", () => {
    expect(classifySeoPromotion({
      opportunityType: "low_ctr",
      page: "https://agrikoph.com/products/black-rice",
      matchedArticle: null,
    })).toEqual({ kind: "skip", reason: "nonBlogExistingPage" });
  });

  it("does not trust an unresolved blog handle", () => {
    expect(classifySeoPromotion({
      opportunityType: "low_ctr",
      page: "https://agrikoph.com/blogs/news/missing",
      requestedHandle: "missing",
      matchedArticle: null,
    })).toEqual({ kind: "skip", reason: "missingArticle" });
  });
});

describe("articleHandleFromBlogPage", () => {
  it("extracts and normalizes Shopify article handles", () => {
    expect(articleHandleFromBlogPage("https://agrikoph.com/blogs/news/Black-Rice?x=1"))
      .toBe("black-rice");
  });
});
```

Create `__tests__/lib/seo/opportunities.test.ts` to pin complete-map attribution independently of the route:

```ts
import { expect, it } from "vitest";
import { computeCtrOpportunities } from "@/lib/seo/opportunities";

it("attributes a query using a mapping beyond the first 50 pairs", () => {
  const filler = Array.from({ length: 50 }, (_, index) => ({
    query: `filler ${index}`,
    page: `https://agrikoph.com/blogs/news/filler-${index}`,
    clicks: 0,
    impressions: 1000 - index,
    position: "8.0",
  }));
  const opportunities = computeCtrOpportunities(
    [{ query: "target query", clicks: 0, impressions: 200, ctr: "0%", position: "8.0" }],
    [...filler, {
      query: "target query",
      page: "https://agrikoph.com/blogs/news/target-article",
      clicks: 0,
      impressions: 200,
      position: "8.0",
    }],
  );
  expect(opportunities[0]?.page).toBe("https://agrikoph.com/blogs/news/target-article");
});
```

- [x] **Step 2: Run the pure test and verify it fails**

Run:

```bash
npm test -- --run __tests__/lib/seo/promotion.test.ts
```

Expected: FAIL because `@/lib/seo/promotion` does not exist.

- [x] **Step 3: Implement the pure classifier**

Create `lib/seo/promotion.ts` with these decision rules:

```ts
const BLOG_HANDLE = /^[a-z0-9][a-z0-9_-]*$/i;

export function articleHandleFromBlogPage(page: string | null | undefined): string | null {
  if (!page) return null;
  let path = page;
  try {
    path = new URL(page).pathname;
  } catch {
    path = page.split(/[?#]/)[0] ?? page;
  }
  const parts = path.split("/").filter(Boolean);
  const blogs = parts.findIndex((part) => part.toLowerCase() === "blogs");
  const handle = blogs >= 0 ? parts[blogs + 2] : null;
  return handle && BLOG_HANDLE.test(handle) ? handle.toLowerCase() : null;
}

export function classifySeoPromotion(input: {
  issue?: "missing-meta" | "thin-content";
  opportunityType?: string;
  page?: string | null;
  requestedHandle?: string | null;
  matchedArticle: { handle: string } | null;
}): SeoPromotionDecision {
  if (input.issue === "missing-meta") {
    return input.matchedArticle
      ? { kind: "proposal", proposalType: "seo-fix" }
      : { kind: "skip", reason: "missingArticle" };
  }
  if (input.issue === "thin-content") {
    return input.matchedArticle
      ? { kind: "proposal", proposalType: "content-refresh" }
      : { kind: "skip", reason: "missingArticle" };
  }

  const pageHandle = input.requestedHandle ?? articleHandleFromBlogPage(input.page);
  if (input.page && !pageHandle) return { kind: "skip", reason: "nonBlogExistingPage" };
  if (pageHandle && !input.matchedArticle) return { kind: "skip", reason: "missingArticle" };
  if (!input.matchedArticle) return { kind: "proposal", proposalType: "new-content" };
  if (input.opportunityType === "striking_distance") {
    return { kind: "proposal", proposalType: "content-refresh" };
  }
  return { kind: "proposal", proposalType: "seo-fix" };
}
```

- [x] **Step 4: Add the >50-pair route regression**

In `__tests__/api/seo-pilot-routes.test.ts`, mock 51 query-page pairs where the target query is pair 51 and assert that the returned opportunity still contains its page:

```ts
expect(body.opportunities.find((row: { query: string }) => row.query === "target query"))
  .toEqual(expect.objectContaining({
    page: "https://agrikoph.com/blogs/news/target-article",
  }));
```

Also add a route test asserting a mapped `striking_distance` promotion creates:

```ts
expect.objectContaining({
  proposalType: "content-refresh",
  articleHandle: "target-article",
  proposedState: expect.objectContaining({ action: "expand" }),
})
```

- [x] **Step 5: Run the route tests and verify the old code fails**

Run:

```bash
npm test -- --run __tests__/api/seo-pilot-routes.test.ts
```

Expected: FAIL on pair 51 attribution and striking-distance classification.

- [x] **Step 6: Use complete mappings for calculation and shared classification for promotion**

In `app/api/seo/route.ts`, replace the pre-calculation slice with separate calculation and display variables:

```ts
const allQueryPagePairs = gscData.queryPagePairs;
const opportunities = computeCtrOpportunities(
  queries,
  allQueryPagePairs,
  research,
  pageConversion,
);
const queryPagePairs = allQueryPagePairs.slice(0, 50);
```

Return attribution-limit metadata:

```ts
limits: {
  queryPagePairsTotal: allQueryPagePairs.length,
  queryPagePairsReturned: queryPagePairs.length,
  queryPagePairsTruncated: allQueryPagePairs.length > queryPagePairs.length,
},
```

In `app/api/seo/gaps/promote/route.ts`, delete the local page parser and proposal-type ternary. Call `classifySeoPromotion()`, increment the typed skip counter when `kind === "skip"`, and build `content-refresh` state with `action: "expand"` for striking-distance work.

- [x] **Step 7: Run Task 1 tests**

Run:

```bash
npm test -- --run __tests__/lib/seo/promotion.test.ts __tests__/lib/seo/opportunities.test.ts __tests__/api/seo-pilot-routes.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit Task 1**

```bash
git add lib/seo/promotion.ts app/api/seo/route.ts app/api/seo/gaps/promote/route.ts __tests__/lib/seo/promotion.test.ts __tests__/api/seo-pilot-routes.test.ts
git commit -m "fix: classify SEO opportunities from complete page mappings"
```

---

### Task 2: Keep Separate Findings and Detect H1 Correctly

**Files:**
- Create: `lib/seo/analysis.ts`
- Create: `__tests__/lib/seo/analysis.test.ts`
- Create: `__tests__/lib/seo/health.test.ts`
- Modify: `app/api/seo/analyze/route.ts`
- Modify: `app/api/seo/health/route.ts`
- Modify: `lib/seo/health.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/ContentGapsPanel.tsx`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OnPageHealthPanel.tsx`
- Modify: `__tests__/api/seo-pilot-routes.test.ts`

**Interfaces:**
- Consumes: normalized GSC rows, query-page pairs, and `ArticleRecord` SEO fields.
- Produces:

```ts
export interface SeoAnalysisLimits {
  queriesTotal: number;
  queriesAnalyzed: number;
  articlesTotalLowerBound: number;
  articlesAnalyzed: number;
  articlesTruncated: boolean;
}

export interface SeoAnalysisArticle {
  handle: string;
  title: string;
  wordCount: number | null;
  internalLinkCount: number | null;
  seoData: unknown;
}

export interface ProgrammaticSeoGap {
  query: string;
  impressions: number;
  position: number;
  suggestedTitle: string;
  issue?: "missing-meta" | "thin-content";
  articleHandle?: string;
  wordCount?: number | null;
}

export function buildProgrammaticSeoGaps(input: {
  queries: GscQueryRow[];
  queryPagePairs: GscQueryPageRow[];
  articles: SeoAnalysisArticle[];
  queryLimit?: number;
}): ProgrammaticSeoGap[];
```

- `aggregateOnPageHealth()` continues returning totals/offenders and adds `limits` supplied by the route.

- [x] **Step 1: Write failing analysis regressions**

Create `__tests__/lib/seo/analysis.test.ts` with:

```ts
it("keeps thin-content and missing-meta findings for the same article", () => {
  const gaps = buildProgrammaticSeoGaps({
    queries: [],
    queryPagePairs: [],
    articles: [{
      handle: "thin-and-meta",
      title: "Thin and Meta",
      wordCount: 120,
      internalLinkCount: 0,
      seoData: { issues: ["missing-meta-description"] },
    }],
  });
  expect(gaps.map((gap) => gap.issue)).toEqual(["thin-content", "missing-meta"]);
});

it("does not suppress a meta finding because another title shares its prefix", () => {
  const gaps = buildProgrammaticSeoGaps({
    queries: [{ query: "black rice benefits", clicks: 0, impressions: 100, ctr: "0%", position: "8" }],
    queryPagePairs: [],
    articles: [{
      handle: "black-rice",
      title: "Black Rice",
      wordCount: 700,
      internalLinkCount: 2,
      seoData: { titleLength: 0 },
    }],
  });
  expect(gaps).toEqual(expect.arrayContaining([
    expect.objectContaining({ articleHandle: "black-rice", issue: "missing-meta" }),
  ]));
});
```

- [x] **Step 2: Write failing H1 regressions**

Create `__tests__/lib/seo/health.test.ts` with:

```ts
it("reports missing H1 when H2/H3 headings exist", () => {
  const result = aggregateOnPageHealth([{
    handle: "structured-without-h1",
    title: "Structured without H1",
    wordCount: 800,
    internalLinkCount: 2,
    headingCount: 4,
    inboundCount: 1,
    seoData: { h1Count: 0, issues: ["missing-h1"] },
  }]);
  expect(result.totals.missingH1).toBe(1);
  expect(result.worstOffenders[0]?.issues).toContain("Missing H1");
});

it("does not report missing H1 when h1Count is positive", () => {
  const result = aggregateOnPageHealth([{
    handle: "has-h1",
    title: "Has H1",
    wordCount: 800,
    internalLinkCount: 2,
    headingCount: 1,
    inboundCount: 1,
    seoData: { h1Count: 1, issues: [] },
  }]);
  expect(result.totals.missingH1).toBe(0);
});
```

- [x] **Step 3: Run both tests and verify they fail**

```bash
npm test -- --run __tests__/lib/seo/analysis.test.ts __tests__/lib/seo/health.test.ts
```

Expected: FAIL because `analysis.ts` is missing and health uses total heading count.

- [x] **Step 4: Extract programmatic gap construction**

Move the pure gap-building logic from `app/api/seo/analyze/route.ts` into `lib/seo/analysis.ts`. Deduplicate using structured keys:

```ts
const gapKey = (gap: ProgrammaticSeoGap) =>
  gap.articleHandle
    ? `${gap.issue ?? "article"}:${gap.articleHandle.toLowerCase()}`
    : `new-content:${gap.query.trim().toLowerCase()}`;
```

Do not use `suggestedTitle.startsWith()`. Add thin-content and missing-meta loops independently, then call a `uniqueBy(gapKey)` pass that preserves both issue types.

- [x] **Step 5: Correct H1 derivation**

Extend the local SEO-data shape in `lib/seo/health.ts`:

```ts
interface SeoDataLike {
  issues?: unknown;
  h1Count?: unknown;
  // existing meta fields remain
}

function isMissingH1(seoData: unknown, headingCount: number): boolean {
  if (seoData && typeof seoData === "object") {
    const data = seoData as SeoDataLike;
    const issues = Array.isArray(data.issues) ? data.issues.map(String) : [];
    if (issues.includes("missing-h1")) return true;
    if (typeof data.h1Count === "number") return data.h1Count === 0;
  }
  return headingCount === 0;
}
```

Use `isMissingH1(a.seoData, a.headingCount)` instead of `a.headingCount < 1`.

- [x] **Step 6: Add disclosed corpus limits**

In `app/api/seo/analyze/route.ts`, fetch 201 articles, analyze the first 200, and return:

```ts
const ARTICLE_LIMIT = 200;
const articleCandidates = await prisma.articleRecord.findMany({
  select: { handle: true, title: true, wordCount: true, internalLinkCount: true, seoData: true },
  orderBy: [{ indexedAt: "desc" }, { handle: "asc" }],
  take: ARTICLE_LIMIT + 1,
});
const articleRecords = articleCandidates.slice(0, ARTICLE_LIMIT);
const limits: SeoAnalysisLimits = {
  queriesTotal: gscData.queries.length,
  queriesAnalyzed: Math.min(gscData.queries.length, 30),
  articlesTotalLowerBound: articleCandidates.length,
  articlesAnalyzed: articleRecords.length,
  articlesTruncated: articleCandidates.length > ARTICLE_LIMIT,
};
```

In `app/api/seo/health/route.ts`, use the same `limit + 1` pattern with `ARTICLE_LIMIT = 500`, slice before aggregation, and return `limits` alongside totals/offenders. In both affected panels, show a caution banner/text when `articlesTruncated` is true; never say the corpus is completely clean when only a subset was inspected.

- [x] **Step 7: Run Task 2 tests**

```bash
npm test -- --run __tests__/lib/seo/analysis.test.ts __tests__/lib/seo/health.test.ts __tests__/api/seo-pilot-routes.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit Task 2**

```bash
git add lib/seo/analysis.ts lib/seo/health.ts app/api/seo/analyze/route.ts app/api/seo/health/route.ts 'app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts' 'app/(embedded)/(seo-pillar)/seo-pillar/components/panels/ContentGapsPanel.tsx' 'app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OnPageHealthPanel.tsx' __tests__/lib/seo/analysis.test.ts __tests__/lib/seo/health.test.ts __tests__/api/seo-pilot-routes.test.ts
git commit -m "fix: separate SEO findings and detect missing H1"
```

---

### Task 3: Persist Canonical Proposal Keys and Enforce Database Idempotency

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260710160000_add_content_proposal_dedupe_key/migration.sql`
- Create: `lib/content-pilot/create-proposal.ts`
- Modify: `lib/content-pilot/proposal-dedupe.ts`
- Modify: `__tests__/lib/content-pilot/proposal-dedupe.test.ts`
- Create: `__tests__/lib/content-pilot/create-proposal.test.ts`
- Create: `__tests__/prisma/content-proposal-dedupe-migration.test.ts`

**Interfaces:**
- Consumes: `contentProposalDedupeKey()` and Prisma `ContentProposalCreateInput` data.
- Produces:

```ts
import type { Prisma } from "@prisma/client";

export function withContentProposalDedupeKey<T extends ContentProposalDedupeInput>(
  input: T,
): T & { dedupeKey: string };

export type ContentProposalCreateData =
  Prisma.ContentProposalUncheckedCreateInput & ContentProposalDedupeInput;

export interface ContentProposalCreateClient<TProposal> {
  contentProposal: {
    create(args: { data: ContentProposalCreateData }): Promise<TProposal>;
    findUnique(args: { where: { dedupeKey: string } }): Promise<TProposal | null>;
  };
}

export async function createContentProposalOnce<TProposal>(
  client: ContentProposalCreateClient<TProposal>,
  data: ContentProposalCreateData,
): Promise<{ proposal: TProposal; created: boolean }>;
```

- `createContentProposalOnce()` creates with a canonical non-null key and catches only Prisma `P2002`; on conflict it returns `findUnique({ where: { dedupeKey } })`.
- Change `ContentProposalDedupeInput.articleHandle` to `articleHandle?: string | null` so handle-less create inputs can be keyed without unsafe casts; existing callers that pass an explicit value remain compatible.

- [x] **Step 1: Add failing helper and concurrency tests**

In `__tests__/lib/content-pilot/create-proposal.test.ts`, model a winner/loser race:

```ts
it("returns the existing proposal when a concurrent canonical-key insert wins", async () => {
  const existing = { id: "winner", dedupeKey: "seo-fix:article:black-rice:action:missing-meta" };
  const client = {
    contentProposal: {
      create: vi.fn().mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" })),
      findUnique: vi.fn().mockResolvedValue(existing),
    },
  };
  await expect(createContentProposalOnce(client, {
    proposalType: "seo-fix",
    articleHandle: "black-rice",
    title: "Fix meta: Black Rice",
    proposedState: { issue: "missing-meta" },
  } as never)).resolves.toEqual({ proposal: existing, created: false });
});
```

Also assert non-`P2002` errors rethrow and a `P2002` with no matching row rethrows rather than returning `null`.

- [x] **Step 2: Add migration source tests**

Create `__tests__/prisma/content-proposal-dedupe-migration.test.ts` and assert the migration:

```ts
expect(sql).toContain('ADD COLUMN "dedupeKey" TEXT');
expect(sql).toContain('DROP INDEX IF EXISTS "ContentProposal_active_action_dedupe_key"');
expect(sql).toContain('CREATE UNIQUE INDEX "ContentProposal_dedupeKey_key"');
expect(sql).toContain('ALTER COLUMN "dedupeKey" SET NOT NULL');
expect(sql).toContain(":history:");
```

Add pure-key tests proving:

- `Fix meta: X` and `Improve SERP snippet: X` have the same key when issue/query match;
- thin-content and missing-meta on one handle have different keys;
- internal-link destinations differ;
- handle-less proposals use normalized target keyword rather than title wording.

- [x] **Step 3: Run Task 3 tests and verify failure**

```bash
npm test -- --run __tests__/lib/content-pilot/proposal-dedupe.test.ts __tests__/lib/content-pilot/create-proposal.test.ts __tests__/prisma/content-proposal-dedupe-migration.test.ts
```

Expected: FAIL because the persisted key, helper, and migration are absent.

- [x] **Step 4: Add the Prisma field**

Add to `ContentProposal`:

```prisma
dedupeKey String @unique @default(cuid())
```

The default keeps intentional one-off paths such as Clone unique until they are explicitly assigned a semantic key. Automated generation paths are migrated in Task 4 and must never rely on the random default.

- [x] **Step 5: Write the deterministic backfill migration**

The migration must:

1. add nullable `dedupeKey`;
2. calculate a normalized canonical key from `proposalType`, `articleHandle`, and `proposedState` using the same precedence as `contentProposalDedupeKey()`;
3. rank duplicate canonical identities with operator-decided states first, then oldest `createdAt`, then `id`;
4. assign the first row the canonical key and later historical collisions `${canonical}:history:${id}`;
5. set the column non-null;
6. drop the old title-based partial index;
7. create the unique key index.

Use this SQL shape, preserving the full normalization expressions in the migration rather than calling application code:

```sql
ALTER TABLE "ContentProposal" ADD COLUMN "dedupeKey" TEXT;

WITH normalized AS (
  SELECT
    "id",
    CASE
      WHEN NULLIF(btrim("articleHandle"), '') IS NOT NULL THEN
        lower(regexp_replace(btrim("proposalType"), '\s+', ' ', 'g')) ||
        ':article:' || lower(regexp_replace(btrim("articleHandle"), '\s+', ' ', 'g')) ||
        CASE
          WHEN lower(btrim("proposalType")) = 'internal-link' THEN
            ':to:' || lower(regexp_replace(btrim(COALESCE(
              NULLIF("proposedState"->>'toArticle', ''),
              NULLIF("proposedState"->>'targetArticle', ''),
              NULLIF("proposedState"->>'suggestedAnchorText', ''),
              "title"
            )), '\s+', ' ', 'g'))
          WHEN lower(btrim("proposalType")) = 'seo-fix' THEN
            ':action:' || lower(regexp_replace(btrim(COALESCE(
              NULLIF(concat_ws(':',
                COALESCE(
                  NULLIF("proposedState"->>'issue', ''),
                  NULLIF("proposedState"->>'action', '')
                ),
                NULLIF("proposedState"->>'targetQuery', '')
              ), ''),
              "title"
            )), '\s+', ' ', 'g'))
          ELSE ''
        END
      ELSE
        lower(regexp_replace(btrim("proposalType"), '\s+', ' ', 'g')) ||
        ':handleless:' || lower(regexp_replace(btrim(COALESCE(
          NULLIF("proposedState"->>'targetKeyword', ''),
          NULLIF("proposedState"->>'targetQuery', ''),
          NULLIF("proposedState"->>'suggestedTitle', ''),
          NULLIF("proposedState"->>'title', ''),
          "title"
        )), '\s+', ' ', 'g'))
    END AS canonical_key,
    "status",
    "createdAt"
  FROM "ContentProposal"
), ranked AS (
  SELECT *, row_number() OVER (
    PARTITION BY canonical_key
    ORDER BY
      CASE WHEN "status" IN ('approved','override_approved','published','rejected') THEN 0 ELSE 1 END,
      "createdAt" ASC,
      "id" ASC
  ) AS duplicate_rank
  FROM normalized
)
UPDATE "ContentProposal" AS proposal
SET "dedupeKey" = CASE
  WHEN ranked.duplicate_rank = 1 THEN ranked.canonical_key
  ELSE ranked.canonical_key || ':history:' || ranked."id"
END
FROM ranked
WHERE proposal."id" = ranked."id";

ALTER TABLE "ContentProposal" ALTER COLUMN "dedupeKey" SET NOT NULL;
DROP INDEX IF EXISTS "ContentProposal_active_action_dedupe_key";
CREATE UNIQUE INDEX "ContentProposal_dedupeKey_key" ON "ContentProposal"("dedupeKey");
```

The `seo-fix` SQL deliberately uses `COALESCE(issue, action)` before appending `targetQuery`; this matches the TypeScript precedence and produces exactly one colon-separated action string.

- [x] **Step 6: Implement the create-once helper**

In `lib/content-pilot/create-proposal.ts`:

```ts
function isUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (error as { code?: string }).code === "P2002";
}

export async function createContentProposalOnce<TProposal>(
  client: ContentProposalCreateClient<TProposal>,
  data: ContentProposalCreateData,
): Promise<{ proposal: TProposal; created: boolean }> {
  const keyed = withContentProposalDedupeKey(data);
  try {
    return {
      proposal: await client.contentProposal.create({ data: keyed }),
      created: true,
    };
  } catch (error) {
    if (!isUniqueError(error)) throw error;
    const existing = await client.contentProposal.findUnique({
      where: { dedupeKey: keyed.dedupeKey },
    });
    if (!existing) throw error;
    return { proposal: existing, created: false };
  }
}
```

- [x] **Step 7: Generate Prisma Client and run tests**

```bash
npm run db:generate
npm test -- --run __tests__/lib/content-pilot/proposal-dedupe.test.ts __tests__/lib/content-pilot/create-proposal.test.ts __tests__/prisma/content-proposal-dedupe-migration.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [x] **Step 8: Commit Task 3**

```bash
git add prisma/schema.prisma prisma/migrations/20260710160000_add_content_proposal_dedupe_key/migration.sql lib/content-pilot/proposal-dedupe.ts lib/content-pilot/create-proposal.ts __tests__/lib/content-pilot/proposal-dedupe.test.ts __tests__/lib/content-pilot/create-proposal.test.ts __tests__/prisma/content-proposal-dedupe-migration.test.ts
git commit -m "fix: enforce canonical content proposal idempotency"
```

---

### Task 4: Route Every Automated Proposal Producer Through Canonical Keys

**Files:**
- Modify: `app/api/seo/promote/route.ts`
- Modify: `app/api/seo/gaps/promote/route.ts`
- Modify: `app/api/seo/recommendations/decompose/route.ts`
- Modify: `app/api/content-pilot/proposals/manual/route.ts`
- Modify: `app/api/content-pilot/proposals/generate/route.ts`
- Modify: `app/api/content-pilot/proposals/refresh-all/route.ts`
- Modify: `app/api/cron/daily/route.ts`
- Modify: `lib/opportunities/route.ts`
- Modify: `__tests__/api/seo-pilot-routes.test.ts`
- Modify: `__tests__/api/content-pilot-routes.test.ts`
- Modify: `__tests__/lib/opportunities/route.test.ts`

**Interfaces:**
- Consumes: `createContentProposalOnce()` and `withContentProposalDedupeKey()` from Task 3.
- Produces: consistent `{ created, skipped/existed, proposal }` behavior from every SEO/manual path.

- [x] **Step 1: Write cross-route logical-key regressions**

Add tests showing that all of these represent the same metadata action:

```ts
const onPage = {
  proposalType: "seo-fix",
  articleHandle: "black-rice",
  title: "Fix meta: Black Rice",
  proposedState: { issue: "missing-meta", targetQuery: "black rice" },
};
const gap = {
  proposalType: "seo-fix",
  articleHandle: "black-rice",
  title: "Improve SERP snippet: Black Rice",
  proposedState: { issue: "missing-meta", targetQuery: "black rice" },
};
expect(contentProposalDedupeKey(onPage)).toBe(contentProposalDedupeKey(gap));
```

At the route level, mock `create()` to reject `P2002`, mock `findUnique({ where: { dedupeKey } })` with the prior proposal, and assert the second endpoint reports `existed`/`skipped` without throwing.

Add a manual Strategy regression proving `New article: Black Rice Benefits` and a gap-generated title with `targetKeyword: "black rice benefits"` return the same existing row.

- [x] **Step 2: Run route tests and verify failure**

```bash
npm test -- --run __tests__/api/seo-pilot-routes.test.ts __tests__/api/content-pilot-routes.test.ts __tests__/lib/opportunities/route.test.ts
```

Expected: FAIL because several paths still check titles and call `create()` directly.

- [x] **Step 3: Replace SEO route check-then-create flows**

For `/api/seo/promote`, `/api/seo/gaps/promote`, and `/api/seo/recommendations/decompose`:

- retain canonical server-side article lookup;
- construct complete `proposedState` before deduplication;
- call `createContentProposalOnce(tx ?? prisma, data)`;
- count `created: true` as created and `created: false` as skipped/existed;
- remove title-list dedupe queries that are no longer authoritative;
- keep within-batch `Set<string>` filtering to avoid avoidable insert conflicts.

The batch pattern is:

```ts
const seen = new Set<string>();
for (const data of rows) {
  const keyed = withContentProposalDedupeKey(data);
  if (seen.has(keyed.dedupeKey)) {
    skipped++;
    continue;
  }
  seen.add(keyed.dedupeKey);
  const result = await createContentProposalOnce(tx, keyed);
  if (result.created) created.push(result.proposal);
  else skipped++;
}
```

- [x] **Step 4: Replace manual and generated creation paths**

Update the manual route to key new content by normalized `targetKeyword`. Update proposal generate/refresh/daily paths to attach `withContentProposalDedupeKey(p)` to every create after their existing historical filtering. Update opportunity routing to call `createContentProposalOnce()` instead of a non-atomic `existing ?? create` sequence.

Do not change Clone semantics: its Prisma default produces a new unique instance key. Do not change Social Ad semantics in this task because it is not an SEO automated generator and retains the safe random default.

- [x] **Step 5: Verify recreation blocking and distinct actions**

Add/retain tests for:

- rejected SEO meta action blocks reworded recreation;
- published new-content target blocks manual Strategy recreation;
- missing-meta and thin-content actions coexist;
- two internal-link destinations coexist;
- duplicate batch inputs count as skipped;
- a `P2002` conflict never returns 500.

- [x] **Step 6: Run Task 4 tests**

```bash
npm test -- --run __tests__/api/seo-pilot-routes.test.ts __tests__/api/content-pilot-routes.test.ts __tests__/lib/content-pilot/proposal-dedupe.test.ts __tests__/lib/opportunities/route.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [x] **Step 7: Commit Task 4**

```bash
git add app/api/seo/promote/route.ts app/api/seo/gaps/promote/route.ts app/api/seo/recommendations/decompose/route.ts app/api/content-pilot/proposals/manual/route.ts app/api/content-pilot/proposals/generate/route.ts app/api/content-pilot/proposals/refresh-all/route.ts app/api/cron/daily/route.ts lib/opportunities/route.ts __tests__/api/seo-pilot-routes.test.ts __tests__/api/content-pilot-routes.test.ts __tests__/lib/opportunities/route.test.ts
git commit -m "fix: share proposal identity across SEO creation paths"
```

---

### Task 5: Make SEO AI Analysis and Decomposition Fail Reliably

**Files:**
- Create: `lib/seo/ai-output.ts`
- Create: `__tests__/lib/seo/ai-output.test.ts`
- Modify: `app/api/seo/analyze/route.ts`
- Modify: `app/api/seo/recommendations/decompose/route.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx`
- Modify: `__tests__/api/seo-pilot-routes.test.ts`

**Interfaces:**
- Consumes: `chatCompletionWithFailover()` and route-specific Zod schemas.
- Produces:

```ts
export type AiStructuredParse<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "empty" | "invalid-json" | "invalid-schema" };

export function parseJsonObject<T>(text: string, schema: z.ZodType<T>): AiStructuredParse<T>;
export function parseJsonArray<T>(text: string, schema: z.ZodType<T>): AiStructuredParse<T>;
```

- SEO analysis responses add `aiStatus: "complete" | "partial"` and optional safe `aiError`.

- [x] **Step 1: Write structured-output parser tests**

Cover plain JSON, fenced JSON, reasoning-only content passed in as text, empty text, malformed JSON, and schema-invalid JSON:

```ts
expect(parseJsonObject("", schema)).toEqual({ ok: false, reason: "empty" });
expect(parseJsonObject('{"quickWins":42}', schema)).toEqual({ ok: false, reason: "invalid-schema" });
```

- [x] **Step 2: Write route reliability regressions**

In `__tests__/api/seo-pilot-routes.test.ts`, mock `chatCompletionWithFailover()` and assert:

- valid returned `content` persists a complete analysis;
- reasoning-only provider output is already normalized into `content` and parses;
- empty/invalid analysis output returns programmatic gaps with `aiStatus: "partial"` and does not claim complete AI recommendations;
- decomposition invalid output returns 502;
- validated `[]` returns 200 with zero tasks;
- provider auth/config failure returns 503 with safe detail;
- timeout returns 504;
- the route imports/calls the failover helper rather than `getAiClient()`.

- [x] **Step 3: Run tests and verify failure**

```bash
npm test -- --run __tests__/lib/seo/ai-output.test.ts __tests__/api/seo-pilot-routes.test.ts
```

Expected: FAIL because both routes still call one client directly and silently accept parse failures.

- [x] **Step 4: Implement shared structured parsing**

`parseJsonObject()` extracts the first balanced object candidate already accepted by the route; `parseJsonArray()` extracts the array candidate. Both return typed failure reasons and never throw for model text.

- [x] **Step 5: Migrate analysis to failover and explicit partial state**

Replace direct client creation with:

```ts
const { content } = await chatCompletionWithFailover({
  max_tokens: 1000,
  messages,
}, {
  deepseekModel: "deepseek-v4-pro",
  openRouterModel: "deepseek/deepseek-v4-pro",
  requestOptions: { signal: aiTimeout },
});
```

When parsing fails, retain deterministic `contentGaps`, set quick wins/recommendations empty, set `aiStatus: "partial"`, and return a safe reason such as `AI returned invalid structured output`. Persist the status with the analysis snapshot so a reload does not lose the warning.

- [x] **Step 6: Migrate decomposition to failover and typed failure responses**

Use the same helper. Treat validated `[]` as a successful no-op. Map parse failures to 502, provider configuration/authentication to 503, and timeout to 504. Keep handles validated against canonical articles before row construction.

- [x] **Step 7: Surface partial analysis in the UI**

Extend `Analysis` with:

```ts
aiStatus?: "complete" | "partial";
aiError?: string;
limits?: SeoAnalysisLimits;
```

When `aiStatus === "partial"`, show a caution banner that programmatic findings are available but AI strategy text failed and can be retried. Do not discard or hide content gaps.

- [x] **Step 8: Run Task 5 tests**

```bash
npm test -- --run __tests__/lib/seo/ai-output.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/api/seo-brief-grounding.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [x] **Step 9: Commit Task 5**

```bash
git add lib/seo/ai-output.ts app/api/seo/analyze/route.ts app/api/seo/recommendations/decompose/route.ts 'app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts' 'app/(embedded)/(seo-pillar)/seo-pillar/page.tsx' __tests__/lib/seo/ai-output.test.ts __tests__/api/seo-pilot-routes.test.ts
git commit -m "fix: harden SEO AI output and provider failover"
```

---

### Task 6: Preserve Valid Client Data and Hydrate Comparison/Keyword State

**Files:**
- Modify: `lib/seo/data.ts`
- Modify: `app/api/seo/route.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/useSeoData.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts`
- Modify: `__tests__/lib/seo/data.test.ts`
- Create: `__tests__/components/use-seo-data.test.ts`
- Modify: `__tests__/api/seo-pilot-routes.test.ts`
- Modify: `__tests__/components/pilot-usability-helpers.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PreviousGscData {
  queries: GscQueryRow[];
  fetchedAt: Date;
  dateRangeStart: Date;
  dateRangeEnd: Date;
  source: Exclude<GscDataSource, "none">;
}

export async function getPreviousGscData(current: LatestGscData): Promise<PreviousGscData | null>;

export async function loadSeoCoreRequest(
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  commit: (data: SeoData) => void,
): Promise<void>;
```

- Keep `getPreviousGscQueries()` as a compatibility wrapper for Dashboard movers and keyword reporting.

- [x] **Step 1: Write previous-period metadata tests**

In `__tests__/lib/seo/data.test.ts`, assert normalized and raw paths return query rows plus the actual previous capture/window timestamp. In the SEO route test, mock `getPreviousGscData()` and assert:

```ts
expect(body.trends.previousFetchedAt).toBe("2026-06-01T00:00:00.000Z");
expect(body.trends.previous).not.toBeNull();
```

- [x] **Step 2: Write hook failure/cache tests**

Create `__tests__/components/use-seo-data.test.ts` without adding a DOM-testing dependency. Test the exported `loadSeoCoreRequest()` helper by making `/api/seo` return 500 and asserting:

- the `commit` callback is not called;
- the promise rejects with the safe server error;
- an error payload is never passed to cache/state commit logic.

Then mock a successful load and assert `commit(validSeoData)` runs exactly once. The hook passes one commit callback that performs `setCache()` and `setData()` only after `loadSeoCoreRequest()` validates the response.

- [x] **Step 3: Write tracked-keyword hydration regression**

Render the SEO page or extract/export a small pure helper:

```ts
export const trackedKeywordSet = (keywords: KeywordRow[]) =>
  new Set(keywords.map((row) => row.keyword.trim().toLowerCase()));
```

Assert persisted `black rice benefits` makes the Strategy action render `Tracked` after initial load rather than `Track`.

- [x] **Step 4: Run Task 6 tests and verify failure**

```bash
npm test -- --run __tests__/lib/seo/data.test.ts __tests__/components/use-seo-data.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/components/pilot-usability-helpers.test.ts
```

Expected: FAIL on missing previous metadata, silent core failure, and empty tracked state.

- [x] **Step 5: Add previous-data metadata without breaking existing callers**

Implement `getPreviousGscData()` for normalized and raw snapshot sources. Refactor `getPreviousGscQueries()` to:

```ts
export async function getPreviousGscQueries(current: LatestGscData): Promise<GscQueryRow[] | null> {
  return (await getPreviousGscData(current))?.queries ?? null;
}
```

Use `getPreviousGscData()` in `/api/seo` and pass `previous?.fetchedAt.toISOString() ?? null` to `computeTrends()`.

- [x] **Step 6: Make `loadCore()` reject failed responses before parsing/caching**

Use:

```ts
export async function loadSeoCoreRequest(
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  commit: (data: SeoData) => void,
): Promise<void> {
  const response = await authFetch("/api/seo");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error : "SEO data");
  }
  const next = await response.json() as SeoData;
  commit(next);
}

const loadCore = useCallback(async () => {
  await loadSeoCoreRequest(authFetch, (next) => {
    setCache("/api/seo", next);
    setData(next);
  });
}, [authFetch]);
```

Do not clear `data` on failure. The existing `loadAllSections()` tracker will add the section banner.

- [x] **Step 7: Hydrate tracked state from server rows**

Import `useEffect` in the page and synchronize normalized persisted keywords:

```ts
useEffect(() => {
  setTrackedKw(new Set(keywords.map((row) => row.keyword.trim().toLowerCase())));
}, [keywords]);
```

Normalize keys in `trackKeyword()` before adding/removing them from state so fetched and just-created rows use identical identity.

- [x] **Step 8: Run Task 6 tests**

```bash
npm test -- --run __tests__/lib/seo/data.test.ts __tests__/components/use-seo-data.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/components/pilot-usability-helpers.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [x] **Step 9: Commit Task 6**

```bash
git add lib/seo/data.ts app/api/seo/route.ts 'app/(embedded)/(seo-pillar)/seo-pillar/components/useSeoData.ts' 'app/(embedded)/(seo-pillar)/seo-pillar/page.tsx' 'app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts' __tests__/lib/seo/data.test.ts __tests__/components/use-seo-data.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/components/pilot-usability-helpers.test.ts
git commit -m "fix: preserve SEO data and hydrate comparison state"
```

---

### Task 7: Enforce Null-Safe Tracked-Keyword Uniqueness

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260710161000_market_keyword_null_safe_unique/migration.sql`
- Modify: `app/api/seo/keywords/route.ts`
- Modify: `__tests__/api/seo-pilot-routes.test.ts`
- Create: `__tests__/prisma/market-keyword-null-safe-migration.test.ts`

**Interfaces:**
- Consumes: normalized keyword input and Prisma `P2002` handling.
- Produces: atomic create-or-reactivate behavior for `(normalized keyword, normalized nullable location, normalized language)`.

- [x] **Step 1: Write the concurrent-insert regression**

In `__tests__/api/seo-pilot-routes.test.ts`, mock the initial create with `P2002`, then mock `findFirst()` and `update()` for the winning row:

```ts
mockPrisma.marketKeyword.create.mockRejectedValue(
  Object.assign(new Error("unique"), { code: "P2002" }),
);
mockPrisma.marketKeyword.findFirst.mockResolvedValue({ id: "winner" });

expect(await res.json()).toEqual({ ok: true, keyword: "black rice benefits" });
expect(mockPrisma.marketKeyword.update).toHaveBeenCalledWith({
  where: { id: "winner" },
  data: { active: true, category: "seo" },
});
```

- [x] **Step 2: Write migration source tests**

Assert the migration reassigns all four foreign-key consumers before deleting duplicates:

```ts
for (const table of ["ShoppingResult", "ShoppingPriceHistory", "KeywordResearchResult", "MarketInsight"]) {
  expect(sql).toContain(`UPDATE "${table}"`);
}
expect(sql).toContain('DROP INDEX IF EXISTS "MarketKeyword_keyword_locationName_languageCode_key"');
expect(sql).toContain("COALESCE");
expect(sql).toContain("CREATE UNIQUE INDEX");
```

- [x] **Step 3: Run tests and verify failure**

```bash
npm test -- --run __tests__/api/seo-pilot-routes.test.ts __tests__/prisma/market-keyword-null-safe-migration.test.ts
```

Expected: FAIL because the route uses find-then-create and the existing index treats nulls as distinct.

- [x] **Step 4: Write the null-safe migration**

The migration will:

1. normalize duplicate identity with `lower(regexp_replace(btrim(keyword), '\s+', ' ', 'g'))`, `COALESCE(lower(btrim(locationName)), '')`, and `lower(btrim(languageCode))`;
2. select the oldest row as survivor;
3. update `ShoppingResult.marketKeywordId`, `ShoppingPriceHistory.marketKeywordId`, `KeywordResearchResult.marketKeywordId`, and `MarketInsight.keywordId` to the survivor;
4. delete duplicate `MarketKeyword` rows;
5. drop the nullable compound unique index;
6. create a null-safe expression unique index over the normalized identity.

Use CTEs shaped as:

```sql
WITH ranked AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY
        lower(regexp_replace(btrim("keyword"), '\s+', ' ', 'g')),
        COALESCE(lower(btrim("locationName")), ''),
        lower(btrim("languageCode"))
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS survivor_id,
    row_number() OVER (
      PARTITION BY
        lower(regexp_replace(btrim("keyword"), '\s+', ' ', 'g')),
        COALESCE(lower(btrim("locationName")), ''),
        lower(btrim("languageCode"))
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS duplicate_rank
  FROM "MarketKeyword"
)
UPDATE "ShoppingResult" AS child
SET "marketKeywordId" = ranked.survivor_id
FROM ranked
WHERE child."marketKeywordId" = ranked."id" AND ranked.duplicate_rank > 1;
```

Repeat the update for each child table, then delete ranked duplicates. Create:

```sql
CREATE UNIQUE INDEX "MarketKeyword_normalized_identity_key"
ON "MarketKeyword" (
  lower(regexp_replace(btrim("keyword"), '\s+', ' ', 'g')),
  COALESCE(lower(btrim("locationName")), ''),
  lower(btrim("languageCode"))
);
```

In `schema.prisma`, remove the misleading `@@unique([keyword, locationName, languageCode])` and retain a normal lookup index with a comment noting the expression unique index owned by the migration.

- [x] **Step 5: Change POST to create-first with `P2002` recovery**

Normalize the keyword, attempt `create()`, and on `P2002` locate the case-insensitive existing null-location English row and reactivate it. Rethrow every non-unique database error.

```ts
try {
  await prisma.marketKeyword.create({
    data: { keyword, category: "seo", languageCode: "en", active: true },
  });
} catch (error) {
  if (!isPrismaUniqueError(error)) throw error;
  const existing = await prisma.marketKeyword.findFirst({
    where: {
      keyword: { equals: keyword, mode: "insensitive" },
      locationName: null,
      languageCode: "en",
    },
    select: { id: true },
  });
  if (!existing) throw error;
  await prisma.marketKeyword.update({
    where: { id: existing.id },
    data: { active: true, category: "seo" },
  });
}
```

- [x] **Step 6: Run Task 7 tests and typecheck**

```bash
npm test -- --run __tests__/api/seo-pilot-routes.test.ts __tests__/prisma/market-keyword-null-safe-migration.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [x] **Step 7: Commit Task 7**

```bash
git add prisma/schema.prisma prisma/migrations/20260710161000_market_keyword_null_safe_unique/migration.sql app/api/seo/keywords/route.ts __tests__/api/seo-pilot-routes.test.ts __tests__/prisma/market-keyword-null-safe-migration.test.ts
git commit -m "fix: enforce null-safe SEO keyword identity"
```

---

### Task 8: Establish a Non-Interactive ESLint Gate

**Files:**
- Create: `eslint.config.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `npm run lint` executing `eslint .` without prompts.
- Uses official Next.js flat config exports `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`.

- [x] **Step 1: Record the current failing lint behavior**

Run:

```bash
npm run lint
```

Expected: interactive “How would you like to configure ESLint?” prompt; terminate without choosing an option.

- [x] **Step 2: Install compatible lint dependencies**

Run:

```bash
npm install --save-dev eslint@^9 eslint-config-next@15.5.19
```

Expected: `package.json` and `package-lock.json` add ESLint and the Next.js config without changing runtime dependencies.

- [x] **Step 3: Add the official flat configuration**

Create `eslint.config.mjs`:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".next.build/**",
    ".next.new/**",
    "coverage/**",
    "node_modules/**",
    "out/**",
    "tmp/**",
    "next-env.d.ts",
  ]),
]);
```

Change the script to:

```json
"lint": "eslint ."
```

- [x] **Step 4: Run lint and resolve configuration-level failures**

```bash
npm run lint
```

Expected: the command runs without a prompt. Any application-source error must be returned to the earlier task that owns that file, fixed with a focused regression where behavior changes, and committed with that task. Task 8 itself owns only lint configuration and dependency files. Warnings may remain visible but must not hide errors.

- [x] **Step 5: Verify the command fails on invalid input**

Run:

```bash
echo 'const broken =' | npx eslint --stdin --stdin-filename lint-probe.ts
```

Expected: exit code 1 with a parsing error. Then rerun `npm run lint` and expect exit code 0.

- [x] **Step 6: Run typecheck and focused tests after any lint-driven edits**

```bash
npx tsc --noEmit
npm test -- --run __tests__/api/seo-pilot-routes.test.ts __tests__/components/use-seo-data.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit Task 8**

```bash
git add eslint.config.mjs package.json package-lock.json
git commit -m "chore: add non-interactive ESLint gate"
```

---

### Task 9: Full Verification, Migration Review, and GROW Record

**Files:**
- Modify: `.mex/ROUTER.md`
- Modify: `.mex/patterns/seo-pilot-proposal-actions.md`
- Modify: `.mex/patterns/generation-dedupe.md`
- Modify: `docs/superpowers/plans/2026-07-10-seo-pilot-functional-remediation.md` only to check completed boxes during execution

**Interfaces:**
- Consumes: all prior task deliverables.
- Produces: verified repository state and durable project guidance for future SEO Pilot work.

- [x] **Step 1: Review migration safety without applying production changes**

Run:

```bash
npx prisma validate
npx prisma generate
git diff -- prisma/schema.prisma prisma/migrations
```

Confirm explicitly:

- Content Proposal backfill gives every row a unique non-null key;
- one canonical historical row retains the blocker key;
- historical collisions receive stable `:history:<id>` suffixes;
- the old title-based partial index is dropped;
- Market Keyword children are reassigned before duplicate parents are deleted;
- no migration modifies proposal approval, draft, publish, or review fields.

- [x] **Step 2: Run focused functional suites**

```bash
npm test -- --run \
  __tests__/api/seo-pilot-routes.test.ts \
  __tests__/api/content-pilot-routes.test.ts \
  __tests__/lib/seo \
  __tests__/lib/content-pilot \
  __tests__/lib/opportunities/route.test.ts \
  __tests__/components/use-seo-data.test.ts \
  __tests__/components/pilot-usability-helpers.test.ts \
  __tests__/prisma/content-proposal-dedupe-migration.test.ts \
  __tests__/prisma/market-keyword-null-safe-migration.test.ts
```

Expected: PASS.

- [x] **Step 3: Run all repository gates**

Run each command separately and record its exit status:

```bash
npm test -- --run
npx tsc --noEmit
npm run typecheck:test
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0. Do not claim completion from partial output.

- [x] **Step 4: Perform the project Verify Checklist explicitly**

Record PASS/FAIL for every item:

1. No new API route was added; every modified embedded route still authenticates first.
2. No cron auth/lock behavior was weakened.
3. Every database call still uses `@/lib/db` or a passed Prisma transaction/client.
4. AI outputs are Zod-validated before persistence.
5. No server secret moved into a `NEXT_PUBLIC_*` variable.
6. No job handler contract changed.
7. No prompt was hard-coded outside the existing direct SEO route scope.
8. `pause_ad` guardrail membership was untouched.

- [x] **Step 5: Update GROW documentation**

Update `.mex/ROUTER.md` with the completed SEO Pilot remediation, exact verification totals, and migration names. Update `seo-pilot-proposal-actions.md` with complete-map attribution, striking-distance classification, H1-specific evidence, explicit partial analysis, and client cache failure rules. Update `generation-dedupe.md` with persisted canonical keys and `P2002` create-or-return-existing behavior. Bump `last_updated` in each changed scaffold.

Run:

```bash
mex log --type decision "SEO Pilot automated creation now uses canonical database-enforced proposal identity; landing-page attribution, structured findings, AI partial states, and tracked-keyword identity are explicit and regression-tested."
```

- [x] **Step 6: Inspect final scope**

```bash
git status --short
git diff --stat HEAD~8..HEAD
git log --oneline -10
```

Expected: only planned SEO, Content Proposal identity, keyword identity, lint, tests, migrations, and GROW files changed. No `.env`, credential, deployment, or unrelated feature files appear.

- [x] **Step 7: Commit documentation and final verification record**

```bash
git add .mex/ROUTER.md .mex/patterns/seo-pilot-proposal-actions.md .mex/patterns/generation-dedupe.md docs/superpowers/plans/2026-07-10-seo-pilot-functional-remediation.md .mex/events/decisions.jsonl
git commit -m "docs: record SEO pilot functional remediation"
```

---

## Plan Self-Review Checklist

- [x] Spec coverage: every one of the ten approved findings maps to at least one task and regression.
- [x] Completion-marker scan: no unresolved marker, deferred implementation, or unspecified error-handling step remains.
- [x] Type consistency: `SeoPromotionDecision`, `SeoAnalysisLimits`, `PreviousGscData`, `dedupeKey`, and create-once result shapes are identical across producer and consumer tasks.
- [x] Migration consistency: TypeScript and SQL canonical-key normalization produce the same values for all tested proposal shapes.
- [x] Safety consistency: no task approves or publishes proposals, invokes live Shopify writes, deploys, or applies production migrations.
- [x] Task independence: each task has a failing test, minimal implementation, passing focused gate, and commit.
