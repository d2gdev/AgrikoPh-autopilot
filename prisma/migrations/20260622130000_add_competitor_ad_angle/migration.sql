-- Adds an LLM-classified creative-angle label to competitor ads
-- (e.g. discount, social-proof, problem-solution). Nullable; backfilled async.
ALTER TABLE "CompetitorAd" ADD COLUMN "creativeAngle" TEXT;
