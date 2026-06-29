-- CreateTable
CREATE TABLE "SkillInsight" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "skillId" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "insightType" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "jobRunId" TEXT,

    CONSTRAINT "SkillInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillInsight_insightType_createdAt_idx" ON "SkillInsight"("insightType", "createdAt");

-- CreateIndex
CREATE INDEX "SkillInsight_skillId_createdAt_idx" ON "SkillInsight"("skillId", "createdAt");

-- CreateIndex
CREATE INDEX "SkillInsight_jobRunId_idx" ON "SkillInsight"("jobRunId");

-- AddForeignKey
ALTER TABLE "SkillInsight" ADD CONSTRAINT "SkillInsight_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
