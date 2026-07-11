import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proposalEvidenceLines } from "@/app/(embedded)/(content-pilot)/content-pilot/components/proposal-evidence";
import { contentGapReason } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/content-gap-reason";
import { onPageHealthActions } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/on-page-health-actions";
import { analysisCompletionToast, mergeTrackedKeywordPlaceholder, trackedKeywordSet } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/types";

describe("pilot usability helper regressions", () => {
  it("does not call a partial analysis complete", () => {
    expect(analysisCompletionToast({ aiStatus: "partial", contentGaps: [{ query: "rice", impressions: 1, position: 8, suggestedTitle: "Rice guide" }] })).toMatch(/partial/i);
    expect(analysisCompletionToast({ aiStatus: "complete", contentGaps: [] })).toBe("Analysis complete — no content gaps found with current data.");
  });

  it("keeps a successfully added keyword visible when report reload fails", () => {
    expect(mergeTrackedKeywordPlaceholder([], " Black Rice ")).toEqual([{ keyword: "black rice", position: null, clicks: 0, impressions: 0, positionDelta: null, status: "tracked", alert: false }]);
    expect(mergeTrackedKeywordPlaceholder([{ keyword: "black rice", position: 2, clicks: 1, impressions: 4, positionDelta: null, status: "tracked", alert: false }], "black rice")).toHaveLength(1);
  });

  it("keeps compact Opportunities and Keywords sorting controlled by page state", () => {
    const pageSource = readFileSync("app/(embedded)/(seo-pillar)/seo-pillar/page.tsx", "utf8");
    const opportunitiesSource = readFileSync("app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OpportunitiesPanel.tsx", "utf8");
    const keywordsSource = readFileSync("app/(embedded)/(seo-pillar)/seo-pillar/components/panels/KeywordsPanel.tsx", "utf8");
    expect(pageSource).toContain("oppSort={oppSort}");
    expect(opportunitiesSource).toContain("compactSortIndex={oppSort?.index ?? -1}");
    expect(keywordsSource).toContain("compactSortIndex={kwSort?.index ?? -1}");
  });

  it("classifies supported fixes and diagnostic-only on-page health findings", () => {
    expect(onPageHealthActions(["Title length off", "Description length off"])).toEqual({ meta: true, h1: false, thin: false, manual: false });
    expect(onPageHealthActions(["No internal links", "Few headings", "Orphan (no inbound links)"])).toEqual({ meta: false, h1: false, thin: false, manual: true });
    expect(onPageHealthActions(["Thin content", "Duplicate title"])).toEqual({ meta: false, h1: false, thin: true, manual: true });
    const panelSource = readFileSync("app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OnPageHealthPanel.tsx", "utf8");
    expect(panelSource).toContain("onPageHealthActions");
    expect(panelSource).toContain("Manual review");
  });

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
    const queueSource = readFileSync("app/(embedded)/(content-pilot)/content-pilot/components/QueueTab.tsx", "utf8");

    expect(rowSource).toContain("canRejectContentProposal");
    expect(rowSource).toContain("<RejectButton />");
    expect(rowSource).toContain("{canReject && isRejectFormOpen &&");
    expect(draftSource).toContain("canRejectContentProposal");
    expect(draftSource).toContain("Reject proposal");
    expect(draftSource).toContain("Confirm Reject");
    expect(queueSource).toContain("canRejectContentProposal");
    expect(queueSource).toContain("const bulkReject = async () =>");
    expect(queueSource).toContain("return proposal ? canRejectContentProposal(proposal) : false;");
  });

  it("shows blog-loading failures and incomplete published bookkeeping", () => {
    const briefSource = readFileSync("app/(embedded)/(content-pilot)/content-pilot/components/BriefTab.tsx", "utf8");
    const draftSource = readFileSync("app/(embedded)/(content-pilot)/content-pilot/draft/[id]/page.tsx", "utf8");

    expect(briefSource).toContain("blogsError");
    expect(briefSource).toContain("Shopify blogs could not be loaded");
    expect(draftSource).toContain('title="Bookkeeping incomplete"');
    expect(draftSource).toContain("Retry bookkeeping");
  });

  it("prevents older overview loads from replacing a newer refresh", () => {
    const source = readFileSync("app/(embedded)/(content-pilot)/content-pilot/page.tsx", "utf8");

    expect(source).toContain("createLatestRequestCoordinator");
    expect(source).toContain("overviewRequestsRef.current.isCurrent(request)");
  });
});
