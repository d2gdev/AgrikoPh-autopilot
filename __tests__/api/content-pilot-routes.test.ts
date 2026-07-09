import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  getSessionShop: vi.fn(),
}));

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  contentProposal: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
}));

const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockGenerateProposals = vi.hoisted(() => vi.fn());
const mockOpportunityFromProposal = vi.hoisted(() => vi.fn());
const mockUpsertOpportunities = vi.hoisted(() => vi.fn());
const mockMarkTerminal = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  requireAppAuth: mockAuth.requireAppAuth,
  getSessionShop: mockAuth.getSessionShop,
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/content-pilot/generate-proposals", () => ({ generateProposals: mockGenerateProposals }));
vi.mock("@/lib/opportunities/generate", () => ({
  opportunityFromProposal: mockOpportunityFromProposal,
  upsertOpportunities: mockUpsertOpportunities,
}));
vi.mock("@/lib/opportunities/content-proposal-outcomes", () => ({
  markContentProposalOpportunitiesTerminal: mockMarkTerminal,
}));

function proposal(title: string, targetKeyword: string) {
  return {
    articleHandle: null,
    proposalType: "new-content",
    changeType: "new_article",
    priority: "P1",
    impact: "High",
    effort: "Medium",
    title,
    description: `Write ${targetKeyword}.`,
    proposedState: { targetKeyword },
    sourceData: { source: "test", query: targetKeyword },
    priorityScore: 80,
  };
}

describe("Content Pilot route regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.getSessionShop.mockResolvedValue("test-shop");
    mockCheckRateLimit.mockReturnValue(true);
    mockPrisma.$transaction.mockImplementation(async (ops) => Array.isArray(ops) ? Promise.all(ops) : ops(mockPrisma));
    mockPrisma.contentProposal.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.contentProposal.create.mockImplementation(async ({ data }) => ({ id: `proposal-${data.title}`, ...data }));
    mockOpportunityFromProposal.mockImplementation((input) => ({ dedupeKey: input.title, title: input.title }));
    mockUpsertOpportunities.mockImplementation(async (_client, opportunities) => ({ upserted: opportunities.length }));
    mockMarkTerminal.mockResolvedValue({ count: 0 });
  });

  it("only upserts opportunities for proposals that survive active duplicate filtering", async () => {
    const duplicate = proposal("Keyword gap: black rice benefits", "black rice benefits");
    const fresh = proposal("Keyword gap: moringa tea", "moringa tea");
    mockGenerateProposals.mockResolvedValue([duplicate, fresh]);
    mockPrisma.contentProposal.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          articleHandle: null,
          proposalType: "new-content",
          title: "Existing black rice proposal",
          proposedState: { targetKeyword: "black rice benefits" },
        },
      ])
      .mockResolvedValueOnce([]);

    const { POST } = await import("@/app/api/content-pilot/proposals/generate/route");
    const res = await POST(new Request("http://test.local/api/content-pilot/proposals/generate", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ created: 1, opportunities: 1 }));
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Keyword gap: moringa tea",
        proposedState: { targetKeyword: "moringa tea" },
      }),
    });
    expect(mockOpportunityFromProposal).toHaveBeenCalledTimes(1);
    expect(mockOpportunityFromProposal.mock.calls[0]?.[0]).toBe(fresh);
    expect(mockOpportunityFromProposal.mock.calls.map((call) => call[0])).not.toContain(duplicate);
  });

  it("keeps distinct handle-less new-content proposals in the same generation batch", async () => {
    const blackRice = proposal("Keyword gap: black rice benefits", "black rice benefits");
    const moringa = proposal("Keyword gap: moringa tea", "moringa tea");
    mockGenerateProposals.mockResolvedValue([blackRice, moringa]);
    mockPrisma.contentProposal.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { POST } = await import("@/app/api/content-pilot/proposals/generate/route");
    const res = await POST(new Request("http://test.local/api/content-pilot/proposals/generate", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ created: 2, opportunities: 2 }));
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledTimes(2);
    expect(mockOpportunityFromProposal.mock.calls.map((call) => call[0])).toEqual([blackRice, moringa]);
  });

  it("does not recreate rejected proposals as fresh pending ideas", async () => {
    const rejected = proposal("Keyword gap: black rice benefits", "black rice benefits");
    mockGenerateProposals.mockResolvedValue([rejected]);
    const rejectedExisting = {
      id: "rejected-1",
      articleHandle: null,
      proposalType: "new-content",
      title: "Rejected black rice proposal",
      proposedState: { targetKeyword: "black rice benefits" },
      updatedAt: new Date("2026-07-01T00:00:00Z"),
      status: "rejected",
      draftStatus: null,
      sourceData: {},
    };
    mockPrisma.contentProposal.findMany
      .mockResolvedValueOnce([rejectedExisting])
      .mockResolvedValueOnce([rejectedExisting]);

    const { POST } = await import("@/app/api/content-pilot/proposals/generate/route");
    const res = await POST(new Request("http://test.local/api/content-pilot/proposals/generate", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ created: 0, opportunities: 0 }));
    expect(mockPrisma.contentProposal.create).not.toHaveBeenCalled();
    expect(mockOpportunityFromProposal).not.toHaveBeenCalled();
  });
});
