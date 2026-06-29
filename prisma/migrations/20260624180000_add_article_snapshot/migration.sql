-- CreateTable
CREATE TABLE "ArticleSnapshot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "articleRecordId" TEXT,
    "shopifyId" TEXT,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "headingCount" INTEGER NOT NULL DEFAULT 0,
    "ctaCount" INTEGER NOT NULL DEFAULT 0,
    "internalLinkCount" INTEGER NOT NULL DEFAULT 0,
    "inboundCount" INTEGER NOT NULL DEFAULT 0,
    "seoScore" INTEGER,
    "seoData" JSONB NOT NULL,
    "linksData" JSONB NOT NULL,
    "topicsData" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArticleSnapshot_articleRecordId_idx" ON "ArticleSnapshot"("articleRecordId");

-- CreateIndex
CREATE INDEX "ArticleSnapshot_handle_capturedAt_idx" ON "ArticleSnapshot"("handle", "capturedAt");

-- CreateIndex
CREATE INDEX "ArticleSnapshot_contentHash_idx" ON "ArticleSnapshot"("contentHash");

-- CreateIndex
CREATE INDEX "ArticleSnapshot_seoScore_idx" ON "ArticleSnapshot"("seoScore");

-- AddForeignKey
ALTER TABLE "ArticleSnapshot" ADD CONSTRAINT "ArticleSnapshot_articleRecordId_fkey" FOREIGN KEY ("articleRecordId") REFERENCES "ArticleRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
