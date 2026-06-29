-- Add indexes for common dashboard and cron query paths.
CREATE INDEX "Recommendation_status_targetEntityId_idx" ON "Recommendation"("status", "targetEntityId");
CREATE INDEX "JobRun_startedAt_idx" ON "JobRun"("startedAt");
CREATE INDEX "ArticleRecord_publishedAt_idx" ON "ArticleRecord"("publishedAt");
CREATE INDEX "ContentProposal_status_priority_createdAt_idx" ON "ContentProposal"("status", "priority", "createdAt");
