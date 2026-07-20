CREATE TABLE "BacklogItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BacklogItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BacklogItem_status_dueAt_idx"
ON "BacklogItem"("status", "dueAt");
