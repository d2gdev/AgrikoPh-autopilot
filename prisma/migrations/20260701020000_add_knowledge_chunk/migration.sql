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
