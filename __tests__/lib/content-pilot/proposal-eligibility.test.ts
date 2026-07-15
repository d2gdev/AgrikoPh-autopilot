import { describe, expect, it } from "vitest";
import { contentProposalEligibility } from "@/lib/content-pilot/proposal-eligibility";

describe("contentProposalEligibility", () => {
  it("withholds low-impression new-content proposals from approval", () => {
    expect(contentProposalEligibility({
      proposalType: "new-content",
      title: 'New article opportunity — "ulikan red rice"',
      sourceData: { impressions: 5 },
      proposedState: { targetKeyword: "ulikan red rice" },
    })).toEqual({ actionable: false, reason: "FIRST_PARTY_EVIDENCE_REQUIRED" });
  });

  it("withholds creative-test sentences from article generation", () => {
    expect(contentProposalEligibility({
      proposalType: "new-content",
      title: "Counter-angle: Test a Send message CTA on Turmeric Tea ads",
      sourceData: { insightId: "market-1" },
      proposedState: { targetKeyword: "Test a Send message CTA on Turmeric Tea ads" },
    })).toEqual({ actionable: false, reason: "MARKET_INTELLIGENCE_REVIEW_REQUIRED" });
  });

  it("withholds search-operator artifacts", () => {
    expect(contentProposalEligibility({
      proposalType: "new-content",
      title: 'New article opportunity — "rice -filetype:pdf"',
      sourceData: { impressions: 100 },
      proposedState: { targetKeyword: "rice -filetype:pdf" },
    })).toEqual({ actionable: false, reason: "INVALID_TARGET_KEYWORD" });
  });

  it("withholds ungoverned new articles even when search evidence is sufficient", () => {
    expect(contentProposalEligibility({
      proposalType: "new-content",
      title: 'New article opportunity — "red rice benefits"',
      sourceData: { impressions: 500 },
      proposedState: { targetKeyword: "red rice benefits" },
    })).toEqual({ actionable: false, reason: "TOPICAL_MAP_TARGET_REQUIRED" });
  });

  it("allows a new article that retains its topical-map compliance evidence", () => {
    expect(contentProposalEligibility({
      proposalType: "new-content",
      title: "Red Rice Benefits",
      sourceData: {
        strategyCompliance: {
          result: "compliant",
          packageSha256: "a".repeat(64),
        },
      },
      proposedState: { targetKeyword: "red rice benefits" },
    })).toEqual({ actionable: true });
  });

  it("withholds a proposal bound to an earlier topical map", () => {
    expect(contentProposalEligibility({
      proposalType: "new-content",
      title: "Red Rice Benefits",
      sourceData: { strategyCompliance: { result: "compliant", packageSha256: "a".repeat(64) } },
      proposedState: { targetKeyword: "red rice benefits" },
    }, { activePackageSha256: "b".repeat(64) })).toEqual({ actionable: false, reason: "TOPICAL_MAP_STRATEGY_STALE" });
  });
});
