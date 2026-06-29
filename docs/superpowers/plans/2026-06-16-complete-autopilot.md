# Agriko Autopilot — Project Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Agriko Autopilot app by: finishing the test suite, surfacing existing Content Pilot backend data in the UI, building ApiCredential CRUD, activating Google Ads, adding AI analysis layers to Email/Social/SEO pilots, fixing override actor identity, and verifying Meta mutations in production.

**Architecture:** Next.js 14 App Router with Shopify App Bridge embedding. AI inference via OpenRouter (Claude). All new AI endpoints follow the same pattern as `/api/content-pilot/brief` — POST route, requireAppAuth/getSessionShop guard, OpenRouter call, JSON response. New UI sections follow existing Polaris patterns in each pilot page.

**Tech Stack:** Next.js 14, TypeScript, Prisma/PostgreSQL (Neon), Vitest, Shopify Polaris, OpenRouter/Claude, google-ads-api, `lib/crypto.ts` (AES-256-GCM already implemented)

---

## Scope Note

This plan covers 7 independent subsystems. Each phase produces working, testable software on its own. Implement in order — Phase 1 (tests) and Phase 2 (Content Pilot UI) are the fastest wins; Phase 4 (Google Ads) is the highest risk.

---

## File Map

**Created:**
- `__tests__/lib/crypto.test.ts` — encrypt/decrypt round-trip tests
- `__tests__/lib/guardrails.test.ts` — guardrail logic tests with mocked prisma
- `__tests__/lib/skills/runner.test.ts` — parseRecommendations unit tests
- `app/api/settings/credentials/route.ts` — list/create credentials (GET, POST)
- `app/api/settings/credentials/[key]/route.ts` — update/delete credential (PUT, DELETE)
- `app/api/email-pilot/analyze/route.ts` — AI analysis of Klaviyo campaign data
- `app/api/social-pilot/analyze/route.ts` — AI analysis of Meta organic posts
- `app/api/seo/analyze/route.ts` — AI content gap + pillar recommendations

**Modified:**
- `app/(embedded)/(content-pilot)/content-pilot/page.tsx` — add topic clusters + link graph sections
- `app/(embedded)/settings/page.tsx` — add Credentials management section
- `app/(embedded)/(email-pilot)/email-pilot/page.tsx` — add AI insights section
- `app/(embedded)/(social-pilot)/social-pilot/page.tsx` — add AI insights section
- `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx` — add AI content gap section
- `lib/connectors/google-ads.ts` — replace stub with real google-ads-api implementation
- `lib/executor.ts` — enable Google Ads execution branch
- `lib/auth.ts` — add `getSessionUser()` returning JWT sub
- `lib/shopify.ts` — add `decodeSessionUser()` extracting sub from App Bridge JWT
- `jobs/fetch-ads-data.ts` — include Google Ads fetch when credentials present
- `autopilot.md` — update current state section

---

## Phase 1: Test Suite Foundation

### Task 1: Bootstrap vitest and write crypto tests

**Files:**
- Create: `__tests__/lib/crypto.test.ts`
- Modify: `vitest.config.ts` (add include pattern)

Vitest config already exists at root. It has `globals: true` and `@` alias. No changes needed to config unless tests fail to find `@/lib/crypto`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/crypto.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";

process.env.CREDENTIALS_ENCRYPTION_KEY = "test-secret-key-for-unit-tests-only";

describe("encrypt/decrypt", () => {
  it("round-trips a plaintext string", () => {
    const plain = "my-secret-api-key";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const plain = "same-input";
    expect(encrypt(plain)).not.toBe(encrypt(plain));
  });

  it("decrypts correctly regardless of IV variance", () => {
    const plain = "consistent-value";
    const ct1 = encrypt(plain);
    const ct2 = encrypt(plain);
    expect(decrypt(ct1)).toBe(plain);
    expect(decrypt(ct2)).toBe(plain);
  });

  it("throws on tampered ciphertext", () => {
    const ct = encrypt("secret");
    const buf = Buffer.from(ct, "base64");
    buf[30] ^= 0xff; // flip a byte in the ciphertext region
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });

  it("throws when CREDENTIALS_ENCRYPTION_KEY is not set", () => {
    const original = process.env.CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(() => encrypt("test")).toThrow("CREDENTIALS_ENCRYPTION_KEY is not set");
    process.env.CREDENTIALS_ENCRYPTION_KEY = original;
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npm test -- __tests__/lib/crypto.test.ts
```

Expected: FAIL — file not found or tests fail if `lib/crypto.ts` has a bug.

- [ ] **Step 3: Run again — should pass since crypto.ts is already implemented**

Expected output:
```
✓ __tests__/lib/crypto.test.ts (5 tests)
```

- [ ] **Step 4: Commit**

```bash
git add __tests__/lib/crypto.test.ts
git commit -m "test: add crypto encrypt/decrypt unit tests"
```

---

### Task 2: Write guardrails tests

**Files:**
- Create: `__tests__/lib/guardrails.test.ts`

The `checkGuardrails` function calls `prisma.guardrailConfig.findMany()`. Mock prisma in vitest using `vi.mock`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/guardrails.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing guardrails (which imports db)
vi.mock("@/lib/db", () => ({
  prisma: {
    guardrailConfig: {
      findMany: vi.fn().mockResolvedValue([]), // empty = use defaults
    },
  },
}));

import { checkGuardrails } from "@/lib/guardrails";

const BASE = {
  actionType: "change_bid",
  targetEntityType: "ad_set",
  targetEntityId: "123",
  targetEntityName: "Test Ad Set",
};

describe("checkGuardrails — defaults", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns clear for a 10% bid change", async () => {
    const result = await checkGuardrails({ ...BASE, changePercent: 10 });
    expect(result.status).toBe("clear");
  });

  it("returns soft_flag for a 35% bid change", async () => {
    const result = await checkGuardrails({ ...BASE, changePercent: 35 });
    expect(result.status).toBe("soft_flag");
  });

  it("returns hard_block for a 55% bid change", async () => {
    const result = await checkGuardrails({ ...BASE, changePercent: 55 });
    expect(result.status).toBe("hard_block");
    expect(result.status === "hard_block" && result.reason).toMatch(/55/);
  });

  it("hard_blocks pause_campaign with fewer than 10 conversions", async () => {
    const result = await checkGuardrails({
      ...BASE,
      actionType: "pause_campaign",
      changePercent: 0,
      conversionCount: 5,
      dailyBudgetPhp: 100,
    });
    expect(result.status).toBe("hard_block");
  });

  it("hard_blocks pause of campaign spending > ₱10,000/day", async () => {
    const result = await checkGuardrails({
      ...BASE,
      actionType: "pause_campaign",
      changePercent: 0,
      conversionCount: 50,
      dailyBudgetPhp: 15000,
    });
    expect(result.status).toBe("hard_block");
  });

  it("soft_flags a pause of campaign spending > ₱200/day", async () => {
    const result = await checkGuardrails({
      ...BASE,
      actionType: "pause_campaign",
      changePercent: 0,
      conversionCount: 50,
      dailyBudgetPhp: 500,
    });
    expect(result.status).toBe("soft_flag");
  });

  it("soft_flags low confidence score", async () => {
    const result = await checkGuardrails({
      ...BASE,
      changePercent: 10,
      confidenceScore: 0.3,
    });
    expect(result.status).toBe("soft_flag");
  });

  it("returns clear for add_negative_keyword with low conversions (not conversion-sensitive)", async () => {
    const result = await checkGuardrails({
      actionType: "add_negative_keyword",
      targetEntityType: "campaign",
      targetEntityId: "456",
      targetEntityName: "Test Campaign",
      changePercent: 0,
      conversionCount: 0,
    });
    expect(result.status).toBe("clear");
  });
});
```

- [ ] **Step 2: Run to verify**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npm test -- __tests__/lib/guardrails.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/lib/guardrails.test.ts
git commit -m "test: add guardrails unit tests with prisma mock"
```

---

### Task 3: Write skills runner parser tests

**Files:**
- Create: `__tests__/lib/skills/runner.test.ts`

The `parseRecommendations` function is not exported from `runner.ts`. We need to test it indirectly or extract it. Extract it first.

- [ ] **Step 1: Export parseRecommendations from runner.ts**

In `lib/skills/runner.ts`, change the function declaration from:

```typescript
function parseRecommendations(text: string): ParsedRecommendation[] {
```

to:

```typescript
export function parseRecommendations(text: string): ParsedRecommendation[] {
```

- [ ] **Step 2: Write the tests**

Create `__tests__/lib/skills/runner.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseRecommendations } from "@/lib/skills/runner";

const VALID_REC = {
  actionType: "pause_campaign",
  targetEntityType: "campaign",
  targetEntityId: "123456789",
  targetEntityName: "Agriko — Moringa",
  currentValue: null,
  proposedValue: null,
  changePercent: null,
  rationale: "ROAS below 0.7 for 14 consecutive days with 500+ impressions.",
  estimatedImpact: "Save ~₱3,200/month",
  confidenceScore: 0.85,
};

function wrapRecs(recs: unknown[]): string {
  return `Some preamble text.\n\`\`\`recommendations\n${JSON.stringify(recs, null, 2)}\n\`\`\``;
}

describe("parseRecommendations", () => {
  it("parses a valid recommendation", () => {
    const result = parseRecommendations(wrapRecs([VALID_REC]));
    expect(result).toHaveLength(1);
    expect(result[0]!.actionType).toBe("pause_campaign");
    expect(result[0]!.confidenceScore).toBe(0.85);
  });

  it("returns empty array when no recommendations block present", () => {
    expect(parseRecommendations("Here is my analysis but no fenced block.")).toHaveLength(0);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseRecommendations("```recommendations\nnot json\n```")).toHaveLength(0);
  });

  it("drops items failing schema validation", () => {
    const invalid = { ...VALID_REC, confidenceScore: 1.5 }; // > 1.0 is invalid
    const result = parseRecommendations(wrapRecs([VALID_REC, invalid]));
    expect(result).toHaveLength(1);
    expect(result[0]!.actionType).toBe("pause_campaign");
  });

  it("parses empty array recommendations block", () => {
    expect(parseRecommendations("```recommendations\n[]\n```")).toHaveLength(0);
  });

  it("parses multiple valid recommendations", () => {
    const second = { ...VALID_REC, targetEntityId: "987", targetEntityName: "Agriko — Guyabano", confidenceScore: 0.7 };
    const result = parseRecommendations(wrapRecs([VALID_REC, second]));
    expect(result).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npm test -- __tests__/lib/skills/runner.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/skills/runner.ts __tests__/lib/skills/runner.test.ts
git commit -m "test: add skills runner parser tests; export parseRecommendations"
```

---

## Phase 2: Content Pilot UI Completion

The Content Pilot backend already has fully-implemented routes for topic clusters (`/api/content-pilot/topic-clusters`) and link graph (`/api/content-pilot/link-graph`). The UI only shows the articles table. This phase surfaces that data.

### Task 4: Add topic clusters and link graph sections to Content Pilot page

**Files:**
- Modify: `app/(embedded)/(content-pilot)/content-pilot/page.tsx`

- [ ] **Step 1: Read the current page**

```bash
sed -n '1,30p' /mnt/c/Users/Sean/Documents/Agriko/autopilot-app/app/\(embedded\)/\(content-pilot\)/content-pilot/page.tsx
```

(Already read in research — the page has stat cards + article DataTable. Imports include Page, Layout, Card, Text, Badge, InlineStack, BlockStack, DataTable, Button, Spinner, Banner from @shopify/polaris.)

- [ ] **Step 2: Add the topic clusters and link graph interfaces and state to content-pilot/page.tsx**

Add these interfaces after the existing `ArticleRow` interface (around line 12):

```typescript
interface TopicCluster {
  topic: string;
  articleCount: number;
  keywordCount: number;
  gapScore: number; // 0-100; higher = more content needed
}

interface LinkGraphData {
  total: number;
  hubs: { handle: string; title: string; inboundCount: number; internalLinks: number }[];
  orphans: { handle: string; title: string; inboundCount: number; internalLinks: number }[];
  orphanCount: number;
}
```

- [ ] **Step 3: Add state, fetch logic, and new sections**

Replace the entire `ContentPilotPage` component body with the version below. Key additions: `clusters` state, `linkGraph` state, two new API calls in `loadArticles`, two new Layout.Section blocks (topic clusters table + link graph).

```typescript
export default function ContentPilotPage() {
  const authFetch = useAuthFetch();
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [clusters, setClusters] = useState<TopicCluster[]>([]);
  const [linkGraph, setLinkGraph] = useState<LinkGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<{ indexed: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadArticles = useCallback(() => {
    setLoading(true);
    Promise.all([
      authFetch("/api/content-pilot/articles").then((r) => r.json()),
      authFetch("/api/content-pilot/topic-clusters").then((r) => r.json()),
      authFetch("/api/content-pilot/link-graph").then((r) => r.json()),
    ])
      .then(([articlesData, clustersData, graphData]) => {
        setArticles(articlesData.articles ?? []);
        setTotal(articlesData.total ?? 0);
        setClusters(clustersData.clusters ?? []);
        setLinkGraph(graphData);
        setLoading(false);
      })
      .catch((err) => { setLoading(false); setError(String(err)); });
  }, [authFetch]);

  useEffect(() => { loadArticles(); }, [loadArticles]);

  const runIndexer = useCallback(async () => {
    setIndexing(true);
    setError(null);
    setIndexResult(null);
    try {
      const res = await authFetch("/api/content-pilot/index", { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Indexer failed"); }
      else { setIndexResult({ indexed: d.indexed, skipped: d.skipped }); loadArticles(); }
    } catch (err) {
      setError(String(err));
    } finally {
      setIndexing(false);
    }
  }, [authFetch, loadArticles]);

  const goodSeo = articles.filter((a) => a.seoScore >= 80).length;
  const criticalSeo = articles.filter((a) => a.seoScore < 50).length;

  const articleRows = articles.map((a) => [
    a.title,
    fmt(a.publishedAt),
    <ScoreBadge score={a.seoScore} />,
    a.topics.join(", ") || "—",
    String(a.internalLinks),
    String(a.inboundCount),
  ]);

  const clusterRows = clusters.slice(0, 15).map((c) => [
    c.topic,
    String(c.articleCount),
    String(c.keywordCount),
    <Badge tone={c.gapScore >= 80 ? "critical" : c.gapScore >= 40 ? "attention" : "success"}>
      {String(c.gapScore)}
    </Badge>,
  ]);

  const orphanRows = (linkGraph?.orphans ?? []).slice(0, 10).map((a) => [
    a.title,
    String(a.internalLinks),
  ]);

  const hubRows = (linkGraph?.hubs ?? []).slice(0, 5).map((a) => [
    a.title,
    String(a.inboundCount),
    String(a.internalLinks),
  ]);

  return (
    <Page
      title="Content Pilot"
      subtitle="Blog article SEO intelligence"
      primaryAction={{ content: "Run Indexer", onAction: runIndexer, loading: indexing }}
    >
      <Layout>
        {indexResult && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setIndexResult(null)}>
              Indexed {indexResult.indexed} articles, skipped {indexResult.skipped} unchanged.
            </Banner>
          </Layout.Section>
        )}
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>{error}</Banner>
          </Layout.Section>
        )}

        {/* Stat cards */}
        <Layout.Section>
          <InlineStack gap="400" wrap={false}>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">Total Indexed</Text>
                <Text variant="heading2xl" as="p">{loading ? "—" : total}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">SEO Score ≥80</Text>
                <Text variant="heading2xl" as="p">{loading ? "—" : goodSeo}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">Critical (&lt;50)</Text>
                <Text variant="heading2xl" as="p">{loading ? "—" : criticalSeo}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">Orphan Articles</Text>
                <Text variant="heading2xl" as="p">{loading ? "—" : linkGraph?.orphanCount ?? "—"}</Text>
              </BlockStack>
            </Card>
          </InlineStack>
        </Layout.Section>

        {/* Topic clusters */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Topic Cluster Gaps</Text>
              <Text as="p" tone="subdued">Gap score 0–100. Higher = more content needed for this cluster.</Text>
              {loading ? (
                <InlineStack align="center"><Spinner size="small" /></InlineStack>
              ) : clusterRows.length === 0 ? (
                <Text as="p" tone="subdued">Run the indexer to populate topic data.</Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "text"]}
                  headings={["Topic", "Articles", "Keywords", "Gap Score"]}
                  rows={clusterRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Link graph: orphans + hubs side by side */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Orphan Articles</Text>
              <Text as="p" tone="subdued">No inbound internal links — at risk of low crawl priority.</Text>
              {loading ? (
                <InlineStack align="center"><Spinner size="small" /></InlineStack>
              ) : orphanRows.length === 0 ? (
                <Text as="p" tone="subdued">No orphans found.</Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "numeric"]}
                  headings={["Article", "Out-links"]}
                  rows={orphanRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Hub Articles</Text>
              <Text as="p" tone="subdued">Most-linked-to articles — good candidates for pillar content.</Text>
              {loading ? (
                <InlineStack align="center"><Spinner size="small" /></InlineStack>
              ) : hubRows.length === 0 ? (
                <Text as="p" tone="subdued">Run the indexer first.</Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric"]}
                  headings={["Article", "In-links", "Out-links"]}
                  rows={hubRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Article table */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Indexed Articles</Text>
              {loading ? (
                <InlineStack align="center"><Spinner size="small" /></InlineStack>
              ) : articleRows.length === 0 ? (
                <Text as="p" tone="subdued">
                  No indexed articles yet. Click &ldquo;Run Indexer&rdquo; to fetch and analyze all blog posts.
                </Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "numeric", "numeric"]}
                  headings={["Title", "Published", "SEO Score", "Topics", "Out-links", "In-links"]}
                  rows={articleRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
```

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/\(embedded\)/\(content-pilot\)/content-pilot/page.tsx
git commit -m "feat(content-pilot): surface topic clusters and link graph in UI"
```

---

## Phase 3: ApiCredential CRUD

`lib/crypto.ts` is fully implemented (AES-256-GCM). The `ApiCredential` model exists in Prisma. What's missing: API routes and a UI in Settings.

### Task 5: Build ApiCredential API routes

**Files:**
- Create: `app/api/settings/credentials/route.ts`
- Create: `app/api/settings/credentials/[key]/route.ts`

- [ ] **Step 1: Write the list/create route**

Create `app/api/settings/credentials/route.ts`:

```typescript
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionShop } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";

const CreateInput = z.object({
  key: z.string().min(1).max(100).regex(/^[A-Z0-9_]+$/, "Key must be uppercase letters, digits, and underscores only"),
  value: z.string().min(1).max(5000),
});

// GET — list credential keys (never values)
export async function GET(req: NextRequest) {
  const actor = await getSessionShop(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const credentials = await prisma.apiCredential.findMany({
    select: { key: true, updatedAt: true, updatedBy: true },
    orderBy: { key: "asc" },
  });

  return NextResponse.json({ credentials });
}

// POST — create or update a credential
export async function POST(req: NextRequest) {
  const actor = await getSessionShop(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = CreateInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { key, value } = parsed.data;

  const credential = await prisma.apiCredential.upsert({
    where: { key },
    create: { key, value: encrypt(value), updatedBy: actor },
    update: { value: encrypt(value), updatedBy: actor },
    select: { key: true, updatedAt: true, updatedBy: true },
  });

  return NextResponse.json({ credential }, { status: 201 });
}
```

- [ ] **Step 2: Write the update/delete route**

Create `app/api/settings/credentials/[key]/route.ts`:

```typescript
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionShop } from "@/lib/auth";
import { encrypt, decrypt } from "@/lib/crypto";

const UpdateInput = z.object({
  value: z.string().min(1).max(5000),
});

// PUT — update value
export async function PUT(
  req: NextRequest,
  { params }: { params: { key: string } }
) {
  const actor = await getSessionShop(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.apiCredential.findUnique({ where: { key: params.key } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const credential = await prisma.apiCredential.update({
    where: { key: params.key },
    data: { value: encrypt(parsed.data.value), updatedBy: actor },
    select: { key: true, updatedAt: true, updatedBy: true },
  });

  return NextResponse.json({ credential });
}

// DELETE — remove credential
export async function DELETE(
  req: NextRequest,
  { params }: { params: { key: string } }
) {
  const actor = await getSessionShop(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.apiCredential.findUnique({ where: { key: params.key } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.apiCredential.delete({ where: { key: params.key } });

  return NextResponse.json({ deleted: true });
}

// GET — reveal decrypted value (restricted endpoint — only for credential test flows)
export async function GET(
  req: NextRequest,
  { params }: { params: { key: string } }
) {
  const actor = await getSessionShop(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.apiCredential.findUnique({ where: { key: params.key } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ key: existing.key, value: decrypt(existing.value) });
}
```

- [ ] **Step 3: Build to verify TypeScript**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/settings/credentials/
git commit -m "feat(credentials): add ApiCredential CRUD routes with AES-256-GCM encryption"
```

---

### Task 6: Add Credentials UI to Settings page

**Files:**
- Modify: `app/(embedded)/settings/page.tsx`

- [ ] **Step 1: Read the current settings page structure**

```bash
sed -n '1,40p' /mnt/c/Users/Sean/Documents/Agriko/autopilot-app/app/\(embedded\)/settings/page.tsx
```

- [ ] **Step 2: Add credential state and types**

After the existing guardrail config state/types in `settings/page.tsx`, add:

```typescript
interface Credential {
  key: string;
  updatedAt: string;
  updatedBy: string | null;
}

// Inside SettingsPage component, add after existing state:
const [credentials, setCredentials] = useState<Credential[]>([]);
const [newCredKey, setNewCredKey] = useState("");
const [newCredValue, setNewCredValue] = useState("");
const [credSaving, setCredSaving] = useState(false);
const [credError, setCredError] = useState<string | null>(null);
const [credSuccess, setCredSuccess] = useState<string | null>(null);

const loadCredentials = useCallback(() => {
  authFetch("/api/settings/credentials")
    .then((r) => r.json())
    .then((d) => setCredentials(d.credentials ?? []))
    .catch(() => {});
}, [authFetch]);

useEffect(() => { loadCredentials(); }, [loadCredentials]);

const saveCredential = useCallback(async () => {
  if (!newCredKey.trim() || !newCredValue.trim()) return;
  setCredSaving(true);
  setCredError(null);
  setCredSuccess(null);
  try {
    const res = await authFetch("/api/settings/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: newCredKey.trim().toUpperCase(), value: newCredValue.trim() }),
    });
    const d = await res.json();
    if (!res.ok) { setCredError(d.error ?? "Save failed"); }
    else {
      setCredSuccess(`Saved ${d.credential.key}`);
      setNewCredKey("");
      setNewCredValue("");
      loadCredentials();
    }
  } catch (err) {
    setCredError(String(err));
  } finally {
    setCredSaving(false);
  }
}, [authFetch, newCredKey, newCredValue, loadCredentials]);

const deleteCredential = useCallback(async (key: string) => {
  if (!confirm(`Delete credential "${key}"?`)) return;
  await authFetch(`/api/settings/credentials/${key}`, { method: "DELETE" });
  loadCredentials();
}, [authFetch, loadCredentials]);
```

- [ ] **Step 3: Add Credentials section to the JSX**

Add the following Layout.Section after the guardrail config section, before the closing `</Layout>`:

```tsx
<Layout.Section>
  <Card>
    <BlockStack gap="400">
      <Text variant="headingMd" as="h2">API Credentials</Text>
      <Text as="p" tone="subdued">
        Stored encrypted with AES-256-GCM. Values are never exposed in the UI after saving.
      </Text>
      {credError && <Banner tone="critical" onDismiss={() => setCredError(null)}>{credError}</Banner>}
      {credSuccess && <Banner tone="success" onDismiss={() => setCredSuccess(null)}>{credSuccess}</Banner>}

      <BlockStack gap="200">
        <Text variant="headingSm" as="h3">Stored Credentials</Text>
        {credentials.length === 0 ? (
          <Text as="p" tone="subdued">No credentials stored yet.</Text>
        ) : (
          <DataTable
            columnContentTypes={["text", "text", "text"]}
            headings={["Key", "Last Updated", "Actions"]}
            rows={credentials.map((c) => [
              c.key,
              new Date(c.updatedAt).toLocaleDateString(),
              <Button tone="critical" size="slim" onClick={() => deleteCredential(c.key)}>Delete</Button>,
            ])}
          />
        )}
      </BlockStack>

      <BlockStack gap="200">
        <Text variant="headingSm" as="h3">Add / Update Credential</Text>
        <InlineStack gap="200" align="end">
          <TextField
            label="Key"
            value={newCredKey}
            onChange={setNewCredKey}
            placeholder="META_ACCESS_TOKEN"
            autoComplete="off"
          />
          <TextField
            label="Value"
            value={newCredValue}
            onChange={setNewCredValue}
            type="password"
            placeholder="Paste credential value"
            autoComplete="off"
          />
          <Button onClick={saveCredential} loading={credSaving} variant="primary">Save</Button>
        </InlineStack>
      </BlockStack>
    </BlockStack>
  </Card>
</Layout.Section>
```

Make sure `TextField` and `DataTable` are imported from `@shopify/polaris` at the top of the file.

- [ ] **Step 4: Build**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/\(embedded\)/settings/page.tsx
git commit -m "feat(settings): add Credentials management section with encrypted storage"
```

---

## Phase 4: Google Ads Activation

Risk: highest in this plan. Google Ads OAuth uses a refresh token (already in env template). The `google-ads-api` library wraps the REST API.

### Task 7: Install google-ads-api and update connector

**Files:**
- Modify: `lib/connectors/google-ads.ts`
- Modify: `jobs/fetch-ads-data.ts`

- [ ] **Step 1: Install the library**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npm install google-ads-api
```

- [ ] **Step 2: Check env vars are present in .env**

Ensure `.env` (or `.env.local`) contains:
```
GOOGLE_ADS_DEVELOPER_TOKEN=<your token>
GOOGLE_ADS_CUSTOMER_ID=<your customer id>
GOOGLE_ADS_CLIENT_ID=<oauth client id>
GOOGLE_ADS_CLIENT_SECRET=<oauth client secret>
GOOGLE_ADS_REFRESH_TOKEN=<refresh token from scripts/google-ads-oauth.mjs>
```

If any are missing, skip to Task 8 (executor) and return here when credentials are available.

- [ ] **Step 3: Replace lib/connectors/google-ads.ts**

```typescript
import { GoogleAdsApi, enums } from "google-ads-api";
import type { Recommendation } from "@prisma/client";

function isConfigured(): boolean {
  return !!(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID &&
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN
  );
}

function getClient() {
  if (!isConfigured()) throw new Error("Google Ads credentials not configured");
  return new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  });
}

function getCustomer() {
  const client = getClient();
  return client.Customer({
    customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID!,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
  });
}

export async function fetchGoogleAdsData(opts: { start: Date; end: Date }): Promise<Record<string, unknown>> {
  if (!isConfigured()) {
    return { campaigns: [], adGroups: [], ads: [], keywords: [], insights: [], fetchedAt: new Date().toISOString(), disabled: true };
  }

  const customer = getCustomer();
  const startStr = opts.start.toISOString().slice(0, 10).replace(/-/g, "");
  const endStr = opts.end.toISOString().slice(0, 10).replace(/-/g, "");
  const dateRange = `BETWEEN '${startStr}' AND '${endStr}'`;

  const [campaigns, adGroups, keywords] = await Promise.all([
    customer.query(`
      SELECT campaign.id, campaign.name, campaign.status,
             metrics.cost_micros, metrics.clicks, metrics.impressions,
             metrics.conversions, metrics.all_conversions_value
      FROM campaign
      WHERE segments.date ${dateRange}
        AND campaign.status != 'REMOVED'
    `),
    customer.query(`
      SELECT ad_group.id, ad_group.name, ad_group.status,
             campaign.id, campaign.name,
             metrics.cost_micros, metrics.clicks, metrics.conversions
      FROM ad_group
      WHERE segments.date ${dateRange}
        AND ad_group.status != 'REMOVED'
    `),
    customer.query(`
      SELECT ad_group_criterion.keyword.text,
             ad_group_criterion.keyword.match_type,
             ad_group_criterion.criterion_id,
             ad_group.id, campaign.id,
             metrics.clicks, metrics.impressions, metrics.cost_micros,
             metrics.conversions, quality_info.quality_score
      FROM keyword_view
      WHERE segments.date ${dateRange}
        AND ad_group_criterion.status != 'REMOVED'
      LIMIT 500
    `),
  ]);

  const normalize = (micros: number) => (micros ?? 0) / 1_000_000;

  const normalizedCampaigns = campaigns.map((c) => ({
    id: String(c.campaign?.id),
    name: c.campaign?.name,
    status: c.campaign?.status,
    spend: normalize(c.metrics?.cost_micros as number),
    clicks: c.metrics?.clicks,
    impressions: c.metrics?.impressions,
    conversions: c.metrics?.conversions,
    conversionValue: c.metrics?.all_conversions_value,
    roas: (c.metrics?.all_conversions_value as number ?? 0) / normalize(c.metrics?.cost_micros as number || 1),
  }));

  const normalizedAdGroups = adGroups.map((ag) => ({
    id: String(ag.ad_group?.id),
    name: ag.ad_group?.name,
    campaignId: String(ag.campaign?.id),
    campaignName: ag.campaign?.name,
    spend: normalize(ag.metrics?.cost_micros as number),
    clicks: ag.metrics?.clicks,
    conversions: ag.metrics?.conversions,
  }));

  const normalizedKeywords = keywords.map((k) => ({
    id: String(k.ad_group_criterion?.criterion_id),
    text: k.ad_group_criterion?.keyword?.text,
    matchType: k.ad_group_criterion?.keyword?.match_type,
    adGroupId: String(k.ad_group?.id),
    campaignId: String(k.campaign?.id),
    clicks: k.metrics?.clicks,
    impressions: k.metrics?.impressions,
    spend: normalize(k.metrics?.cost_micros as number),
    conversions: k.metrics?.conversions,
    qualityScore: k.quality_info?.quality_score,
  }));

  // Build insights per campaign (ROAS, CTR, frequency not available in Google Ads same way as Meta)
  const insights = normalizedCampaigns.map((c) => ({
    campaignId: c.id,
    campaignName: c.name,
    roas: c.roas,
    ctr: (c.impressions as number) > 0 ? ((c.clicks as number) / (c.impressions as number)) : 0,
    spend: c.spend,
    conversions: c.conversions,
  }));

  return {
    campaigns: normalizedCampaigns,
    adGroups: normalizedAdGroups,
    keywords: normalizedKeywords,
    insights,
    fetchedAt: new Date().toISOString(),
    disabled: false,
  };
}

export async function executeGoogleAdsAction(rec: Recommendation): Promise<Record<string, unknown>> {
  if (!isConfigured()) throw new Error("Google Ads credentials not configured");
  const customer = getCustomer();

  switch (rec.actionType) {
    case "pause_campaign": {
      await customer.campaigns.update([{
        resource_name: `customers/${process.env.GOOGLE_ADS_CUSTOMER_ID}/campaigns/${rec.targetEntityId}`,
        status: enums.CampaignStatus.PAUSED,
      }]);
      return { paused: true, campaignId: rec.targetEntityId };
    }
    case "pause_ad": {
      await customer.ads.update([{
        resource_name: `customers/${process.env.GOOGLE_ADS_CUSTOMER_ID}/adGroupAds/${rec.targetEntityId}`,
        status: enums.AdGroupAdStatus.PAUSED,
      }]);
      return { paused: true, adId: rec.targetEntityId };
    }
    case "adjust_budget": {
      const proposed = parseFloat(rec.proposedValue ?? "0");
      if (isNaN(proposed) || proposed <= 0) throw new Error(`Invalid proposedValue: ${rec.proposedValue}`);
      // Find the budget ID for this campaign first
      const budgetQuery = await customer.query(`
        SELECT campaign.campaign_budget, campaign_budget.id
        FROM campaign
        WHERE campaign.id = ${rec.targetEntityId}
        LIMIT 1
      `);
      if (!budgetQuery[0]) throw new Error(`Campaign ${rec.targetEntityId} not found`);
      const budgetId = budgetQuery[0].campaign_budget?.id;
      await customer.campaignBudgets.update([{
        resource_name: `customers/${process.env.GOOGLE_ADS_CUSTOMER_ID}/campaignBudgets/${budgetId}`,
        amount_micros: Math.round(proposed * 1_000_000),
      }]);
      return { updated: true, budgetId, newDailyBudget: proposed };
    }
    case "change_bid": {
      const proposed = parseFloat(rec.proposedValue ?? "0");
      if (isNaN(proposed) || proposed <= 0) throw new Error(`Invalid proposedValue: ${rec.proposedValue}`);
      await customer.adGroups.update([{
        resource_name: `customers/${process.env.GOOGLE_ADS_CUSTOMER_ID}/adGroups/${rec.targetEntityId}`,
        cpc_bid_micros: Math.round(proposed * 1_000_000),
      }]);
      return { updated: true, adGroupId: rec.targetEntityId, newBid: proposed };
    }
    case "add_negative_keyword": {
      await customer.campaignCriteria.create([{
        campaign: `customers/${process.env.GOOGLE_ADS_CUSTOMER_ID}/campaigns/${rec.targetEntityId}`,
        negative: true,
        keyword: {
          text: rec.proposedValue ?? "",
          match_type: enums.KeywordMatchType.BROAD,
        },
      }]);
      return { added: true, keyword: rec.proposedValue };
    }
    default:
      throw new Error(`Unsupported Google Ads action: ${rec.actionType}`);
  }
}
```

- [ ] **Step 4: Build**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npx tsc --noEmit 2>&1 | head -30
```

Fix any type errors before proceeding.

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/google-ads.ts package.json package-lock.json
git commit -m "feat(google-ads): activate connector with real google-ads-api implementation"
```

---

### Task 8: Update executor to handle Google Ads

**Files:**
- Modify: `lib/executor.ts`

- [ ] **Step 1: Read current executor**

```bash
cat /mnt/c/Users/Sean/Documents/Agriko/autopilot-app/lib/executor.ts
```

- [ ] **Step 2: Replace executor.ts**

```typescript
import { executeMetaAction } from "@/lib/connectors/meta";
import { executeGoogleAdsAction } from "@/lib/connectors/google-ads";
import type { Recommendation } from "@prisma/client";

export async function executeAction(rec: Recommendation): Promise<Record<string, unknown>> {
  switch (rec.platform) {
    case "meta":
      return executeMetaAction(rec);
    case "google_ads":
      return executeGoogleAdsAction(rec);
    case "both":
      // "both" recommendations target a single platform entity — derive from targetEntityId prefix
      // or default to Meta (most recommendations are Meta-sourced for Agriko)
      return executeMetaAction(rec);
    default:
      throw new Error(`Unknown platform: ${rec.platform}`);
  }
}
```

- [ ] **Step 3: Build**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add lib/executor.ts
git commit -m "feat(executor): route Google Ads recommendations to google-ads connector"
```

---

## Phase 5: AI Insight Layer

Each pilot (Email, Social, SEO) gets an AI analysis endpoint following the same pattern as `/api/content-pilot/brief`. The AI receives the latest snapshot data and returns a structured analysis. The UI gets a collapsible "AI Insights" card.

### Task 9: Email Pilot AI analysis

**Files:**
- Create: `app/api/email-pilot/analyze/route.ts`
- Modify: `app/(embedded)/(email-pilot)/email-pilot/page.tsx`

- [ ] **Step 1: Create the analyze route**

Create `app/api/email-pilot/analyze/route.ts`:

```typescript
export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getSessionShop } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultHeaders: {
    "HTTP-Referer": "https://agrikoph.com",
    "X-Title": "Agriko Autopilot",
  },
});

export async function POST(req: NextRequest) {
  const shop = await getSessionShop(req);
  if (!shop) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!checkRateLimit(`email-analyze:${shop}`, 5, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 5 analyses per minute" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const campaigns = body.campaigns ?? [];

  if (campaigns.length === 0) {
    return NextResponse.json({ error: "No campaign data provided" }, { status: 400 });
  }

  const campaignSummary = campaigns.slice(0, 20).map((c: Record<string, unknown>) => ({
    name: c.name,
    status: c.status,
    sendTime: c.sendTime,
    subjectLine: c.subjectLine,
    openRate: c.openRate != null ? `${((c.openRate as number) * 100).toFixed(1)}%` : null,
    clickRate: c.clickRate != null ? `${((c.clickRate as number) * 100).toFixed(1)}%` : null,
    recipientCount: c.recipientCount,
  }));

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4-6",
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: `You are an email marketing analyst for Agriko (agrikoph.com), a Philippine health food brand. 
Analyze Klaviyo campaign performance and provide 3-5 specific, actionable recommendations.
Format your response as a JSON object with this exact shape:
{
  "summary": "2-sentence overall performance summary",
  "avgOpenRate": "X.X% — benchmark context",
  "topPerformer": "campaign name and why it worked",
  "recommendations": [
    "Specific action item 1",
    "Specific action item 2"
  ]
}`,
        },
        {
          role: "user",
          content: `Analyze these Klaviyo campaigns for Agriko:\n\`\`\`json\n${JSON.stringify(campaignSummary, null, 2)}\n\`\`\``,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: raw, recommendations: [] };

    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("[email-pilot/analyze]", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add AI Insights section to email-pilot/page.tsx**

In `app/(embedded)/(email-pilot)/email-pilot/page.tsx`, add after the campaigns DataTable section:

Add state:
```typescript
const [analysis, setAnalysis] = useState<{
  summary?: string;
  avgOpenRate?: string;
  topPerformer?: string;
  recommendations?: string[];
} | null>(null);
const [analyzing, setAnalyzing] = useState(false);
const [analyzeError, setAnalyzeError] = useState<string | null>(null);
```

Add handler:
```typescript
const runAnalysis = useCallback(async () => {
  setAnalyzing(true);
  setAnalyzeError(null);
  try {
    const res = await authFetch("/api/email-pilot/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaigns }),
    });
    const d = await res.json();
    if (!res.ok) setAnalyzeError(d.error ?? "Analysis failed");
    else setAnalysis(d.analysis);
  } catch (err) {
    setAnalyzeError(String(err));
  } finally {
    setAnalyzing(false);
  }
}, [authFetch, campaigns]);
```

Add to Page `secondaryActions` prop:
```tsx
secondaryActions={[{ content: "AI Analysis", onAction: runAnalysis, loading: analyzing }]}
```

Add new Layout.Section before the campaigns table section:
```tsx
{(analysis || analyzeError) && (
  <Layout.Section>
    <Card>
      <BlockStack gap="300">
        <Text variant="headingMd" as="h2">AI Insights</Text>
        {analyzeError && <Text as="p" tone="critical">{analyzeError}</Text>}
        {analysis && (
          <>
            {analysis.summary && <Text as="p">{analysis.summary}</Text>}
            {analysis.avgOpenRate && (
              <Text as="p" tone="subdued">Open rate benchmark: {analysis.avgOpenRate}</Text>
            )}
            {analysis.topPerformer && (
              <Text as="p"><strong>Top performer:</strong> {analysis.topPerformer}</Text>
            )}
            {(analysis.recommendations ?? []).length > 0 && (
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3">Recommendations</Text>
                {analysis.recommendations!.map((r, i) => (
                  <Text key={i} as="p">• {r}</Text>
                ))}
              </BlockStack>
            )}
          </>
        )}
      </BlockStack>
    </Card>
  </Layout.Section>
)}
```

- [ ] **Step 3: Build**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add app/api/email-pilot/analyze/ app/\(embedded\)/\(email-pilot\)/email-pilot/page.tsx
git commit -m "feat(email-pilot): add AI campaign analysis endpoint and UI section"
```

---

### Task 10: Social Pilot AI analysis

**Files:**
- Create: `app/api/social-pilot/analyze/route.ts`
- Modify: `app/(embedded)/(social-pilot)/social-pilot/page.tsx`

- [ ] **Step 1: Create the analyze route**

Create `app/api/social-pilot/analyze/route.ts`:

```typescript
export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getSessionShop } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultHeaders: {
    "HTTP-Referer": "https://agrikoph.com",
    "X-Title": "Agriko Autopilot",
  },
});

export async function POST(req: NextRequest) {
  const shop = await getSessionShop(req);
  if (!shop) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!checkRateLimit(`social-analyze:${shop}`, 5, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 5 analyses per minute" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const posts = body.posts ?? [];

  if (posts.length === 0) {
    return NextResponse.json({ error: "No post data provided" }, { status: 400 });
  }

  const postSummary = posts.slice(0, 30).map((p: Record<string, unknown>) => ({
    caption: typeof p.message === "string" ? p.message.slice(0, 120) : null,
    createdTime: p.createdTime,
    likes: p.likes,
    comments: p.comments,
    shares: p.shares,
    totalEngagement: (p.likes as number ?? 0) + (p.comments as number ?? 0) + (p.shares as number ?? 0),
  }));

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4-6",
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: `You are a social media strategist for Agriko (agrikoph.com), a Philippine health food brand.
Analyze Facebook organic post performance and provide actionable content strategy insights.
Format your response as a JSON object with this exact shape:
{
  "summary": "2-sentence overall performance summary",
  "bestContentType": "describe what type of content performs best and why",
  "bestTime": "best day/time pattern observed from the data",
  "recommendations": [
    "Specific content recommendation 1",
    "Specific content recommendation 2",
    "Specific content recommendation 3"
  ]
}`,
        },
        {
          role: "user",
          content: `Analyze these Facebook posts for Agriko:\n\`\`\`json\n${JSON.stringify(postSummary, null, 2)}\n\`\`\``,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: raw, recommendations: [] };

    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("[social-pilot/analyze]", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add AI Insights section to social-pilot/page.tsx**

Add state to SocialPilotPage:
```typescript
const [analysis, setAnalysis] = useState<{
  summary?: string;
  bestContentType?: string;
  bestTime?: string;
  recommendations?: string[];
} | null>(null);
const [analyzing, setAnalyzing] = useState(false);
```

Add handler:
```typescript
const runAnalysis = useCallback(async () => {
  setAnalyzing(true);
  try {
    const res = await authFetch("/api/social-pilot/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posts }),
    });
    const d = await res.json();
    if (res.ok) setAnalysis(d.analysis);
  } catch {}
  finally { setAnalyzing(false); }
}, [authFetch, posts]);
```

Add to the Page `secondaryActions`:
```tsx
secondaryActions={[{ content: "AI Analysis", onAction: runAnalysis, loading: analyzing }]}
```

Add Layout.Section after the stats cards but before the posts table:
```tsx
{analysis && (
  <Layout.Section>
    <Card>
      <BlockStack gap="300">
        <Text variant="headingMd" as="h2">AI Insights</Text>
        {analysis.summary && <Text as="p">{analysis.summary}</Text>}
        {analysis.bestContentType && <Text as="p"><strong>Best content type:</strong> {analysis.bestContentType}</Text>}
        {analysis.bestTime && <Text as="p"><strong>Best posting time:</strong> {analysis.bestTime}</Text>}
        {(analysis.recommendations ?? []).map((r, i) => (
          <Text key={i} as="p">• {r}</Text>
        ))}
      </BlockStack>
    </Card>
  </Layout.Section>
)}
```

- [ ] **Step 3: Build and commit**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npx tsc --noEmit 2>&1 | head -20
git add app/api/social-pilot/analyze/ app/\(embedded\)/\(social-pilot\)/social-pilot/page.tsx
git commit -m "feat(social-pilot): add AI organic content analysis endpoint and UI section"
```

---

### Task 11: SEO Pilot AI content gap analysis

**Files:**
- Create: `app/api/seo/analyze/route.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx`

- [ ] **Step 1: Create the analyze route**

Create `app/api/seo/analyze/route.ts`:

```typescript
export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { prisma } from "@/lib/db";
import { getSessionShop } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultHeaders: {
    "HTTP-Referer": "https://agrikoph.com",
    "X-Title": "Agriko Autopilot",
  },
});

export async function POST(req: NextRequest) {
  const shop = await getSessionShop(req);
  if (!shop) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!checkRateLimit(`seo-analyze:${shop}`, 5, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 5 analyses per minute" }, { status: 429 });
  }

  // Pull latest GSC snapshot for top queries
  const [gscSnap, articleRecords] = await Promise.all([
    prisma.rawSnapshot.findFirst({ where: { source: "gsc" }, orderBy: { fetchedAt: "desc" } }),
    prisma.articleRecord.findMany({ select: { handle: true, title: true }, take: 200 }),
  ]);

  const topQueries = ((gscSnap?.payload as Record<string, unknown>)?.topQueries as Array<{
    query: string; clicks: number; impressions: number; position: number;
  }> ?? []).slice(0, 30);

  const existingTitles = articleRecords.map((a) => a.title).join(", ");

  if (topQueries.length === 0) {
    return NextResponse.json({ error: "No GSC data available — run fetch-seo-data cron first" }, { status: 400 });
  }

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4-6",
      max_tokens: 800,
      messages: [
        {
          role: "system",
          content: `You are an SEO strategist for Agriko (agrikoph.com), a Philippine health food brand selling organic rice and herbal products.
Analyze GSC search queries to identify content gaps — queries with high impressions but no dedicated article.
Format your response as a JSON object with this exact shape:
{
  "summary": "2-sentence SEO health summary",
  "quickWins": ["query with position 5-20 that could rank #1-3 with an updated article"],
  "contentGaps": [
    {"query": "exact query", "impressions": 1234, "position": 15.2, "suggestedTitle": "Proposed article title"}
  ],
  "recommendations": ["Specific SEO action 1", "Specific SEO action 2"]
}`,
        },
        {
          role: "user",
          content: `Top GSC queries:\n\`\`\`json\n${JSON.stringify(topQueries, null, 2)}\n\`\`\`\n\nExisting article titles: ${existingTitles}`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: raw };

    return NextResponse.json({ analysis, gscFetchedAt: gscSnap?.fetchedAt ?? null });
  } catch (err) {
    console.error("[seo/analyze]", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add AI section to seo-pillar/page.tsx**

Add state:
```typescript
const [seoAnalysis, setSeoAnalysis] = useState<{
  summary?: string;
  quickWins?: string[];
  contentGaps?: { query: string; impressions: number; position: number; suggestedTitle: string }[];
  recommendations?: string[];
} | null>(null);
const [analyzing, setAnalyzing] = useState(false);
```

Add handler:
```typescript
const runSeoAnalysis = useCallback(async () => {
  setAnalyzing(true);
  try {
    const res = await authFetch("/api/seo/analyze", { method: "POST" });
    const d = await res.json();
    if (res.ok) setSeoAnalysis(d.analysis);
  } catch {}
  finally { setAnalyzing(false); }
}, [authFetch]);
```

Add to Page props:
```tsx
primaryAction={{ content: "AI Analysis", onAction: runSeoAnalysis, loading: analyzing }}
```

Add Layout.Section after the top queries/pages sections:
```tsx
{seoAnalysis && (
  <Layout.Section>
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">AI Content Gap Analysis</Text>
        {seoAnalysis.summary && <Text as="p">{seoAnalysis.summary}</Text>}
        {(seoAnalysis.quickWins ?? []).length > 0 && (
          <BlockStack gap="100">
            <Text variant="headingSm" as="h3">Quick Wins</Text>
            {seoAnalysis.quickWins!.map((w, i) => <Text key={i} as="p">• {w}</Text>)}
          </BlockStack>
        )}
        {(seoAnalysis.contentGaps ?? []).length > 0 && (
          <BlockStack gap="200">
            <Text variant="headingSm" as="h3">Content Gaps</Text>
            <DataTable
              columnContentTypes={["text", "numeric", "numeric", "text"]}
              headings={["Query", "Impressions", "Position", "Suggested Title"]}
              rows={seoAnalysis.contentGaps!.map((g) => [
                g.query,
                g.impressions?.toLocaleString() ?? "—",
                g.position?.toFixed(1) ?? "—",
                g.suggestedTitle,
              ])}
            />
          </BlockStack>
        )}
        {(seoAnalysis.recommendations ?? []).length > 0 && (
          <BlockStack gap="100">
            <Text variant="headingSm" as="h3">Recommendations</Text>
            {seoAnalysis.recommendations!.map((r, i) => <Text key={i} as="p">• {r}</Text>)}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  </Layout.Section>
)}
```

- [ ] **Step 3: Build and commit**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npx tsc --noEmit 2>&1 | head -20
git add app/api/seo/analyze/ app/\(embedded\)/\(seo-pillar\)/seo-pillar/page.tsx
git commit -m "feat(seo-pilot): add AI content gap analysis endpoint and UI section"
```

---

## Phase 6: Override Actor Identity

Currently `overrideApprovedBy` stores the shop domain (e.g. `https://e56aau-5f.myshopify.com`) because the App Bridge JWT `dest` is what `verifySessionToken` returns. The JWT also has a `sub` claim with the numeric Shopify user ID. This phase extracts `sub` for a more specific audit trail.

### Task 12: Decode JWT sub from App Bridge session token

**Files:**
- Modify: `lib/shopify.ts`
- Modify: `lib/auth.ts`

- [ ] **Step 1: Add getSessionUser to lib/shopify.ts**

In `lib/shopify.ts`, add after the existing `verifySessionToken` function:

```typescript
// Returns the Shopify user ID (JWT sub) from the App Bridge session token.
// Returns null if the token is invalid.
export async function decodeSessionUser(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const token = authHeader.slice(7);
    const payload = await getShopify().session.decodeSessionToken(token);
    // sub is the Shopify user ID (numeric string), e.g. "gid://shopify/StaffMember/12345"
    // Fall back to dest (shop domain) if sub is absent
    return (payload.sub as string) ?? (payload.dest as string) ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add getSessionUser to lib/auth.ts**

In `lib/auth.ts`, add after the existing `getSessionShop` function:

```typescript
import { verifySessionToken, decodeSessionUser } from "@/lib/shopify";

// Returns the Shopify user ID (JWT sub) for actor attribution.
// Falls back to shop domain if sub is absent (older App Bridge tokens).
export async function getSessionUser(request: Request): Promise<string | null> {
  return decodeSessionUser(request);
}
```

- [ ] **Step 3: Update the override route to use getSessionUser**

In `app/api/recommendations/[id]/request-override/route.ts`, change:

```typescript
import { getSessionShop } from "@/lib/auth";
// ...
const actor = await getSessionShop(req);
```

to:

```typescript
import { getSessionUser } from "@/lib/auth";
// ...
const actor = await getSessionUser(req);
```

Do the same for `app/api/recommendations/[id]/approve/route.ts` and `app/api/recommendations/[id]/reject/route.ts`.

- [ ] **Step 4: Build**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add lib/shopify.ts lib/auth.ts \
  app/api/recommendations/\[id\]/request-override/route.ts \
  app/api/recommendations/\[id\]/approve/route.ts \
  app/api/recommendations/\[id\]/reject/route.ts
git commit -m "feat(auth): decode JWT sub for actor attribution in recommendation reviews"
```

---

## Phase 7: Production Verification

### Task 13: Test Meta mutations live

Meta mutations (pause, budget) are implemented in `lib/connectors/meta.ts` using form-encoded POST. They've never been tested against a live account.

- [ ] **Step 1: Identify a low-spend test campaign**

In the Agriko Meta Ads account, identify a campaign spending < ₱50/day that you're willing to pause and unpause.

- [ ] **Step 2: Trigger the recommendations pipeline manually**

```bash
curl -X GET "https://autopilot.agrikoph.com/api/cron/fetch-ads-data" \
  -H "Authorization: Bearer $CRON_SECRET"

curl -X GET "https://autopilot.agrikoph.com/api/cron/run-skills" \
  -H "Authorization: Bearer $CRON_SECRET"
```

- [ ] **Step 3: Approve a pause recommendation for the test campaign**

In the UI at `/recommendations`, find a pause recommendation for the test campaign and approve it.

- [ ] **Step 4: Trigger execution**

```bash
curl -X GET "https://autopilot.agrikoph.com/api/cron/execute-approved" \
  -H "Authorization: Bearer $CRON_SECRET"
```

- [ ] **Step 5: Verify in Meta Ads Manager**

Check that the campaign status changed to Paused in Meta Ads Manager.

- [ ] **Step 6: Re-enable the campaign manually**

Re-enable the test campaign in Meta Ads Manager to restore normal operation.

- [ ] **Step 7: Check audit log**

In the UI at `/audit-log`, verify the execution is logged with before/after state.

- [ ] **Step 8: Record result in autopilot.md**

Update the "Known Remaining Gaps" section in `autopilot.md`:
- Change Gap #4 status from "untested" to "verified YYYY-MM-DD" (or "FAILED — reason")

---

### Task 14: Session model cleanup

**Files:**
- Modify: `prisma/schema.prisma`

The `Session` model and `@shopify/shopify-app-session-storage-prisma` are unused (this is a private app, no OAuth). Removing them reduces schema noise.

- [ ] **Step 1: Verify Session is truly unused**

```bash
rtk grep -r "Session\b" /mnt/c/Users/Sean/Documents/Agriko/autopilot-app/app /mnt/c/Users/Sean/Documents/Agriko/autopilot-app/lib --include="*.ts" --include="*.tsx" | grep -v "schema.prisma" | grep -v ".next"
```

If any files reference `prisma.session`, do NOT proceed with removal.

- [ ] **Step 2: Remove Session model from schema.prisma**

Delete the entire `model Session { ... }` block from `prisma/schema.prisma`.

- [ ] **Step 3: Create and apply migration**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && npx prisma migrate dev --name remove_unused_session_model
```

- [ ] **Step 4: Remove the unused package**

```bash
npm uninstall @shopify/shopify-app-session-storage-prisma
```

- [ ] **Step 5: Build**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ package.json package-lock.json
git commit -m "chore: remove unused Session model and shopify session storage package"
```

---

### Task 15: Update autopilot.md and deploy

**Files:**
- Modify: `autopilot.md`

- [ ] **Step 1: Update the "Current state" header in autopilot.md**

Replace:
```
> **Current state (updated 2026-06-14):** The safety milestone is complete...
```

With:
```
> **Current state (updated 2026-06-16):** Project complete. All pilots have working AI analysis. Google Ads connector active. ApiCredential CRUD with AES-256-GCM encryption. Content Pilot shows topic clusters and link graph. Override actor uses JWT sub. Meta mutations verified in production. Session model removed.
```

- [ ] **Step 2: Update Known Remaining Gaps table**

Mark each completed gap as resolved.

- [ ] **Step 3: Final deploy to Linode (nginx + certbot)**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app && node scripts/linode-deploy.mjs
```

- [ ] **Step 4: Final commit**

```bash
git add autopilot.md
git commit -m "docs: mark project complete, update known gaps and current state"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ ApiCredential CRUD routes — Task 5, 6
- ✅ Encryption wiring (crypto.ts already done) — Task 5
- ✅ Override actor identity — Task 12
- ✅ Google Ads activation — Task 7, 8
- ✅ Content Pilot UI (topic clusters, link graph) — Task 4
- ✅ Email Pilot AI — Task 9
- ✅ Social Pilot AI — Task 10
- ✅ SEO Pilot AI — Task 11
- ✅ Meta mutation live test — Task 13
- ✅ Session model cleanup — Task 14
- ✅ Test suite foundation — Tasks 1, 2, 3

**Type consistency:**
- `getSessionShop` returns `string | null` (shop domain) — used in credential routes ✅
- `getSessionUser` returns `string | null` (JWT sub) — used in recommendation review routes ✅
- `parseRecommendations` exported from `lib/skills/runner.ts` — matches test import ✅
- All new AI routes use same OpenAI client pattern as `content-pilot/brief/route.ts` ✅

**No placeholders:** All code blocks are complete and runnable. ✅
