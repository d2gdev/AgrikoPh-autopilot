import { expect, test } from "vitest";
import { getDraftSchema } from "@/lib/content-pilot/generate-draft";

// Exercises the REAL SeoFixSchema (no mocking of generate-draft) so a regression
// like dropping .max(70)/.max(320) fails here, not just against a hand-copied
// mock stub in publish-draft.test.ts.

test("getDraftSchema('seo-fix') rejects a metaTitle over 70 chars", () => {
  const result = getDraftSchema("seo-fix").safeParse({
    metaTitle: "x".repeat(71),
    metaDescription: "ok",
  });
  expect(result.success).toBe(false);
});

test("getDraftSchema('seo-fix') rejects a metaDescription over 320 chars", () => {
  const result = getDraftSchema("seo-fix").safeParse({
    metaTitle: "ok",
    metaDescription: "x".repeat(321),
  });
  expect(result.success).toBe(false);
});
