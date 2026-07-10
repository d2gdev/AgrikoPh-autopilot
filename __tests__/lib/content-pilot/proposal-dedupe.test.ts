import { describe, expect, it } from "vitest";
import {
  CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES,
  CONTENT_PROPOSAL_REPLACEMENT_BLOCKING_STATUSES,
  contentProposalDedupeKey,
  filterBlockedContentProposalInputs,
  uniqueContentProposalInputs,
} from "@/lib/content-pilot/proposal-dedupe";

describe("content proposal dedupe", () => {
  it("uses target keyword/title for handle-less new-content proposals", () => {
    const a = contentProposalDedupeKey({
      articleHandle: null,
      proposalType: "new-content",
      title: "Keyword gap: black rice benefits",
      proposedState: { targetKeyword: "black rice benefits" },
    });
    const b = contentProposalDedupeKey({
      articleHandle: null,
      proposalType: "new-content",
      title: "Keyword gap: moringa tea",
      proposedState: { targetKeyword: "moringa tea" },
    });

    expect(a).not.toBe(b);
  });

  it("dedupes repeated handle-less proposals without collapsing unrelated topics", () => {
    const result = uniqueContentProposalInputs([
      {
        articleHandle: null,
        proposalType: "new-content",
        title: "Keyword gap: black rice benefits",
        proposedState: { targetKeyword: "black rice benefits" },
      },
      {
        articleHandle: null,
        proposalType: "new-content",
        title: "Keyword gap: Black Rice Benefits",
        proposedState: { targetKeyword: "  Black   Rice Benefits " },
      },
      {
        articleHandle: null,
        proposalType: "new-content",
        title: "Keyword gap: moringa tea",
        proposedState: { targetKeyword: "moringa tea" },
      },
    ]);

    expect(result.map((p) => p.title)).toEqual([
      "Keyword gap: black rice benefits",
      "Keyword gap: moringa tea",
    ]);
  });

  it("filters only proposals blocked by existing active logical keys", async () => {
    const prisma = {
      contentProposal: {
        findMany: async () => [
          {
            articleHandle: null,
            proposalType: "new-content",
            title: "Existing black rice proposal",
            proposedState: { targetKeyword: "black rice benefits" },
          },
        ],
      },
    };

    const fresh = await filterBlockedContentProposalInputs(prisma, [
      {
        articleHandle: null,
        proposalType: "new-content",
        title: "Keyword gap: black rice benefits",
        proposedState: { targetKeyword: "black rice benefits" },
      },
      {
        articleHandle: null,
        proposalType: "new-content",
        title: "Keyword gap: moringa tea",
        proposedState: { targetKeyword: "moringa tea" },
      },
    ]);

    expect(fresh.map((p) => p.title)).toEqual(["Keyword gap: moringa tea"]);
  });

  it("treats rejected proposals as finished ideas that block regeneration", () => {
    expect(CONTENT_PROPOSAL_REPLACEMENT_BLOCKING_STATUSES).toContain("rejected");
    expect(CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES).toEqual(
      expect.arrayContaining(["pending", "approved", "override_approved", "published", "rejected"]),
    );
  });

  it("keeps internal-link proposals with different destination articles distinct", () => {
    const toArticleB = contentProposalDedupeKey({
      articleHandle: "source-article",
      proposalType: "internal-link",
      title: "Link source to article B",
      proposedState: { fromArticle: "source-article", toArticle: "article-b" },
    });
    const toArticleC = contentProposalDedupeKey({
      articleHandle: "source-article",
      proposalType: "internal-link",
      title: "Link source to article C",
      proposedState: { fromArticle: "source-article", toArticle: "article-c" },
    });

    expect(toArticleB).not.toBe(toArticleC);
  });

  it("keeps different SEO issues on the same article distinct", () => {
    const missingMeta = contentProposalDedupeKey({
      articleHandle: "black-rice-benefits",
      proposalType: "seo-fix",
      title: "Improve the SERP snippet",
      proposedState: { targetQuery: "black rice benefits", issue: "missing-meta" },
    });
    const missingHeading = contentProposalDedupeKey({
      articleHandle: "black-rice-benefits",
      proposalType: "seo-fix",
      title: "Add a clear heading",
      proposedState: { targetQuery: "black rice benefits", issue: "missing-h1" },
    });

    expect(missingMeta).not.toBe(missingHeading);
  });

  it("dedupes reworded SEO proposals with the same structured action", () => {
    const original = contentProposalDedupeKey({
      articleHandle: "black-rice-benefits",
      proposalType: "seo-fix",
      title: "Improve the SERP snippet",
      proposedState: { targetQuery: "black rice benefits", issue: "missing-meta" },
    });
    const reworded = contentProposalDedupeKey({
      articleHandle: "black-rice-benefits",
      proposalType: "seo-fix",
      title: "Rewrite metadata for stronger CTR",
      proposedState: { targetQuery: "  Black   Rice Benefits ", issue: "missing-meta" },
    });

    expect(reworded).toBe(original);
  });
});
