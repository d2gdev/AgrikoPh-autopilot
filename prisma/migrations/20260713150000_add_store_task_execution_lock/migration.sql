CREATE TABLE "StoreTaskExecutionLock" (
  "targetUrl" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreTaskExecutionLock_pkey" PRIMARY KEY ("targetUrl")
);

CREATE UNIQUE INDEX "StoreTaskExecutionLock_taskId_key" ON "StoreTaskExecutionLock"("taskId");
