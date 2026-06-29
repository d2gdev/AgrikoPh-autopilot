-- CreateTable: per-reviewer product reviews (reviewer name + text + rating)
CREATE TABLE "ProductReview" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT,
    "productTitle" TEXT NOT NULL,
    "source" TEXT,
    "reviewerName" TEXT,
    "rating" DOUBLE PRECISION,
    "text" TEXT,
    "reviewDate" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductReview_productId_reviewerName_text_key" ON "ProductReview"("productId", "reviewerName", "text");
CREATE INDEX "ProductReview_productId_capturedAt_idx" ON "ProductReview"("productId", "capturedAt");
CREATE INDEX "ProductReview_source_idx" ON "ProductReview"("source");
