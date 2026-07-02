-- Outcome feedback loop (Task 4): measures whether executed recommendations
-- helped, by comparing platform metrics before/after execution. Hand-authored
-- to match the Prisma schema; apply with `prisma migrate deploy`
-- (npm run db:migrate) against a real database.

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN "outcome" JSONB;
ALTER TABLE "Recommendation" ADD COLUMN "outcomeCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Recommendation_status_outcomeCheckedAt_idx" ON "Recommendation"("status", "outcomeCheckedAt");
