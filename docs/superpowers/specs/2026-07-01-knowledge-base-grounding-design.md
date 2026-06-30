# Knowledge Base for Grounding AI Skill Outputs — Design

**Date:** 2026-07-01
**Status:** Approved design, pending implementation plan
**Owner:** Sean

## Problem

The Agriko Autopilot AI skills (Content Pilot drafts, SEO briefs, recommendations,
market-intel briefs) generate output from whatever structured rows their hand-written
queries happen to pull from Postgres. They have no semantic access to the app's own
corpus — past articles, product reviews, briefs, prior recommendations, competitor ad
copy. As a result, output can duplicate existing content, miss on-brand context, or
fail to cite real evidence.

**Goal:** Add a shared semantic-retrieval layer (a knowledge base) that every AI skill
calls to ground its output in the app's real, existing content — with citations
surfaced to the operator.

## Non-Goals

- Operator "ask your data" chat (possible later; not this project).
- A second datastore. Vectors live in the existing Postgres.
- Any external data egress. Embeddings run on self-hosted Odysseus.
- Replacing the existing structured queries — retrieval is **strictly additive**.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Vector store | **pgvector** in existing Postgres | One DB, transactional with source rows, no new datastore to operate. Corpus is small (hundreds–low thousands of docs). |
| Rejected alternative | Qdrant on Odysseus | More vector features, but a second datastore to back up and keep consistent. Not worth it at this scale. |
| Embeddings host | **Odysseus Ollama** (`/v1/embeddings`) | Already running; zero new services; no external egress. |
| Embedding model | **bge-m3** (1024 dims) | Multilingual — corpus contains Filipino content (`lib/content-pilot/detect-filipino.ts`). nomic-embed-text is English-first. |
| Index type | **HNSW** (cosine) | Small corpus; no training step (unlike IVFFlat). |
| Failure mode | **Graceful degradation** | If retrieval returns nothing / Odysseus is down, every skill behaves exactly as today. No new hard dependency in the recommendation path. |

## Architecture

```
                 ┌─────────────────────────────────────────┐
  daily cron ──▶ │ index-knowledge job                      │
                 │  walk source tables → chunk → embed      │
                 │  (Odysseus Ollama /v1/embeddings, bge-m3)│
                 │  → upsert KnowledgeChunk (pgvector)      │
                 └─────────────────────────────────────────┘
                                    │
  AI skill ─▶ retrieveContext(query) ─▶ pgvector cosine top-K ─▶ inject into prompt ─▶ DeepSeek
  (content / seo / recs / market)        (lib/ai/knowledge.ts)      with citations
```

## Components

### 1. Embeddings client — `lib/ai/embeddings.ts`

Thin client mirroring `lib/ai/client.ts`. Reads two secrets via the existing
`getOptionalSecret` resolver:

- `EMBEDDINGS_BASE_URL` — Odysseus Ollama OpenAI-compatible base URL.
- `EMBEDDINGS_MODEL` — defaults to `bge-m3`.

Exposes `embed(texts: string[]): Promise<number[][]>` with batching and retry/backoff
(same pattern as the DeepSeek client). Throws a typed error if unconfigured/unreachable
so callers can degrade gracefully.

### 2. Data model — `KnowledgeChunk`

```prisma
model KnowledgeChunk {
  id          String   @id @default(cuid())
  sourceType  String   // "article" | "review" | "brief" | "recommendation" | "market_insight" | "competitor_ad"
  sourceId    String   // ref to the originating row
  chunkIndex  Int
  content     String   @db.Text
  contentHash String   // sha256 of content — lets indexing skip unchanged chunks
  embedding   Unsupported("vector(1024)")
  metadata    Json     // { title, url, productName, lang, publishedAt, ... } for citations + filtering
  tokens      Int
  createdAt   DateTime @default(now())

  @@unique([sourceType, sourceId, chunkIndex])
  @@index([sourceType])
}
```

Migration also runs:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE INDEX knowledge_chunk_embedding_hnsw
  ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops);
```

Prisma does not natively support the `vector` type — the column is declared
`Unsupported("vector(1024)")`, and all similarity reads/writes use raw SQL
(`$queryRaw` / `$executeRaw`).

### 3. Indexing job — `jobs/index-knowledge.ts`

Follows the existing job pattern: `requireCronAuth` (when triggered via cron route),
`acquireJobLock`, `JobRun` logging. Runs in the daily cron after the fetch jobs, plus a
manual trigger.

Steps:

1. Pull text from each source: blog articles via `fetchBlogArticles()` (live
   Shopify — `ArticleRecord` stores only a content hash + metrics, not body text),
   `ProductReview.text`, `ContentProposal` (`title` + `description`),
   `MarketInsight` (`title` + `summary`), `Recommendation.rationale`,
   `CompetitorAd` (`headline*`/`adCopy*`/`description`).
2. Chunk to ~500 tokens with ~50 overlap; compute `contentHash` per chunk.
3. **Incremental**: skip chunks whose `(sourceType, sourceId, chunkIndex)` hash is
   unchanged. Daily runs only embed new/edited content.
4. Embed changed chunks via the Odysseus endpoint (batched); `upsert` into
   `KnowledgeChunk`. Delete chunks whose source row no longer exists.

### 4. Retrieval helper — `lib/ai/knowledge.ts`

```ts
retrieveContext({
  query: string,
  sourceTypes?: string[],   // optional filter, e.g. ["article","review"]
  topK = 6,
  minScore = 0.35,          // drop weak matches so we never inject noise
}): Promise<RetrievedChunk[]>
```

Embeds the query via the same endpoint, runs a pgvector cosine search via raw SQL
(`embedding <=> $queryVec`), filters by `minScore`, returns chunks with `metadata`
(title/url/source) and score. Single function shared by all skills. On embeddings
failure, returns `[]` (never throws to the caller) so skills degrade gracefully.

### 5. Skill integration

Before each skill's DeepSeek call, it builds a query from its own task and injects the
hits as a grounding block with citations:

| Skill | Query built from | Source filter |
|---|---|---|
| Content Pilot draft | proposal title + keywords | article, review |
| SEO brief | target keyword | article, recommendation |
| Recommendations | the metric/opportunity in play | recommendation, market_insight |
| Market-intel brief | competitor + topic | competitor_ad, market_insight |

Retrieved sources are attached to the skill output so the operator can see what grounded
a given draft/recommendation in the review UI.

**Graceful degradation (critical):** if `retrieveContext` returns nothing or Odysseus is
down, every skill runs exactly as it does today. Retrieval adds no hard dependency to the
recommendation path (respects project non-negotiables).

## Testing (TDD — tests first)

- **Unit:**
  - Chunking — boundary and overlap correctness.
  - `contentHash` skip logic — unchanged chunks are not re-embedded.
  - Embeddings client — against a mocked endpoint (batching, retry, typed error).
  - Retrieval SQL — ranking order and `minScore` filtering against a seeded test DB.
- **Integration:**
  - Skill run with embeddings **mocked present** — context injected and cited.
  - Skill run with embeddings **mocked absent** — output identical to today's behavior.

## Rollout

1. Migration (extension + table + HNSW index).
2. Embeddings client + retrieval helper (+ unit tests).
3. Indexing job; backfill run on prod.
4. Wire skills one at a time behind the additive path; verify citations in the review UI.

## Open Questions

None blocking. Chunk size / `topK` / `minScore` are tunable after the first backfill
shows real retrieval quality.
