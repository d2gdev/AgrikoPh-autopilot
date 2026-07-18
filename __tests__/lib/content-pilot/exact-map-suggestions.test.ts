import { describe, expect, it } from "vitest";
import {
  filterExactMapProposals,
  type ExactMapCommandCenter,
} from "@/lib/content-pilot/exact-map-suggestions";
import type { ProposalInput } from "@/lib/content-pilot/generate-proposals";

const identity = {
  versionId: "strategy-1",
  strategyVersion: "2026-07-18",
  contractRevision: "5",
  packageSha256: "a".repeat(64),
  activatedAt: "2026-07-18T00:00:00.000Z",
};

function policy(resolutionStatus: "resolved" | "manual_gate" = "resolved") {
  return { resolutionStatus, conditions: [], evidenceRequirements: [], reviewRequirements: [] };
}

function commandCenter(
  pages: ExactMapCommandCenter["pages"],
  internalLinks: ExactMapCommandCenter["work"]["internalLinks"] = [],
): ExactMapCommandCenter {
  return { identity, pages, prohibited: [], work: { internalLinks } };
}

function proposal(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    articleHandle: "rice-guide",
    proposalType: "content-refresh",
    changeType: "update",
    priority: "P1",
    impact: "high",
    effort: "medium",
    title: "Refresh rice guide",
    description: "Refresh the mapped owner.",
    proposedState: {},
    sourceData: {
      strategyCandidate: {
        type: "content",
        action: "update",
        targetUrl: "/blogs/news/rice-guide",
      },
    },
    priorityScore: 80,
    ...overrides,
  };
}

describe("filterExactMapProposals", () => {
  it("keeps an exact mapped refresh and attaches immutable map context", () => {
    const result = filterExactMapProposals([
      proposal(),
    ], commandCenter([{
      url: "/blogs/news/rice-guide",
      title: "Rice Guide",
      decision: "keep; refresh and strengthen",
      priority: "P1",
      primaryKeywordOrTheme: "organic rice guide",
      ruleIds: ["page-role-1", "content-rule-1"],
      ruleDomains: { content_decisions: ["content-rule-1"] },
      contentDecisionPolicy: policy(),
    }]));

    expect(result).toEqual([
      expect.objectContaining({
        sourceData: expect.objectContaining({
          strategyVersionId: "strategy-1",
          packageSha256: "a".repeat(64),
          targetUrl: "/blogs/news/rice-guide",
          ruleIds: ["content-rule-1"],
          mapTitle: "Rice Guide",
          mapDecision: "keep; refresh and strengthen",
          targetKeyword: "organic rice guide",
        }),
      }),
    ]);
  });

  it("drops a generic new article without an exact mapped URL", () => {
    const generic = proposal({
      articleHandle: null,
      proposalType: "new-content",
      sourceData: { strategyCandidate: null, query: "generic rice idea" },
    });

    expect(filterExactMapProposals([generic], commandCenter([]))).toEqual([]);
  });

  it("drops exact targets behind a manual gate", () => {
    const map = commandCenter([{
      url: "/blogs/news/rice-guide",
      decision: "refresh after review",
      ruleIds: ["content-rule-1"],
      ruleDomains: { content_decisions: ["content-rule-1"] },
      contentDecisionPolicy: policy("manual_gate"),
    }]);

    expect(filterExactMapProposals([proposal()], map)).toEqual([]);
  });

  it("drops keep-only pages because the decision does not authorize a change", () => {
    const map = commandCenter([{
      url: "/blogs/news/rice-guide",
      decision: "keep",
      ruleIds: ["content-rule-1"],
      ruleDomains: { content_decisions: ["content-rule-1"] },
      contentDecisionPolicy: policy(),
    }]);

    expect(filterExactMapProposals([proposal()], map)).toEqual([]);
  });

  it("keeps only exact additive internal-link instructions", () => {
    const linkProposal = proposal({
      articleHandle: "rice-guide",
      proposalType: "internal-link",
      changeType: "internal_link",
      sourceData: {
        strategyCandidate: {
          type: "internal_link",
          fromUrl: "/blogs/news/rice-guide",
          toUrl: "/products/organic-rice",
        },
      },
    });
    const map = commandCenter([], [{
      fromUrl: "/blogs/news/rice-guide",
      toUrl: "/products/organic-rice",
      requiredAction: "ensure commercial link",
      ruleIds: ["link-rule-1"],
      policy: policy(),
    }]);

    expect(filterExactMapProposals([linkProposal], map)).toHaveLength(1);
    expect(filterExactMapProposals([
      linkProposal,
    ], commandCenter([], [{
      fromUrl: "/blogs/news/rice-guide",
      toUrl: "/products/organic-rice",
      requiredAction: "retain",
      ruleIds: ["link-rule-1"],
      policy: policy(),
    }]))).toEqual([]);
  });
});
