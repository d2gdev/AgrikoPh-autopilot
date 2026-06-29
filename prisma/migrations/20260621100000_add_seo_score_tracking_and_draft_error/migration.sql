-- Add draftError field for pre-publish validation error messages
ALTER TABLE "ContentProposal" ADD COLUMN IF NOT EXISTS "draftError" TEXT;

-- Add SEO score tracking fields for post-publish feedback loop
ALTER TABLE "ContentProposal" ADD COLUMN IF NOT EXISTS "baselineSeoScore" INTEGER;
ALTER TABLE "ContentProposal" ADD COLUMN IF NOT EXISTS "followUpSeoScore" INTEGER;
ALTER TABLE "ContentProposal" ADD COLUMN IF NOT EXISTS "followUpScoredAt" TIMESTAMP(3);
