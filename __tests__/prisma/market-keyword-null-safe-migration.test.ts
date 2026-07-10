import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("market keyword null-safe migration", () => {
  it("reassigns children, removes duplicates, and creates normalized identity index", () => {
    const sql = readFileSync("prisma/migrations/20260710161000_market_keyword_null_safe_unique/migration.sql", "utf8");
    for (const table of ["ShoppingResult", "ShoppingPriceHistory", "KeywordResearchResult", "MarketInsight"]) expect(sql).toContain(`UPDATE "${table}"`);
    expect(sql).toContain('DROP INDEX IF EXISTS "MarketKeyword_keyword_locationName_languageCode_key"');
    expect(sql).toContain("COALESCE");
    expect(sql).toContain("CREATE UNIQUE INDEX");
  });
});
