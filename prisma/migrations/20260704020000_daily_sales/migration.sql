-- DailySales daily revenue rollups (Phase 4 Shopify orders ingestion). Hand-authored
-- to match the Prisma model added to schema.prisma; apply with `prisma migrate deploy`
-- (npm run db:migrate) or `prisma migrate dev` against a dev database.

-- CreateTable
CREATE TABLE "DailySales" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "orders" INTEGER NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL,
    "aov" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailySales_date_idx" ON "DailySales"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailySales_date_key" ON "DailySales"("date");
