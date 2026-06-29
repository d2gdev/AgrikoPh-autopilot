-- Add scalar columns to ArticleRecord for queryable signals (previously buried in JSON blobs)
ALTER TABLE "ArticleRecord" ADD COLUMN "author" TEXT;
ALTER TABLE "ArticleRecord" ADD COLUMN "imageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ArticleRecord" ADD COLUMN "headingCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ArticleRecord" ADD COLUMN "ctaCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ArticleRecord" ADD COLUMN "internalLinkCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ArticleRecord" ADD COLUMN "inboundCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ArticleRecord_inboundCount_idx" ON "ArticleRecord"("inboundCount");
CREATE INDEX "ArticleRecord_internalLinkCount_idx" ON "ArticleRecord"("internalLinkCount");
