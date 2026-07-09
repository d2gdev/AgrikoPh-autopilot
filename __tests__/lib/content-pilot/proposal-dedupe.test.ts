import { describe, expect, it } from "vitest";
import {
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
});
