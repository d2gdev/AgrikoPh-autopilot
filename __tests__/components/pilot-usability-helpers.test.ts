import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proposalEvidenceLines } from "@/app/(embedded)/(content-pilot)/content-pilot/components/proposal-evidence";
import { contentGapReason } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/content-gap-reason";
import { trackedKeywordSet } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/types";

describe("pilot usability helper regressions", () => {
  it("normalizes persisted tracked keyword identity", () => {
    expect(trackedKeywordSet([{ keyword: " Black Rice Benefits ", position: null, clicks: 0, impressions: 0, positionDelta: null, status: "tracked", alert: false }])).toEqual(new Set(["black rice benefits"]));
  });
  it("summarizes proposal source evidence from existing sourceData", () => {
    expect(proposalEvidenceLines({
      articleHandle: "black-rice",
      proposalType: "seo-fix",
      proposedState: { targetQuery: "black rice benefits" },
      sourceData: {
        source: "seo-pilot",
        impressions: 1200,
        position: 8.25,
        organicPriority: { score: 87.4 },
      },
    })).toEqual([
      "Source: seo pilot",
      "Target: black rice benefits",
      "Score: 87",
      "Impressions: 1,200",
      "Avg position: 8.3",
      "Article: black-rice",
    ]);
  });

  it("explains SEO content gaps without requiring the operator to infer the source", () => {
    expect(contentGapReason({
      query: "moringa tea philippines",
      impressions: 640,
      position: 12.3,
      suggestedTitle: "Moringa Tea in the Philippines",
    })).toBe("Uncovered GSC query with 640 impressions at avg position 12.3.");

    expect(contentGapReason({
      query: "black rice",
      impressions: 0,
      position: 0,
      suggestedTitle: "Black Rice",
      issue: "thin-content",
      articleHandle: "black-rice",
      wordCount: 190,
    })).toBe("Existing article black-rice is thin (190 words).");
  });

  it("keeps clean-queue copy explicit about not recreating finished ideas", () => {
    const queueSource = readFileSync("app/(embedded)/(content-pilot)/content-pilot/components/QueueTab.tsx", "utf8");

    expect(queueSource).toContain("finished ideas are being respected instead of recreated");
    expect(queueSource).toContain("Finished or rejected ideas stay out of the queue unless you re-open them");
  });

  it("keeps reject actions available before publishing", () => {
    const rowSource = readFileSync("app/(embedded)/(content-pilot)/content-pilot/components/queue/ProposalRow.tsx", "utf8");
    const draftSource = readFileSync("app/(embedded)/(content-pilot)/content-pilot/draft/[id]/page.tsx", "utf8");

    expect(rowSource).toContain("canRejectContentProposal");
    expect(rowSource).toContain("<RejectButton />");
    expect(rowSource).toContain("{canReject && isRejectFormOpen &&");
    expect(draftSource).toContain("canRejectContentProposal");
    expect(draftSource).toContain("Reject proposal");
    expect(draftSource).toContain("Confirm Reject");
  });
});
