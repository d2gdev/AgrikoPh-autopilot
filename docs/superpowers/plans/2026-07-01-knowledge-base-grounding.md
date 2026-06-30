# Knowledge Base Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared semantic-retrieval layer so every AI skill can ground its output in the app's own corpus (articles, reviews, briefs, recommendations, competitor ads), with citations surfaced to the operator.

**Architecture:** A daily `index-knowledge` job chunks + embeds source-table text (via the self-hosted Odysseus Ollama `/v1/embeddings`, model `bge-m3`) into a pgvector `KnowledgeChunk` table in the existing Postgres. A single `retrieveContext()` helper runs cosine similarity and returns cited chunks; each skill injects them into its prompt before the DeepSeek call. Retrieval is strictly additive — if it returns nothing, skills behave exactly as today.

**Tech Stack:** Next.js (App Router), TypeScript, Prisma + PostgreSQL + pgvector, OpenAI SDK (pointed at Odysseus Ollama for embeddings, DeepSeek for generation), Jest.

## Global Constraints

- All DB access via `import { prisma } from "@/lib/db"` — never instantiate `PrismaClient`.
- Secrets resolved via `getOptionalSecret(key)` from `@/lib/config/resolver` — never read `process.env` directly in app code for these. New secrets: `EMBEDDINGS_BASE_URL`, `EMBEDDINGS_MODEL` (default `bge-m3`).
- Embedding dimension is **1024** (bge-m3 native) everywhere — column, query cast, tests.
- Retrieval must **never throw to a skill caller**; on any embeddings/DB failure it returns `[]` and the skill runs unchanged. No new hard dependency in the recommendation path.
- Cron routes call `requireCronAuth(req)` first, then `acquireJobLock` / `releaseJobLock` (follow `app/api/cron/fetch-seo-data/route.ts`).
- Jobs return `JobResult<TSummary>` from `@/lib/jobs/types` and log a `JobRun` row (follow `jobs/fetch-seo-data.ts`).
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.

---

### Task 1: pgvector extension + `KnowledgeChunk` model

**Files:**
- Modify: `prisma/schema.prisma` (add model)
- Create: `prisma/migrations/<timestamp>_add_knowledge_chunk/migration.sql`
- Create: `scripts/verify-knowledge-schema.ts` (one-off verification)

**Interfaces:**
- Produces: Prisma model `KnowledgeChunk` and a `knowledge_chunk_embedding_hnsw` index. The `embedding` column is `vector(1024)` (Prisma `Unsupported`), so all embedding reads/writes use raw SQL.

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

```prisma
model KnowledgeChunk {
  id          String   @id @default(cuid())
  sourceType  String
  sourceId    String
  chunkIndex  Int
  content     String   @db.Text
  contentHash String
  embedding   Unsupported("vector(1024)")
  metadata    Json
  tokens      Int
  createdAt   DateTime @default(now())

  @@unique([sourceType, sourceId, chunkIndex])
  @@index([sourceType])
}
```

- [ ] **Step 2: Create the migration manually (Prisma can't diff `Unsupported` + extension cleanly)**

Create `prisma/migrations/<timestamp>_add_knowledge_chunk/migration.sql` (use a timestamp later than the newest existing migration):

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "metadata" JSONB NOT NULL,
    "tokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeChunk_sourceType_sourceId_chunkIndex_key"
    ON "KnowledgeChunk" ("sourceType", "sourceId", "chunkIndex");
CREATE INDEX "KnowledgeChunk_sourceType_idx" ON "KnowledgeChunk" ("sourceType");
CREATE INDEX "knowledge_chunk_embedding_hnsw"
    ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops);
```

- [ ] **Step 3: Apply migration and regenerate the client**

Run: `npm run db:migrate && npm run db:generate`
Expected: migration applies cleanly; `KnowledgeChunk` appears in the generated Prisma client.

- [ ] **Step 4: Write the verification script**

Create `scripts/verify-knowledge-schema.ts`:

```ts
import { prisma } from "@/lib/db";

async function main() {
  const [{ exists }] = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS exists;`;
  if (!exists) throw new Error("pgvector extension missing");

  const vec = "[" + Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0)).join(",") + "]";
  await prisma.$executeRawUnsafe(
    `INSERT INTO "KnowledgeChunk" (id, "sourceType", "sourceId", "chunkIndex", content, "contentHash", embedding, metadata, tokens)
     VALUES ('verify-1', 'article', 'verify', 0, 'hello', 'h', $1::vector, '{}'::jsonb, 1)`,
    vec,
  );
  const rows = await prisma.$queryRawUnsafe<{ id: string; score: number }[]>(
    `SELECT id, 1 - (embedding <=> $1::vector) AS score FROM "KnowledgeChunk" ORDER BY embedding <=> $1::vector LIMIT 1`,
    vec,
  );
  if (rows[0]?.id !== "verify-1") throw new Error("cosine query failed");
  await prisma.$executeRawUnsafe(`DELETE FROM "KnowledgeChunk" WHERE id = 'verify-1'`);
  console.log("knowledge schema OK, cosine score:", rows[0].score);
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 5: Run the verification script**

Run: `npx tsx scripts/verify-knowledge-schema.ts`
Expected: prints `knowledge schema OK, cosine score: 1` (cosine similarity of a vector with itself is 1).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations scripts/verify-knowledge-schema.ts
git commit -m "feat: add KnowledgeChunk pgvector table for KB grounding"
```

---

### Task 2: Embeddings client

**Files:**
- Create: `lib/ai/embeddings.ts`
- Test: `__tests__/lib/ai/embeddings.test.ts`

**Interfaces:**
- Consumes: `getOptionalSecret` from `@/lib/config/resolver`.
- Produces:
  - `EMBEDDING_DIM = 1024` (exported const)
  - `class EmbeddingsUnavailableError extends Error`
  - `async function embedTexts(texts: string[]): Promise<number[][]>` — one vector per input, in order; throws `EmbeddingsUnavailableError` if `EMBEDDINGS_BASE_URL` is unset.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/ai/embeddings.test.ts`:

```ts
import { embedTexts, EmbeddingsUnavailableError, EMBEDDING_DIM } from "@/lib/ai/embeddings";

const createMock = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: class { embeddings = { create: (...a: unknown[]) => createMock(...a) }; },
}));

const secrets: Record<string, string | null> = {};
jest.mock("@/lib/config/resolver", () => ({
  getOptionalSecret: (k: string) => Promise.resolve(secrets[k] ?? null),
}));

beforeEach(() => {
  createMock.mockReset();
  secrets.EMBEDDINGS_BASE_URL = "http://odysseus:11434/v1";
  secrets.EMBEDDINGS_MODEL = null;
});

test("returns one vector per input in order", async () => {
  createMock.mockResolvedValue({
    data: [
      { index: 0, embedding: Array(EMBEDDING_DIM).fill(0.1) },
      { index: 1, embedding: Array(EMBEDDING_DIM).fill(0.2) },
    ],
  });
  const out = await embedTexts(["a", "b"]);
  expect(out).toHaveLength(2);
  expect(out[0]).toHaveLength(EMBEDDING_DIM);
  expect(out[1][0]).toBeCloseTo(0.2);
});

test("reorders by returned index", async () => {
  createMock.mockResolvedValue({
    data: [
      { index: 1, embedding: Array(EMBEDDING_DIM).fill(0.2) },
      { index: 0, embedding: Array(EMBEDDING_DIM).fill(0.1) },
    ],
  });
  const out = await embedTexts(["a", "b"]);
  expect(out[0][0]).toBeCloseTo(0.1);
  expect(out[1][0]).toBeCloseTo(0.2);
});

test("throws EmbeddingsUnavailableError when base url unset", async () => {
  secrets.EMBEDDINGS_BASE_URL = null;
  await expect(embedTexts(["a"])).rejects.toBeInstanceOf(EmbeddingsUnavailableError);
});

test("empty input returns empty without calling the API", async () => {
  expect(await embedTexts([])).toEqual([]);
  expect(createMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- embeddings.test`
Expected: FAIL — `Cannot find module '@/lib/ai/embeddings'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ai/embeddings.ts`:

```ts
import OpenAI from "openai";
import { getOptionalSecret } from "@/lib/config/resolver";

export const EMBEDDING_DIM = 1024;
const DEFAULT_MODEL = "bge-m3";
const BATCH_SIZE = 64;

export class EmbeddingsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingsUnavailableError";
  }
}

async function getEmbeddingsClient() {
  const [baseURL, model] = await Promise.all([
    getOptionalSecret("EMBEDDINGS_BASE_URL"),
    getOptionalSecret("EMBEDDINGS_MODEL"),
  ]);
  if (!baseURL) {
    throw new EmbeddingsUnavailableError("EMBEDDINGS_BASE_URL is not configured");
  }
  // Ollama/LocalAI OpenAI-compatible endpoints ignore the key but the SDK requires one.
  const client = new OpenAI({ baseURL, apiKey: "ollama", maxRetries: 3 });
  return { client, model: model ?? DEFAULT_MODEL };
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { client, model } = await getEmbeddingsClient();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await client.embeddings.create({ model, input: batch });
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    for (const row of sorted) out.push(row.embedding as number[]);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- embeddings.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/embeddings.ts __tests__/lib/ai/embeddings.test.ts
git commit -m "feat: add Odysseus embeddings client"
```

---

### Task 3: Chunking utility

**Files:**
- Create: `lib/ai/chunk.ts`
- Test: `__tests__/lib/ai/chunk.test.ts`

**Interfaces:**
- Produces:
  - `interface TextChunk { content: string; chunkIndex: number; contentHash: string; tokens: number }`
  - `function chunkText(text: string, opts?: { maxTokens?: number; overlapTokens?: number }): TextChunk[]` — approx-token chunking (1 token ≈ 4 chars), default `maxTokens: 500`, `overlapTokens: 50`. `contentHash` is sha256 hex of the chunk content.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/ai/chunk.test.ts`:

```ts
import { chunkText } from "@/lib/ai/chunk";

test("short text yields a single chunk", () => {
  const chunks = chunkText("hello world");
  expect(chunks).toHaveLength(1);
  expect(chunks[0].chunkIndex).toBe(0);
  expect(chunks[0].content).toBe("hello world");
  expect(chunks[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
});

test("long text splits into ordered chunks with overlap", () => {
  const word = "lorem ";
  const text = word.repeat(2000); // ~12k chars ≈ 3000 tokens
  const chunks = chunkText(text, { maxTokens: 500, overlapTokens: 50 });
  expect(chunks.length).toBeGreaterThan(1);
  chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  // Overlap: the tail of chunk N appears at the head of chunk N+1.
  const tail = chunks[0].content.slice(-100);
  expect(chunks[1].content.startsWith(tail.split(" ").slice(-3).join(" "))).toBe(true);
});

test("identical content produces identical hash", () => {
  expect(chunkText("same")[0].contentHash).toBe(chunkText("same")[0].contentHash);
});

test("empty/whitespace text yields no chunks", () => {
  expect(chunkText("   ")).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- chunk.test`
Expected: FAIL — `Cannot find module '@/lib/ai/chunk'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ai/chunk.ts`:

```ts
import { createHash } from "crypto";

export interface TextChunk {
  content: string;
  chunkIndex: number;
  contentHash: string;
  tokens: number;
}

const CHARS_PER_TOKEN = 4;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function chunkText(
  text: string,
  opts: { maxTokens?: number; overlapTokens?: number } = {},
): TextChunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const maxChars = (opts.maxTokens ?? 500) * CHARS_PER_TOKEN;
  const overlapChars = (opts.overlapTokens ?? 50) * CHARS_PER_TOKEN;
  const words = trimmed.split(/\s+/);

  const chunks: TextChunk[] = [];
  let buf: string[] = [];
  let bufLen = 0;

  const flush = () => {
    if (buf.length === 0) return;
    const content = buf.join(" ");
    chunks.push({
      content,
      chunkIndex: chunks.length,
      contentHash: sha256(content),
      tokens: Math.ceil(content.length / CHARS_PER_TOKEN),
    });
  };

  for (const w of words) {
    if (bufLen + w.length + 1 > maxChars && buf.length > 0) {
      flush();
      // Seed the next buffer with the overlap tail of the previous chunk.
      const overlap: string[] = [];
      let oLen = 0;
      for (let i = buf.length - 1; i >= 0 && oLen < overlapChars; i--) {
        overlap.unshift(buf[i]);
        oLen += buf[i].length + 1;
      }
      buf = overlap;
      bufLen = oLen;
    }
    buf.push(w);
    bufLen += w.length + 1;
  }
  flush();
  return chunks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- chunk.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/chunk.ts __tests__/lib/ai/chunk.test.ts
git commit -m "feat: add token-approx text chunker for KB"
```

---

### Task 4: Retrieval helper + grounding formatter

**Files:**
- Create: `lib/ai/knowledge.ts`
- Test: `__tests__/lib/ai/knowledge.test.ts`

**Interfaces:**
- Consumes: `embedTexts`, `EmbeddingsUnavailableError` (Task 2); `prisma` from `@/lib/db`.
- Produces:
  - `interface RetrievedChunk { sourceType: string; sourceId: string; content: string; score: number; metadata: Record<string, unknown> }`
  - `async function retrieveContext(args: { query: string; sourceTypes?: string[]; topK?: number; minScore?: number }): Promise<RetrievedChunk[]>` — embeds the query, runs pgvector cosine search, filters by `minScore` (default 0.35), defaults `topK: 6`. **Returns `[]` on any error.**
  - `function formatGroundingBlock(chunks: RetrievedChunk[]): string` — renders a citeable text block, or `""` when empty.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/ai/knowledge.test.ts`:

```ts
import { retrieveContext, formatGroundingBlock } from "@/lib/ai/knowledge";
import { embedTexts, EmbeddingsUnavailableError } from "@/lib/ai/embeddings";
import { prisma } from "@/lib/db";

jest.mock("@/lib/ai/embeddings", () => ({
  embedTexts: jest.fn(),
  EmbeddingsUnavailableError: class extends Error {},
}));
jest.mock("@/lib/db", () => ({ prisma: { $queryRawUnsafe: jest.fn() } }));

const mockEmbed = embedTexts as jest.Mock;
const mockQuery = prisma.$queryRawUnsafe as jest.Mock;

beforeEach(() => {
  mockEmbed.mockReset();
  mockQuery.mockReset();
  mockEmbed.mockResolvedValue([Array(1024).fill(0.1)]);
});

test("returns rows above minScore, ordered as the DB returns them", async () => {
  mockQuery.mockResolvedValue([
    { sourceType: "article", sourceId: "a1", content: "x", score: 0.9, metadata: { title: "T" } },
    { sourceType: "review", sourceId: "r1", content: "y", score: 0.5, metadata: {} },
  ]);
  const out = await retrieveContext({ query: "ginger tea", minScore: 0.4 });
  expect(out.map((r) => r.sourceId)).toEqual(["a1", "r1"]);
});

test("drops rows below minScore", async () => {
  mockQuery.mockResolvedValue([
    { sourceType: "article", sourceId: "a1", content: "x", score: 0.9, metadata: {} },
    { sourceType: "review", sourceId: "r1", content: "y", score: 0.2, metadata: {} },
  ]);
  const out = await retrieveContext({ query: "q", minScore: 0.35 });
  expect(out.map((r) => r.sourceId)).toEqual(["a1"]);
});

test("returns [] when embeddings unavailable (graceful)", async () => {
  mockEmbed.mockRejectedValue(new EmbeddingsUnavailableError("off"));
  expect(await retrieveContext({ query: "q" })).toEqual([]);
});

test("returns [] when the DB query throws (graceful)", async () => {
  mockQuery.mockRejectedValue(new Error("db down"));
  expect(await retrieveContext({ query: "q" })).toEqual([]);
});

test("formatGroundingBlock is empty for no chunks", () => {
  expect(formatGroundingBlock([])).toBe("");
});

test("formatGroundingBlock cites source + title", () => {
  const block = formatGroundingBlock([
    { sourceType: "article", sourceId: "a1", content: "Ginger helps digestion.", score: 0.9, metadata: { title: "Ginger 101" } },
  ]);
  expect(block).toContain("Ginger 101");
  expect(block).toContain("Ginger helps digestion.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- knowledge.test`
Expected: FAIL — `Cannot find module '@/lib/ai/knowledge'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ai/knowledge.ts`:

```ts
import { prisma } from "@/lib/db";
import { embedTexts } from "@/lib/ai/embeddings";

export interface RetrievedChunk {
  sourceType: string;
  sourceId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

function toVectorLiteral(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

export async function retrieveContext(args: {
  query: string;
  sourceTypes?: string[];
  topK?: number;
  minScore?: number;
}): Promise<RetrievedChunk[]> {
  const topK = args.topK ?? 6;
  const minScore = args.minScore ?? 0.35;
  try {
    const [vec] = await embedTexts([args.query]);
    if (!vec) return [];
    const literal = toVectorLiteral(vec);

    const params: unknown[] = [literal];
    let filter = "";
    if (args.sourceTypes && args.sourceTypes.length > 0) {
      params.push(args.sourceTypes);
      filter = `WHERE "sourceType" = ANY($${params.length})`;
    }
    params.push(topK);
    const limitIdx = params.length;

    const rows = await prisma.$queryRawUnsafe<RetrievedChunk[]>(
      `SELECT "sourceType", "sourceId", content,
              1 - (embedding <=> $1::vector) AS score,
              metadata
       FROM "KnowledgeChunk"
       ${filter}
       ORDER BY embedding <=> $1::vector
       LIMIT $${limitIdx}`,
      ...params,
    );
    return rows.filter((r) => Number(r.score) >= minScore).map((r) => ({ ...r, score: Number(r.score) }));
  } catch (err) {
    console.warn("[knowledge] retrieveContext degraded to empty:", err);
    return [];
  }
}

export function formatGroundingBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  const items = chunks.map((c, i) => {
    const title = (c.metadata?.title as string) ?? `${c.sourceType}:${c.sourceId}`;
    return `[${i + 1}] (${c.sourceType} — ${title})\n${c.content}`;
  });
  return [
    "GROUNDING CONTEXT — relevant material from Agriko's own corpus.",
    "Use it for accuracy and to avoid duplicating existing content. Cite by [n] where you rely on it.",
    "",
    items.join("\n\n"),
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- knowledge.test`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/knowledge.ts __tests__/lib/ai/knowledge.test.ts
git commit -m "feat: add retrieveContext + grounding formatter"
```

---

### Task 5: Source extraction

**Files:**
- Create: `lib/ai/knowledge-sources.ts`
- Test: `__tests__/lib/ai/knowledge-sources.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`; `fetchBlogArticles` from `@/lib/shopify-admin`.
- Produces:
  - `interface SourceDoc { sourceType: string; sourceId: string; text: string; metadata: Record<string, unknown> }`
  - `async function collectSourceDocs(): Promise<SourceDoc[]>` — pulls text from blog articles (live Shopify), `ProductReview`, `ContentProposal`, `MarketInsight`, `Recommendation`, `CompetitorAd`. Skips rows with empty text. `metadata` carries `{ title?, url? }` for citations.

**Field names are taken directly from `prisma/schema.prisma` and `lib/shopify-admin.ts`:**
- **Articles**: `ArticleRecord` does **not** store body text (only `contentHash` + metrics). The full body lives in Shopify, so articles are pulled via `fetchBlogArticles()` → `BlogArticle { id, title, bodyHtml, handle, onlineStoreUrl }`.
- `ProductReview` → text field is **`text`** (not `body`); citation title is `productTitle`.
- `ContentProposal` → has **`title` + `description`** (no `brief` field).
- `MarketInsight` → **`title` + `summary`**.
- `Recommendation` → **`rationale`** (+ `estimatedImpact`); citation title is `targetEntityName`.
- `CompetitorAd` → **`adCopyEn`/`adCopy`, `headlineEn`/`headline`, `description`** (no `adText`); prefer the `*En` English variants.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/ai/knowledge-sources.test.ts`:

```ts
import { collectSourceDocs } from "@/lib/ai/knowledge-sources";
import { prisma } from "@/lib/db";
import { fetchBlogArticles } from "@/lib/shopify-admin";

jest.mock("@/lib/shopify-admin", () => ({ fetchBlogArticles: jest.fn() }));
jest.mock("@/lib/db", () => ({
  prisma: {
    productReview: { findMany: jest.fn() },
    contentProposal: { findMany: jest.fn() },
    marketInsight: { findMany: jest.fn() },
    recommendation: { findMany: jest.fn() },
    competitorAd: { findMany: jest.fn() },
  },
}));

beforeEach(() => {
  (fetchBlogArticles as jest.Mock).mockResolvedValue([]);
  for (const m of Object.values(prisma as Record<string, { findMany: jest.Mock }>)) {
    m.findMany.mockResolvedValue([]);
  }
});

test("maps blog articles to SourceDoc with citation metadata", async () => {
  (fetchBlogArticles as jest.Mock).mockResolvedValue([
    { id: "gid://shopify/Article/1", title: "Ginger 101", bodyHtml: "<p>Ginger is great</p>", handle: "ginger-101", onlineStoreUrl: "https://agrikoph.com/blogs/news/ginger-101" },
  ]);
  const docs = await collectSourceDocs();
  const art = docs.find((d) => d.sourceType === "article");
  expect(art).toMatchObject({ sourceType: "article", sourceId: "gid://shopify/Article/1" });
  expect(art!.text).toContain("Ginger");
  expect(art!.metadata).toMatchObject({ title: "Ginger 101", url: "https://agrikoph.com/blogs/news/ginger-101" });
});

test("uses ProductReview.text and skips empty-text rows", async () => {
  (prisma.productReview.findMany as jest.Mock).mockResolvedValue([
    { id: "r1", text: "Great turmeric, fast delivery.", productTitle: "Turmeric" },
    { id: "r2", text: "   " },
  ]);
  const docs = await collectSourceDocs();
  const reviews = docs.filter((d) => d.sourceType === "review");
  expect(reviews).toHaveLength(1);
  expect(reviews[0]).toMatchObject({ sourceId: "r1", metadata: { title: "Turmeric" } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- knowledge-sources.test`
Expected: FAIL — `Cannot find module '@/lib/ai/knowledge-sources'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ai/knowledge-sources.ts`:

```ts
import { prisma } from "@/lib/db";
import { fetchBlogArticles } from "@/lib/shopify-admin";

export interface SourceDoc {
  sourceType: string;
  sourceId: string;
  text: string;
  metadata: Record<string, unknown>;
}

function stripHtml(html: string | null | undefined): string {
  return (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function joinNonEmpty(parts: (string | null | undefined)[]): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join("\n");
}

function push(docs: SourceDoc[], doc: SourceDoc) {
  if (doc.text.trim()) docs.push(doc);
}

export async function collectSourceDocs(): Promise<SourceDoc[]> {
  const docs: SourceDoc[] = [];

  // Articles: body text is not persisted in ArticleRecord — pull live from Shopify.
  const articles = await fetchBlogArticles();
  for (const a of articles) {
    push(docs, {
      sourceType: "article",
      sourceId: a.id,
      text: joinNonEmpty([a.title, stripHtml(a.bodyHtml)]),
      metadata: { title: a.title, url: a.onlineStoreUrl ?? null, handle: a.handle },
    });
  }

  const reviews = await prisma.productReview.findMany({
    select: { id: true, text: true, productTitle: true },
  });
  for (const r of reviews) {
    push(docs, {
      sourceType: "review",
      sourceId: r.id,
      text: r.text ?? "",
      metadata: { title: r.productTitle },
    });
  }

  const proposals = await prisma.contentProposal.findMany({
    select: { id: true, title: true, description: true },
  });
  for (const p of proposals) {
    push(docs, {
      sourceType: "brief",
      sourceId: p.id,
      text: joinNonEmpty([p.title, p.description]),
      metadata: { title: p.title },
    });
  }

  const insights = await prisma.marketInsight.findMany({
    select: { id: true, title: true, summary: true },
  });
  for (const m of insights) {
    push(docs, {
      sourceType: "market_insight",
      sourceId: m.id,
      text: joinNonEmpty([m.title, m.summary]),
      metadata: { title: m.title },
    });
  }

  const recs = await prisma.recommendation.findMany({
    select: { id: true, rationale: true, estimatedImpact: true, targetEntityName: true },
  });
  for (const rec of recs) {
    push(docs, {
      sourceType: "recommendation",
      sourceId: rec.id,
      text: joinNonEmpty([rec.rationale, rec.estimatedImpact]),
      metadata: { title: rec.targetEntityName },
    });
  }

  const ads = await prisma.competitorAd.findMany({
    select: { id: true, adCopy: true, adCopyEn: true, headline: true, headlineEn: true, description: true },
  });
  for (const ad of ads) {
    push(docs, {
      sourceType: "competitor_ad",
      sourceId: ad.id,
      text: joinNonEmpty([ad.headlineEn ?? ad.headline, ad.adCopyEn ?? ad.adCopy, ad.description]),
      metadata: {},
    });
  }

  return docs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- knowledge-sources.test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/knowledge-sources.ts __tests__/lib/ai/knowledge-sources.test.ts
git commit -m "feat: collect corpus source docs for KB indexing"
```

---

### Task 6: Indexing job + cron route + registry

**Files:**
- Create: `jobs/index-knowledge.ts`
- Create: `app/api/cron/index-knowledge/route.ts`
- Modify: `lib/dashboard/job-registry.ts` (add `index-knowledge` to the type union and registry array)
- Test: `__tests__/jobs/index-knowledge.test.ts`

**Interfaces:**
- Consumes: `collectSourceDocs` (Task 5), `chunkText` (Task 3), `embedTexts` (Task 2), `prisma`.
- Produces: `async function indexKnowledgeHandler(): Promise<JobResult<{ indexed: number; skipped: number; deleted: number }>>`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/jobs/index-knowledge.test.ts`:

```ts
import { indexKnowledgeHandler } from "@/jobs/index-knowledge";
import { collectSourceDocs } from "@/lib/ai/knowledge-sources";
import { embedTexts } from "@/lib/ai/embeddings";
import { prisma } from "@/lib/db";

jest.mock("@/lib/ai/knowledge-sources", () => ({ collectSourceDocs: jest.fn() }));
jest.mock("@/lib/ai/embeddings", () => ({ embedTexts: jest.fn(), EMBEDDING_DIM: 1024 }));
jest.mock("@/lib/db", () => ({
  prisma: {
    jobRun: { create: jest.fn().mockResolvedValue({ id: "run-1" }), update: jest.fn() },
    knowledgeChunk: { findMany: jest.fn(), deleteMany: jest.fn() },
    $executeRawUnsafe: jest.fn(),
  },
}));

const mockCollect = collectSourceDocs as jest.Mock;
const mockEmbed = embedTexts as jest.Mock;
const mockExisting = prisma.knowledgeChunk.findMany as jest.Mock;
const mockExecRaw = prisma.$executeRawUnsafe as jest.Mock;
const mockDelete = prisma.knowledgeChunk.deleteMany as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockExisting.mockResolvedValue([]);
  mockEmbed.mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => Array(1024).fill(0.1))));
});

test("embeds and upserts chunks for new content", async () => {
  mockCollect.mockResolvedValue([
    { sourceType: "article", sourceId: "a1", text: "ginger tea benefits", metadata: { title: "T" } },
  ]);
  const result = await indexKnowledgeHandler();
  expect(mockEmbed).toHaveBeenCalled();
  expect(mockExecRaw).toHaveBeenCalled(); // upsert via raw SQL (vector column)
  expect(result.summary.indexed).toBeGreaterThan(0);
  expect(result.status).toBe("success");
});

test("skips chunks whose contentHash is unchanged", async () => {
  mockCollect.mockResolvedValue([
    { sourceType: "article", sourceId: "a1", text: "stable text", metadata: {} },
  ]);
  // First run computes the hash; capture it by running once with empty existing.
  await indexKnowledgeHandler();
  const insertedHash = mockExecRaw.mock.calls[0].find((a: unknown) => typeof a === "string" && /^[a-f0-9]{64}$/.test(a as string));
  jest.clearAllMocks();
  mockExisting.mockResolvedValue([{ sourceType: "article", sourceId: "a1", chunkIndex: 0, contentHash: insertedHash }]);
  const result = await indexKnowledgeHandler();
  expect(mockEmbed).not.toHaveBeenCalled();
  expect(result.summary.skipped).toBeGreaterThan(0);
});

test("deletes chunks for source rows that no longer exist", async () => {
  mockCollect.mockResolvedValue([]); // no current sources
  mockExisting.mockResolvedValue([{ sourceType: "article", sourceId: "gone", chunkIndex: 0, contentHash: "h" }]);
  const result = await indexKnowledgeHandler();
  expect(mockDelete).toHaveBeenCalled();
  expect(result.summary.deleted).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- index-knowledge.test`
Expected: FAIL — `Cannot find module '@/jobs/index-knowledge'`.

- [ ] **Step 3: Write the job handler**

Create `jobs/index-knowledge.ts`:

```ts
import { prisma } from "@/lib/db";
import type { JobResult, JobStatus } from "@/lib/jobs/types";
import { collectSourceDocs } from "@/lib/ai/knowledge-sources";
import { chunkText } from "@/lib/ai/chunk";
import { embedTexts } from "@/lib/ai/embeddings";

const JOB_NAME = "index-knowledge";

type Summary = { indexed: number; skipped: number; deleted: number };

function vectorLiteral(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

export async function indexKnowledgeHandler(): Promise<JobResult<Summary>> {
  const runId = (await prisma.jobRun.create({ data: { jobName: JOB_NAME } })).id;
  let status: JobStatus = "failed";
  const errors: string[] = [];
  let indexed = 0;
  let skipped = 0;
  let deleted = 0;

  try {
    const docs = await collectSourceDocs();

    const existing = (await prisma.knowledgeChunk.findMany({
      select: { sourceType: true, sourceId: true, chunkIndex: true, contentHash: true },
    })) as { sourceType: string; sourceId: string; chunkIndex: number; contentHash: string }[];
    const existingHash = new Map(
      existing.map((e) => [`${e.sourceType}:${e.sourceId}:${e.chunkIndex}`, e.contentHash]),
    );

    const liveKeys = new Set<string>();
    const toEmbed: {
      sourceType: string; sourceId: string; chunkIndex: number;
      content: string; contentHash: string; tokens: number; metadata: Record<string, unknown>;
    }[] = [];

    for (const doc of docs) {
      const chunks = chunkText(doc.text);
      for (const c of chunks) {
        const key = `${doc.sourceType}:${doc.sourceId}:${c.chunkIndex}`;
        liveKeys.add(key);
        if (existingHash.get(key) === c.contentHash) {
          skipped++;
          continue;
        }
        toEmbed.push({
          sourceType: doc.sourceType, sourceId: doc.sourceId, chunkIndex: c.chunkIndex,
          content: c.content, contentHash: c.contentHash, tokens: c.tokens, metadata: doc.metadata,
        });
      }
    }

    if (toEmbed.length > 0) {
      const vectors = await embedTexts(toEmbed.map((t) => t.content));
      for (let i = 0; i < toEmbed.length; i++) {
        const t = toEmbed[i];
        await prisma.$executeRawUnsafe(
          `INSERT INTO "KnowledgeChunk"
             (id, "sourceType", "sourceId", "chunkIndex", content, "contentHash", embedding, metadata, tokens)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8)
           ON CONFLICT ("sourceType", "sourceId", "chunkIndex")
           DO UPDATE SET content = EXCLUDED.content, "contentHash" = EXCLUDED."contentHash",
                         embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata, tokens = EXCLUDED.tokens`,
          t.sourceType, t.sourceId, t.chunkIndex, t.content, t.contentHash,
          vectorLiteral(vectors[i]), JSON.stringify(t.metadata), t.tokens,
        );
        indexed++;
      }
    }

    // Delete chunks whose live key no longer exists.
    const orphans = existing.filter((e) => !liveKeys.has(`${e.sourceType}:${e.sourceId}:${e.chunkIndex}`));
    if (orphans.length > 0) {
      await prisma.knowledgeChunk.deleteMany({
        where: { OR: orphans.map((o) => ({ sourceType: o.sourceType, sourceId: o.sourceId, chunkIndex: o.chunkIndex })) },
      });
      deleted = orphans.length;
    }

    status = "success";
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const summary: Summary = { indexed, skipped, deleted };
  await prisma.jobRun.update({
    where: { id: runId },
    data: {
      status,
      completedAt: new Date(),
      summary,
      errorLog: errors.length > 0 ? errors.join("\n").slice(0, 10_000) : null,
    },
  });

  return { jobName: JOB_NAME, runId, status, summary, errors };
}
```

(Completion fields — `status`, `completedAt`, `summary`, `errorLog` — match what `jobs/fetch-seo-data.ts` writes; `JobRun` has no `finishedAt`/`error` columns.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- index-knowledge.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the cron route**

Create `app/api/cron/index-knowledge/route.ts`:

```ts
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { indexKnowledgeHandler } from "@/jobs/index-knowledge";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { jobResponse } from "@/lib/jobs/response";

const JOB_NAME = "index-knowledge";

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const acquired = await acquireJobLock(JOB_NAME);
  if (!acquired) {
    return Response.json({ skipped: true, reason: "job already running" }, { status: 409 });
  }

  try {
    const result = await indexKnowledgeHandler();
    return jobResponse(result);
  } catch (err) {
    console.error("[cron/index-knowledge] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseJobLock(JOB_NAME);
  }
}
```

- [ ] **Step 6: Register the job**

In `lib/dashboard/job-registry.ts`, add `"index-knowledge"` to the `DashboardJobName` union and this entry to `DASHBOARD_JOB_REGISTRY`:

```ts
{
  name: "index-knowledge",
  label: "Index Knowledge Base",
  manualTriggerEnabled: true,
  triggerStrategy: "cron",
  cronPath: "/api/cron/index-knowledge",
  cronCadence: "daily",
  expectedCadenceHours: 24,
},
```

- [ ] **Step 7: Typecheck + full test run**

Run: `npm run lint && npm test -- index-knowledge.test`
Expected: lint clean; tests PASS.

- [ ] **Step 8: Backfill on prod (manual, one-time)**

Trigger the job once so the corpus is indexed before any skill relies on it:
Run: `curl -s -H "Authorization: Bearer $AUTOPILOT_API_KEY" https://<prod-host>/api/cron/index-knowledge`
Expected: JSON with `summary.indexed > 0`, `status: "success"`.

- [ ] **Step 9: Commit**

```bash
git add jobs/index-knowledge.ts app/api/cron/index-knowledge/route.ts lib/dashboard/job-registry.ts __tests__/jobs/index-knowledge.test.ts
git commit -m "feat: add index-knowledge job, cron route, registry entry"
```

---

### Task 7: Ground Content Pilot drafts

**Files:**
- Modify: `lib/content-pilot/generate-draft.ts` (inject grounding into `callAI`)
- Test: `__tests__/lib/content-pilot/generate-draft-grounding.test.ts`

**Interfaces:**
- Consumes: `retrieveContext`, `formatGroundingBlock` (Task 4).
- Produces: grounded prompts; behavior unchanged when retrieval returns `[]`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-pilot/generate-draft-grounding.test.ts`:

```ts
import { buildGroundedSystemPrompt } from "@/lib/content-pilot/generate-draft";

// Mock only retrieveContext; keep the real formatGroundingBlock so the test
// exercises the actual rendering.
jest.mock("@/lib/ai/knowledge", () => {
  const actual = jest.requireActual("@/lib/ai/knowledge");
  return { ...actual, retrieveContext: jest.fn() };
});
import { retrieveContext } from "@/lib/ai/knowledge";
const mockRetrieve = retrieveContext as jest.Mock;

beforeEach(() => mockRetrieve.mockReset());

test("appends grounding block when chunks are retrieved", async () => {
  mockRetrieve.mockResolvedValue([
    { sourceType: "article", sourceId: "a1", content: "Agriko ginger is organic.", score: 0.9, metadata: { title: "Ginger" } },
  ]);
  const prompt = await buildGroundedSystemPrompt("base system", "organic ginger tea");
  expect(prompt).toContain("base system");
  expect(prompt).toContain("Agriko ginger is organic.");
});

test("returns base prompt unchanged when nothing retrieved", async () => {
  mockRetrieve.mockResolvedValue([]);
  const prompt = await buildGroundedSystemPrompt("base system", "organic ginger tea");
  expect(prompt).toBe("base system");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- generate-draft-grounding.test`
Expected: FAIL — `buildGroundedSystemPrompt` is not exported.

- [ ] **Step 3: Implement the grounding helper and wire it into `callAI`**

In `lib/content-pilot/generate-draft.ts`, add the import and helper, and call it inside `callAI`:

```ts
import { retrieveContext, formatGroundingBlock } from "@/lib/ai/knowledge";

// Builds a system prompt grounded in Agriko's own corpus. Additive: if retrieval
// returns nothing (e.g. embeddings offline), returns the base prompt unchanged.
export async function buildGroundedSystemPrompt(baseSystem: string, query: string): Promise<string> {
  const chunks = await retrieveContext({ query, sourceTypes: ["article", "review"], topK: 6 });
  const block = formatGroundingBlock(chunks);
  return block ? `${baseSystem}\n\n${block}` : baseSystem;
}
```

Then update `callAI` to accept an optional grounding query and apply it. Change its signature and body:

```ts
async function callAI(systemPrompt: string, userPrompt: string, maxTokens = 16384, groundingQuery?: string): Promise<string> {
  const guidelines = await getBrandGuidelines();
  let fullSystem = guidelines.trim()
    ? `${systemPrompt}\n\nBRAND & WRITING GUIDELINES (follow strictly):\n${guidelines}`
    : systemPrompt;
  if (groundingQuery) {
    fullSystem = await buildGroundedSystemPrompt(fullSystem, groundingQuery);
  }
  // ... existing client call unchanged ...
}
```

At each `callAI(...)` call site that generates article/body content, pass a grounding query built from the proposal's real fields — `` `${proposal.title} ${proposal.articleHandle ?? ""}` `` (`ContentProposal` has `title`, `description`, `articleHandle`, `proposalType`; there is no `targetKeyword`). Leave SEO-meta-only call sites without a grounding query if retrieval adds no value there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- generate-draft-grounding.test`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the existing draft tests to confirm no regression**

Run: `npm test -- generate-draft`
Expected: all existing draft tests still PASS (grounding is additive).

- [ ] **Step 6: Commit**

```bash
git add lib/content-pilot/generate-draft.ts __tests__/lib/content-pilot/generate-draft-grounding.test.ts
git commit -m "feat: ground content-pilot drafts in KB corpus"
```

---

### Task 8: Ground recommendations (`run-skills`)

**Files:**
- Modify: `lib/skills/runner.ts` (inject grounding before the recommendation LLM call)
- Test: `__tests__/lib/skills/runner-grounding.test.ts`

**Interfaces:**
- Consumes: `retrieveContext`, `formatGroundingBlock` (Task 4).
- Produces: grounded skill context; unchanged when retrieval returns `[]`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/skills/runner-grounding.test.ts`:

```ts
import { groundSkillContext } from "@/lib/skills/runner";

jest.mock("@/lib/ai/knowledge", () => {
  const actual = jest.requireActual("@/lib/ai/knowledge");
  return { ...actual, retrieveContext: jest.fn() };
});
import { retrieveContext } from "@/lib/ai/knowledge";
const mockRetrieve = retrieveContext as jest.Mock;

beforeEach(() => mockRetrieve.mockReset());

test("adds grounding block when insights exist", async () => {
  mockRetrieve.mockResolvedValue([
    { sourceType: "market_insight", sourceId: "m1", content: "Competitor X cut prices 10%.", score: 0.8, metadata: {} },
  ]);
  const ctx = await groundSkillContext("base context", "campaign ROAS pause");
  expect(ctx).toContain("base context");
  expect(ctx).toContain("Competitor X cut prices 10%.");
});

test("returns base context unchanged when nothing retrieved", async () => {
  mockRetrieve.mockResolvedValue([]);
  expect(await groundSkillContext("base context", "q")).toBe("base context");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- runner-grounding.test`
Expected: FAIL — `groundSkillContext` is not exported.

- [ ] **Step 3: Implement and wire**

In `lib/skills/runner.ts`, add:

```ts
import { retrieveContext, formatGroundingBlock } from "@/lib/ai/knowledge";

// Grounds a skill's context block in the KB. Additive — unchanged when empty.
export async function groundSkillContext(baseContext: string, query: string): Promise<string> {
  const chunks = await retrieveContext({
    query,
    sourceTypes: ["recommendation", "market_insight"],
    topK: 6,
  });
  const block = formatGroundingBlock(chunks);
  return block ? `${baseContext}\n\n${block}` : baseContext;
}
```

Then, where the runner assembles the prompt context fed to the model (the `AGRIKO_CONTEXT` + data block), wrap it: `const grounded = await groundSkillContext(contextBlock, querySummary)` where `querySummary` is built from the skill name + the entities under analysis. Use `grounded` in the message sent to the client.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- runner-grounding.test`
Expected: PASS (2 tests).

- [ ] **Step 5: Regression check**

Run: `npm test -- skills`
Expected: existing skills tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/skills/runner.ts __tests__/lib/skills/runner-grounding.test.ts
git commit -m "feat: ground recommendation skills in KB corpus"
```

---

### Task 9: Ground SEO briefs & market-intel briefs

**Files:**
- Modify: `lib/market-intel/generate-brief.ts`
- Modify: the SEO brief generator (locate via `app/api/seo/brief/route.ts` → the lib function it calls)
- Test: `__tests__/lib/market-intel/generate-brief-grounding.test.ts`

**Interfaces:**
- Consumes: `retrieveContext`, `formatGroundingBlock` (Task 4).
- Reuses the same additive pattern as Tasks 7–8.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/market-intel/generate-brief-grounding.test.ts`:

```ts
import { groundBriefContext } from "@/lib/market-intel/generate-brief";

jest.mock("@/lib/ai/knowledge", () => {
  const actual = jest.requireActual("@/lib/ai/knowledge");
  return { ...actual, retrieveContext: jest.fn() };
});
import { retrieveContext } from "@/lib/ai/knowledge";
const mockRetrieve = retrieveContext as jest.Mock;

beforeEach(() => mockRetrieve.mockReset());

test("adds grounding when competitor history exists", async () => {
  mockRetrieve.mockResolvedValue([
    { sourceType: "competitor_ad", sourceId: "c1", content: "Buy 1 take 1 turmeric.", score: 0.7, metadata: {} },
  ]);
  const ctx = await groundBriefContext("base brief", "turmeric promo");
  expect(ctx).toContain("Buy 1 take 1 turmeric.");
});

test("unchanged when nothing retrieved", async () => {
  mockRetrieve.mockResolvedValue([]);
  expect(await groundBriefContext("base brief", "q")).toBe("base brief");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- generate-brief-grounding.test`
Expected: FAIL — `groundBriefContext` is not exported.

- [ ] **Step 3: Implement in `lib/market-intel/generate-brief.ts`**

```ts
import { retrieveContext, formatGroundingBlock } from "@/lib/ai/knowledge";

export async function groundBriefContext(baseContext: string, query: string): Promise<string> {
  const chunks = await retrieveContext({
    query,
    sourceTypes: ["competitor_ad", "market_insight"],
    topK: 6,
  });
  const block = formatGroundingBlock(chunks);
  return block ? `${baseContext}\n\n${block}` : baseContext;
}
```

Wire it into the brief-assembly path before the model call, with `query` built from the competitor/topic in scope.

- [ ] **Step 4: Wire the SEO brief generator the same way**

Open `app/api/seo/brief/route.ts`, find the lib function it calls to build the brief, and apply the identical pattern there with `sourceTypes: ["article", "recommendation"]` and `query` = the target keyword. Export a `groundSeoBriefContext` helper mirroring the one above and add a parallel 2-case test (`retrieved` vs `empty`) in `__tests__/` next to that lib file.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- generate-brief-grounding.test && npm test -- brief`
Expected: new grounding tests PASS; existing brief tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/market-intel/generate-brief.ts __tests__/lib/market-intel/generate-brief-grounding.test.ts
git add -A   # include the SEO brief lib + its new test
git commit -m "feat: ground SEO + market-intel briefs in KB corpus"
```

---

### Task 10: Operator citations in the review UI

**Files:**
- Modify: skill output persistence to store the retrieved citations (the `metadata.title` + `sourceType` + `score` of injected chunks)
- Modify: the relevant review UI component to display "Grounded by: …" sources
- Test: a component/unit test asserting citations render when present and nothing renders when absent

**Interfaces:**
- Consumes: `RetrievedChunk[]` from `retrieveContext`.

> NOTE: this task depends on where each skill persists its output (e.g. `Recommendation`, `ContentProposalDraftHistory`). The implementer should: (1) have the grounding helpers in Tasks 7–9 also return the `RetrievedChunk[]` they used (add a second return value or a small result object), (2) persist a compact `citations: {sourceType,title,score}[]` JSON alongside the output, (3) render it in the review UI. Keep it additive — absent citations render nothing.

- [ ] **Step 1: Write the failing test** for the citation renderer (assert sources list renders for a populated `citations` prop, renders nothing for `[]`).
- [ ] **Step 2:** Run it; verify it fails.
- [ ] **Step 3:** Thread `RetrievedChunk[]` out of one grounding helper, persist `citations` JSON, render the list.
- [ ] **Step 4:** Run the test; verify it passes.
- [ ] **Step 5:** Manually verify in the embedded admin that a freshly grounded draft/recommendation shows its sources.
- [ ] **Step 6: Commit**

```bash
git commit -am "feat: surface KB grounding citations in review UI"
```

---

## Final verification

- [ ] `npm run lint` — clean.
- [ ] `npm test` — full suite green.
- [ ] `npm run build` — succeeds.
- [ ] Trigger `index-knowledge` on prod; confirm `summary.indexed > 0`.
- [ ] Generate one draft and one recommendation; confirm grounding citations appear and that disabling `EMBEDDINGS_BASE_URL` makes skills fall back to today's behavior with no errors.
- [ ] GROW: update `.mex/ROUTER.md` "Current Project State" (KB grounding live), add a `.mex/patterns/` runbook for "add a new KB source type", bump `last_updated`.
