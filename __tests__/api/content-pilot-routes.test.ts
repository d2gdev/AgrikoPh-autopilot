import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  requirePermission: vi.fn(),
  getSessionShop: vi.fn(),
  getSessionUser: vi.fn(),
}));

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  contentProposal: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  opportunity: {
    updateMany: vi.fn(),
  },
  contentProposalDraftHistory: {
    create: vi.fn(),
  },
}));

const mockProposalTransitions = vi.hoisted(() => ({
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  reopenProposal: vi.fn(),
  editProposalDraft: vi.fn(),
  scheduleProposal: vi.fn(),
}));



const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockGenerateProposals = vi.hoisted(() => vi.fn());
const mockOpportunityFromProposal = vi.hoisted(() => vi.fn());
const mockUpsertOpportunities = vi.hoisted(() => vi.fn());
const mockMarkTerminal = vi.hoisted(() => vi.fn());
const mockFetchBlogArticles = vi.hoisted(() => vi.fn());
const mockGetDraftSchema = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  requireAppAuth: mockAuth.requireAppAuth,
  requirePermission: mockAuth.requirePermission,
  getSessionUser: mockAuth.getSessionUser,
  getSessionShop: mockAuth.getSessionShop,
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/content-pilot/proposal-transitions", () => mockProposalTransitions);
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/content-pilot/generate-proposals", () => ({ generateProposals: mockGenerateProposals }));
vi.mock("@/lib/opportunities/generate", () => ({
  opportunityFromProposal: mockOpportunityFromProposal,
  upsertOpportunities: mockUpsertOpportunities,
}));
vi.mock("@/lib/opportunities/content-proposal-outcomes", () => ({
  markContentProposalOpportunitiesTerminal: mockMarkTerminal,
}));
vi.mock("@/lib/shopify-admin", () => ({
  fetchBlogArticles: mockFetchBlogArticles,
}));
vi.mock("@/lib/content-pilot/generate-draft", () => ({
  getDraftSchema: mockGetDraftSchema,
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
    mockAuth.requirePermission.mockResolvedValue(null);
    mockAuth.getSessionShop.mockResolvedValue("test-shop");
    mockAuth.getSessionUser.mockResolvedValue("operator");
    mockCheckRateLimit.mockReturnValue(true);
    mockPrisma.$transaction.mockImplementation(async (ops) => Array.isArray(ops) ? Promise.all(ops) : ops(mockPrisma));
    mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.contentProposal.count.mockResolvedValue(0);
    mockPrisma.contentProposal.groupBy.mockResolvedValue([]);
    mockPrisma.contentProposal.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.contentProposal.create.mockImplementation(async ({ data }) => ({ id: `proposal-${data.title}`, ...data }));
    mockPrisma.contentProposal.createMany.mockImplementation(async ({ data }) => { const p = await mockPrisma.contentProposal.create({ data: data[0] }); mockPrisma.contentProposal.findUnique.mockResolvedValue(p); return { count: 1 }; });
    mockOpportunityFromProposal.mockImplementation((input) => ({ dedupeKey: input.title, title: input.title }));
    mockUpsertOpportunities.mockImplementation(async (_client, opportunities) => ({ upserted: opportunities.length }));
    mockGetDraftSchema.mockReturnValue({
      safeParse: (value: unknown) => ({ success: true, data: value }),
    });
    mockMarkTerminal.mockResolvedValue({ count: 0 });
    mockFetchBlogArticles.mockResolvedValue([]);

    mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma));
    mockPrisma.contentProposal.findUnique.mockResolvedValue({
      id: "proposal-1",
      status: "approved",
      draftStatus: "ready",
      proposalType: "seo-fix",
      sourceData: {},
      scheduledPublishAt: null,
      draftContent: { title: "before" },
    });
    mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
    mockPrisma.opportunity.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.contentProposalDraftHistory.create.mockResolvedValue({ id: "history-1" });
    mockProposalTransitions.approveProposal.mockResolvedValue({
      proposal: { id: "proposal-1", status: "approved" },
    });
    mockProposalTransitions.rejectProposal.mockResolvedValue({
      proposal: { id: "proposal-1", status: "rejected" },
    });
    mockProposalTransitions.reopenProposal.mockResolvedValue({
      proposal: { id: "proposal-1", status: "pending" },
    });
    mockProposalTransitions.editProposalDraft.mockResolvedValue({
      proposal: { id: "proposal-1", draftContent: { title: "Updated" } },
    });
    mockProposalTransitions.scheduleProposal.mockResolvedValue({
      proposal: { id: "proposal-1", scheduledPublishAt: null },
    });
  });

  it.each([
    ["approve", mockProposalTransitions.approveProposal, "@/app/api/content-pilot/proposals/[id]/approve/route", {
      method: "POST",
      body: JSON.stringify({ reviewNote: "ok" }),
    }],
    ["reject", mockProposalTransitions.rejectProposal, "@/app/api/content-pilot/proposals/[id]/reject/route", {
      method: "POST",
      body: JSON.stringify({ reviewNote: "no" }),
    }],
    ["reopen", mockProposalTransitions.reopenProposal, "@/app/api/content-pilot/proposals/[id]/reopen/route", {
      method: "POST",
      body: "{}",
    }],
  ])("routes %s through transaction callback", async (_name, mockTransition, route, options) => {
    const { POST } = await import(route);
    const response = await POST(
      new Request(`http://test.local/api/content-pilot/proposals/proposal-1/${_name}`, {
        method: options.method,
        body: options.body,
      }),
      { params: Promise.resolve({ id: "proposal-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockTransition).toHaveBeenCalled();
  });

  it("uses transaction for draft edit and schedule transitions", async () => {
    const { PATCH } = await import("@/app/api/content-pilot/proposals/[id]/route");
    const patchRes = await PATCH(
      new Request("http://test.local/api/content-pilot/proposals/proposal-1", {
        method: "PATCH",
        body: JSON.stringify({ draftContent: { title: "updated" } }),
      }),
      { params: Promise.resolve({ id: "proposal-1" }) },
    );

    const { PATCH: schedule } = await import("@/app/api/content-pilot/proposals/[id]/schedule/route");
    const scheduleRes = await schedule(
      new Request("http://test.local/api/content-pilot/proposals/proposal-1/schedule", {
        method: "PATCH",
        body: JSON.stringify({ scheduledPublishAt: null }),
      }),
      { params: Promise.resolve({ id: "proposal-1" }) },
    );

    expect(patchRes.status).toBe(200);
    expect(scheduleRes.status).toBe(200);
    expect(mockProposalTransitions.editProposalDraft).toHaveBeenCalled();
    expect(mockProposalTransitions.scheduleProposal).toHaveBeenCalled();
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("includes sourceData in the proposal list payload so queue rows can explain why they exist", async () => {
    mockPrisma.contentProposal.findMany.mockResolvedValueOnce([
      {
        id: "proposal-1",
        title: "Improve SERP snippet",
        sourceData: { source: "seo-pilot", query: "black rice benefits" },
      },
    ]);

    const { GET } = await import("@/app/api/content-pilot/proposals/route");
    const res = await GET(new Request("http://test.local/api/content-pilot/proposals"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.proposals[0]).toMatchObject({
      id: "proposal-1",
      sourceData: { source: "seo-pilot", query: "black rice benefits" },
    });
    expect(mockPrisma.contentProposal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        sourceData: true,
        publishWarning: true,
        publishOperationId: true,
        publishFinalizedAt: true,
      }),
    }));
  });

  it("maps scheduled queue filtering and counts to ready drafts with a schedule", async () => {
    mockPrisma.contentProposal.findMany.mockResolvedValueOnce([]);
    mockPrisma.contentProposal.groupBy.mockResolvedValueOnce([
      { status: "approved", draftStatus: "ready", scheduledPublishAt: null, _count: { _all: 2 } },
      { status: "approved", draftStatus: "ready", scheduledPublishAt: new Date("2026-08-01T00:00:00Z"), _count: { _all: 3 } },
    ]);

    const { GET } = await import("@/app/api/content-pilot/proposals/route");
    const res = await GET(new Request("http://test.local/api/content-pilot/proposals?stage=scheduled"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockPrisma.contentProposal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["approved", "override_approved"] },
        draftStatus: "ready",
        scheduledPublishAt: { not: null },
      }),
    }));
    expect(mockPrisma.contentProposal.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ["status", "draftStatus", "scheduledPublishAt"],
    }));
    expect(body.stageCounts).toMatchObject({ ready: 2, scheduled: 3 });
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
    expect(mockOpportunityFromProposal.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      title: fresh.title,
      proposedState: fresh.proposedState,
    }));
    expect(mockOpportunityFromProposal.mock.calls.map((call) => call[0])).toHaveLength(1);
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
    expect(mockOpportunityFromProposal.mock.calls.map((call) => call[0].title)).toEqual([blackRice.title, moringa.title]);
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

  it("does not recreate rejected guidelines refresh proposals during refresh-all", async () => {
    mockFetchBlogArticles.mockResolvedValue([
      { handle: "black-rice-benefits", title: "Black Rice Benefits" },
    ]);
    mockPrisma.contentProposal.findMany.mockResolvedValueOnce([
      {
        articleHandle: "black-rice-benefits",
        proposalType: "content-refresh",
        status: "rejected",
      },
    ]);

    const { POST } = await import("@/app/api/content-pilot/proposals/refresh-all/route");
    const res = await POST(new Request("http://test.local/api/content-pilot/proposals/refresh-all", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ created: 0 }));
    expect(mockPrisma.contentProposal.create).not.toHaveBeenCalled();
    expect(mockPrisma.contentProposal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        proposalType: "content-refresh",
        status: expect.objectContaining({
          in: expect.arrayContaining(["rejected"]),
        }),
      }),
    }));
  });
});
