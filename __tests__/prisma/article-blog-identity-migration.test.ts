import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("article blog identity migration", () => {
  it("backfills legacy rows safely and replaces global handle uniqueness", () => {
    const sql = readFileSync("prisma/migrations/20260714030000_add_article_blog_handle/migration.sql", "utf8");
    expect(sql).toMatch(/COALESCE\(\s*NULLIF\(BTRIM\("seoData"\s*->>\s*'blogHandle'\), ''\),\s*'news'\s*\)/);
    expect(sql).toContain(`ALTER COLUMN "blogHandle" SET NOT NULL`);
    expect(sql).toContain(`DROP INDEX IF EXISTS "ArticleRecord_handle_key"`);
    expect(sql).toContain(`CREATE UNIQUE INDEX "ArticleRecord_blogHandle_handle_key"`);
  });
});
