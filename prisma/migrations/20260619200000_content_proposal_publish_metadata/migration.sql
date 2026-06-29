-- Add publish metadata fields to ContentProposal
ALTER TABLE "ContentProposal" ADD COLUMN "shopifyArticleId" TEXT;
ALTER TABLE "ContentProposal" ADD COLUMN "publishedHandle" TEXT;
