-- CreateTable
CREATE TABLE "ArticleRecord" (
    "id" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "seoData" JSONB NOT NULL,
    "linksData" JSONB NOT NULL,
    "topicsData" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticleRecord_shopifyId_key" ON "ArticleRecord"("shopifyId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleRecord_handle_key" ON "ArticleRecord"("handle");

-- CreateIndex
CREATE INDEX "ArticleRecord_handle_idx" ON "ArticleRecord"("handle");

-- CreateIndex
CREATE INDEX "ArticleRecord_indexedAt_idx" ON "ArticleRecord"("indexedAt");
