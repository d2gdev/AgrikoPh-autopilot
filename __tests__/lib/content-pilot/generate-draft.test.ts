import { expect, test } from "vitest";
import {
  assertExactInternalLinkDraft,
  buildExactInternalLinkParagraph,
  getDraftSchema,
} from "@/lib/content-pilot/generate-draft";

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

test.each([
  "/blogs/news/black-rice",
  "/blogs/recipes/black-rice",
  "/products/black-rice",
  "/collections/organic-rice",
  "/pages/black-rice-recipes",
])("internal-link validation preserves the exact governed target %s", (toUrl) => {
  const proposal = { proposedState: { toUrl, toArticle: toUrl.split("/").at(-1) } } as never;
  expect(() => assertExactInternalLinkDraft(proposal, { suggestedParagraph: `<p>See <a href="${toUrl}">the guide</a>.</p>`, anchorText: "the guide", targetHandle: toUrl.split("/").at(-1)! })).not.toThrow();
});

test("internal-link validation rejects a recipes target rewritten into news", () => {
  const proposal = { proposedState: { toUrl: "/blogs/recipes/shared", toArticle: "shared" } } as never;
  expect(() => assertExactInternalLinkDraft(proposal, { suggestedParagraph: '<p><a href="/blogs/news/shared">Shared recipe</a></p>', anchorText: "Shared recipe", targetHandle: "shared" })).toThrow("exact persisted target URL");
});

test("internal-link validation fails closed without an exact persisted target", () => {
  const proposal = { proposedState: { toArticle: "shared" } } as never;
  expect(() => assertExactInternalLinkDraft(proposal, { suggestedParagraph: '<p><a href="/blogs/news/shared">Shared</a></p>', anchorText: "Shared", targetHandle: "shared" })).toThrow("exact persisted target URL");
});

test("internal-link validation accepts the exact governed target from its strategy candidate", () => {
  const proposal = {
    proposedState: { toArticle: "shared" },
    sourceData: {
      strategyCandidate: {
        type: "internal_link",
        fromUrl: "/blogs/news/source",
        toUrl: "/blogs/news/shared",
      },
    },
  } as never;

  expect(() => assertExactInternalLinkDraft(proposal, {
    suggestedParagraph: '<p><a href="/blogs/news/shared">Shared guide</a></p>',
    anchorText: "Shared guide",
    targetHandle: "shared",
  })).not.toThrow();
});

test("internal-link HTML is constructed deterministically with one exact persisted target", () => {
  const paragraph = buildExactInternalLinkParagraph({
    modelParagraph: '<p>Black rice is nutrient dense. <a href="/wrong">Ignore this link</a></p>',
    anchorText: "black rice benefits",
    targetUrl: "/blogs/news/black-rice-benefits",
  });

  expect(paragraph).toContain('<a href="/blogs/news/black-rice-benefits">black rice benefits</a>');
  expect(paragraph).not.toContain('href="/wrong"');
  expect(paragraph.match(/<a /g)).toHaveLength(1);
});
