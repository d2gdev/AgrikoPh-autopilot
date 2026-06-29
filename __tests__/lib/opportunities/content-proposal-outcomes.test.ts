import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  markContentProposalOpportunityDismissed,
  markContentProposalOpportunityResolved,
  markContentProposalOpportunityRouted,
  markContentProposalOpportunitiesTerminal,
  opportunityWhereForContentProposal,
  terminalOpportunityStatusForContentProposal,
} from "@/lib/opportunities/content-proposal-outcomes";

const mockPrisma = {
  opportunity: {
    updateMany: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.opportunity.updateMany.mockResolvedValue({ count: 1 });
});

describe("opportunityWhereForContentProposal", () => {
  it("matches routed opportunities and sourceData opportunity ids", () => {
    expect(opportunityWhereForContentProposal({
      proposalId: "proposal-1",
      sourceData: { opportunityId: "opp-1" },
    })).toEqual({
      OR: [
        { routedToType: "ContentProposal", routedToId: "proposal-1" },
        { id: "opp-1" },
      ],
    });
  });

  it("matches only routed target when no sourceData opportunity id exists", () => {
    expect(opportunityWhereForContentProposal({
      proposalId: "proposal-1",
      sourceData: {},
    })).toEqual({
      OR: [
        { routedToType: "ContentProposal", routedToId: "proposal-1" },
      ],
    });
  });
});

describe("content proposal opportunity outcomes", () => {
  it("classifies published proposals as resolved and everything else as dismissed", () => {
    expect(terminalOpportunityStatusForContentProposal({ draftStatus: "published" })).toBe("resolved");
    expect(terminalOpportunityStatusForContentProposal({ draftStatus: "failed" })).toBe("dismissed");
    expect(terminalOpportunityStatusForContentProposal({ status: "rejected" })).toBe("dismissed");
    expect(terminalOpportunityStatusForContentProposal({ status: "pending", draftStatus: null })).toBe("dismissed");
  });

  it("marks deleted proposal routes terminal before proposal deletion", async () => {
    mockPrisma.opportunity.updateMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 3 });

    const result = await markContentProposalOpportunitiesTerminal(mockPrisma as any, [
      { id: "published-proposal", draftStatus: "published", sourceData: { opportunityId: "opp-1" } },
      { id: "failed-proposal", draftStatus: "failed" },
    ]);

    expect(result).toEqual({ resolved: 2, dismissed: 3 });
    expect(mockPrisma.opportunity.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        status: "resolved",
        routedToId: "published-proposal",
      }),
    }));
    expect(mockPrisma.opportunity.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        status: "dismissed",
        routedToId: "failed-proposal",
      }),
    }));
  });

  it("marks rejected proposal opportunities dismissed", async () => {
    await markContentProposalOpportunityDismissed(mockPrisma as any, {
      proposalId: "proposal-1",
      sourceData: { opportunityId: "opp-1" },
    });

    expect(mockPrisma.opportunity.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ OR: expect.any(Array) }),
      data: expect.objectContaining({
        status: "dismissed",
        routedToType: "ContentProposal",
        routedToId: "proposal-1",
        resolvedAt: expect.any(Date),
      }),
    });
  });

  it("marks published proposal opportunities resolved", async () => {
    await markContentProposalOpportunityResolved(mockPrisma as any, {
      proposalId: "proposal-1",
      sourceData: { opportunityId: "opp-1" },
    });

    expect(mockPrisma.opportunity.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ OR: expect.any(Array) }),
      data: expect.objectContaining({
        status: "resolved",
        routedToType: "ContentProposal",
        routedToId: "proposal-1",
        resolvedAt: expect.any(Date),
      }),
    });
  });

  it("marks reopened proposal opportunities routed", async () => {
    await markContentProposalOpportunityRouted(mockPrisma as any, {
      proposalId: "proposal-1",
      sourceData: { opportunityId: "opp-1" },
    });

    expect(mockPrisma.opportunity.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ OR: expect.any(Array) }),
      data: {
        status: "routed",
        resolvedAt: null,
        routedToType: "ContentProposal",
        routedToId: "proposal-1",
      },
    });
  });
});
