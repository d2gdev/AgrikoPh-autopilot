ALTER TABLE "ArticleRecord" ADD COLUMN "blogHandle" TEXT;

UPDATE "ArticleRecord"
SET "blogHandle" = COALESCE(
  NULLIF(BTRIM("seoData" ->> 'blogHandle'), ''),
  'news'
);

ALTER TABLE "ArticleRecord" ALTER COLUMN "blogHandle" SET DEFAULT 'news';
ALTER TABLE "ArticleRecord" ALTER COLUMN "blogHandle" SET NOT NULL;

DROP INDEX IF EXISTS "ArticleRecord_handle_key";
CREATE UNIQUE INDEX "ArticleRecord_blogHandle_handle_key" ON "ArticleRecord"("blogHandle", "handle");
