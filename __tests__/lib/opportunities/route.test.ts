import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  contentProposalFromOpportunity,
  routeOpportunityToContentProposal,
  shouldRouteOpportunityToContentProposal,
} from "@/lib/opportunities/route";

function opportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: "opp-1",
    type: "ctr_gap",
    targetType: "article",
    targetId: "organic-rice-guide",
    targetUrl: "/blogs/news/organic-rice-guide",
    targetName: "Organic rice guide",
    source: "content-pilot",
    score: 84,
    priority: "P0",
    impact: "High",
    effort: "Low",
    evidence: { query: "organic rice", impressions: 300 },
    proposedAction: {
      title: "GSC quick win - optimise for organic rice",
      description: "Rewrite title and meta.",
      articleHandle: "organic-rice-guide",
      proposalType: "content-refresh",
      changeType: "metadata",
      proposedState: { targetQuery: "organic rice" },
    },
    status: "open",
    ...overrides,
  };
}

const mockPrisma = {
  contentProposal: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  opportunity: {
    update: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.contentProposal.findFirst.mockResolvedValue(null);
  mockPrisma.contentProposal.create.mockResolvedValue({ id: "proposal-1" });
  mockPrisma.opportunity.update.mockResolvedValue({});
});

describe("shouldRouteOpportunityToContentProposal", () => {
  it("routes article and content opportunity types", () => {
    expect(shouldRouteOpportunityToContentProposal({ type: "ctr_gap", targetType: "article" })).toBe(true);
    expect(shouldRouteOpportunityToContentProposal({ type: "content_gap", targetType: "keyword" })).toBe(true);
    expect(shouldRouteOpportunityToContentProposal({ type: "competitor_ad_change", targetType: "competitor_ad" })).toBe(false);
  });
});

describe("contentProposalFromOpportunity", () => {
  it("maps content opportunities into proposal data", () => {
    const proposal = contentProposalFromOpportunity(opportunity());

    expect(proposal).toMatchObject({
      articleHandle: "organic-rice-guide",
      proposalType: "content-refresh",
      changeType: "metadata",
      priority: "P1",
      impact: "High",
      effort: "Low",
      title: "GSC quick win - optimise for organic rice",
    });
    expect(proposal?.sourceData).toMatchObject({
      opportunityId: "opp-1",
      opportunityType: "ctr_gap",
      score: 84,
    });
  });

  it("maps P0 opportunities down to P1 proposals for existing UI behavior", () => {
    const proposal = contentProposalFromOpportunity(opportunity({ priority: "P0" }));

    expect(proposal?.priority).toBe("P1");
  });

  it("lifts organicPriority to top-level sourceData while preserving evidence", () => {
    const proposal = contentProposalFromOpportunity(opportunity({
      evidence: {
        query: "organic rice",
        organicPriority: { priority: "P0", score: 96, impact: "High", effort: "Low" },
      },
    }));

    expect(proposal?.sourceData).toMatchObject({
      organicPriority: { priority: "P0", score: 96, impact: "High", effort: "Low" },
      evidence: {
        query: "organic rice",
        organicPriority: { priority: "P0", score: 96, impact: "High", effort: "Low" },
      },
    });
  });

  it("returns null for store opportunities", () => {
    expect(contentProposalFromOpportunity(opportunity({ type: "competitor_price_change", targetType: "competitor_product" }))).toBeNull();
  });
});

describe("routeOpportunityToContentProposal", () => {
  it("creates a proposal and marks the opportunity as routed", async () => {
    const result = await routeOpportunityToContentProposal(mockPrisma as any, opportunity());

    expect(result).toEqual({
      opportunityId: "opp-1",
      routed: true,
      routedToType: "ContentProposal",
      routedToId: "proposal-1",
    });
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        articleHandle: "organic-rice-guide",
        proposalType: "content-refresh",
      }),
    });
    expect(mockPrisma.opportunity.update).toHaveBeenCalledWith({
      where: { id: "opp-1" },
      data: {
        status: "routed",
        routedToType: "ContentProposal",
        routedToId: "proposal-1",
      },
    });
  });

  it("reuses an existing active proposal", async () => {
    mockPrisma.contentProposal.findFirst.mockResolvedValue({ id: "existing-proposal" });

    const result = await routeOpportunityToContentProposal(mockPrisma as any, opportunity());

    expect(result.routedToId).toBe("existing-proposal");
    expect(mockPrisma.contentProposal.create).not.toHaveBeenCalled();
  });
});
