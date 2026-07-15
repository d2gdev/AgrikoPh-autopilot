import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
}));

const mockPrisma = vi.hoisted(() => ({
  storeTask: { findMany: vi.fn() },
  contentProposal: { findMany: vi.fn() },
  recommendation: { findMany: vi.fn() },
  opportunity: { findMany: vi.fn() },
  marketInsight: { findMany: vi.fn() },
  rawSnapshot: { findFirst: vi.fn() },
  gscQuery: { findFirst: vi.fn() },
  pageAnalytics: { findFirst: vi.fn() },
  jobRun: { findFirst: vi.fn() },
}));

const mockJobsStatus = vi.hoisted(() => ({
  getJobsStatusPayload: vi.fn(),
}));

const mockShopifyAdmin = vi.hoisted(() => ({
  fetchProductImages: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAppAuth: mockAuth.requireAppAuth,
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/dashboard/jobs-status", () => ({
  getJobsStatusPayload: mockJobsStatus.getJobsStatusPayload,
}));
vi.mock("@/lib/shopify-admin", () => ({
  fetchProductImages: mockShopifyAdmin.fetchProductImages,
}));

function request(query = "") {
  return new Request(`http://test.local/api/growth-brief${query}`) as NextRequest;
}

describe("growth-brief route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockJobsStatus.getJobsStatusPayload.mockResolvedValue({
      perJobHealth: [],
    });
    mockPrisma.storeTask.findMany.mockResolvedValue([]);
    mockPrisma.contentProposal.findMany.mockResolvedValue([]);
    mockPrisma.recommendation.findMany.mockResolvedValue([]);
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    mockPrisma.marketInsight.findMany.mockResolvedValue([]);
    mockPrisma.rawSnapshot.findFirst.mockResolvedValue(null);
    mockPrisma.gscQuery.findFirst.mockResolvedValue(null);
    mockPrisma.pageAnalytics.findFirst.mockResolvedValue(null);
    mockPrisma.jobRun.findFirst.mockResolvedValue(null);
    mockShopifyAdmin.fetchProductImages.mockResolvedValue([]);
  });

  it("bypasses the cached brief when the operator explicitly refreshes", async () => {
    const { GET } = await import("@/app/api/growth-brief/route");

    await GET(request());
    await GET(request("?refresh=1"));

    expect(mockPrisma.rawSnapshot.findFirst).toHaveBeenCalledTimes(2);
  });

  it("does not coalesce an explicit refresh into an in-flight cached read", async () => {
    let resolveInitialRead!: (value: null) => void;
    const initialRead = new Promise<null>((resolve) => { resolveInitialRead = resolve; });
    mockPrisma.rawSnapshot.findFirst
      .mockImplementationOnce(() => initialRead)
      .mockResolvedValue(null);
    const { GET } = await import("@/app/api/growth-brief/route");

    const initial = GET(request());
    await vi.waitFor(() => expect(mockPrisma.rawSnapshot.findFirst).toHaveBeenCalledTimes(1));
    const refresh = GET(request("?refresh=1"));

    await vi.waitFor(() => expect(mockPrisma.rawSnapshot.findFirst).toHaveBeenCalledTimes(2));
    resolveInitialRead(null);
    await Promise.all([initial, refresh]);
  });

  it("overfetches proposal and opportunity queues before trimming to the top operator-facing items", async () => {
    const proposalPool = [
      {
        id: "proposal-1",
        title: "Proposal 1",
        description: "First proposal",
        priority: "P2",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: { organicPriority: { priority: "P2", score: 10, impact: "Low", effort: "Low" } },
      },
      {
        id: "proposal-2",
        title: "Proposal 2",
        description: "Second proposal",
        priority: "P2",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: { organicPriority: { priority: "P2", score: 20, impact: "Low", effort: "Low" } },
      },
      {
        id: "proposal-3",
        title: "Proposal 3",
        description: "Third proposal",
        priority: "P2",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: { organicPriority: { priority: "P2", score: 30, impact: "Low", effort: "Low" } },
      },
      {
        id: "proposal-4",
        title: "Proposal 4",
        description: "Fourth proposal",
        priority: "P2",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: { organicPriority: { priority: "P2", score: 40, impact: "Low", effort: "Low" } },
      },
      {
        id: "proposal-5",
        title: "Proposal 5",
        description: "Fifth proposal",
        priority: "P2",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: { organicPriority: { priority: "P2", score: 50, impact: "Low", effort: "Low" } },
      },
      {
        id: "proposal-6",
        title: "Proposal 6",
        description: "Sixth proposal",
        priority: "P2",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: { organicPriority: { priority: "P2", score: 60, impact: "Low", effort: "Low" } },
      },
      {
        id: "proposal-7",
        title: "Proposal 7",
        description: "Seventh proposal",
        priority: "P2",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: { organicPriority: { priority: "P2", score: 70, impact: "Low", effort: "Low" } },
      },
      {
        id: "proposal-8",
        title: "Proposal 8",
        description: "Eighth proposal",
        priority: "P2",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: { organicPriority: { priority: "P2", score: 80, impact: "Low", effort: "Low" } },
      },
      {
        id: "proposal-top",
        title: "Proposal top",
        description: "Should be pulled into the queue after overfetch",
        priority: "P1",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: { organicPriority: { priority: "P1", score: 65, impact: "High", effort: "Low" } },
      },
    ];
    const opportunityPool = [
      {
        id: "opp-1",
        status: "open",
        type: "content_gap",
        targetType: "keyword",
        targetName: "Opportunity 1",
        source: "content-pilot",
        score: 10,
        priority: "P2",
        impact: "Low",
        effort: "Low",
        proposedAction: { title: "Opportunity 1", description: "First opportunity" },
      },
      {
        id: "opp-2",
        status: "open",
        type: "content_gap",
        targetType: "keyword",
        targetName: "Opportunity 2",
        source: "content-pilot",
        score: 20,
        priority: "P2",
        impact: "Low",
        effort: "Low",
        proposedAction: { title: "Opportunity 2", description: "Second opportunity" },
      },
      {
        id: "opp-3",
        status: "open",
        type: "content_gap",
        targetType: "keyword",
        targetName: "Opportunity 3",
        source: "content-pilot",
        score: 30,
        priority: "P2",
        impact: "Low",
        effort: "Low",
        proposedAction: { title: "Opportunity 3", description: "Third opportunity" },
      },
      {
        id: "opp-4",
        status: "open",
        type: "content_gap",
        targetType: "keyword",
        targetName: "Opportunity 4",
        source: "content-pilot",
        score: 40,
        priority: "P2",
        impact: "Low",
        effort: "Low",
        proposedAction: { title: "Opportunity 4", description: "Fourth opportunity" },
      },
      {
        id: "opp-5",
        status: "open",
        type: "content_gap",
        targetType: "keyword",
        targetName: "Opportunity 5",
        source: "content-pilot",
        score: 50,
        priority: "P2",
        impact: "Low",
        effort: "Low",
        proposedAction: { title: "Opportunity 5", description: "Fifth opportunity" },
      },
      {
        id: "opp-6",
        status: "open",
        type: "content_gap",
        targetType: "keyword",
        targetName: "Opportunity 6",
        source: "content-pilot",
        score: 60,
        priority: "P2",
        impact: "Low",
        effort: "Low",
        proposedAction: { title: "Opportunity 6", description: "Sixth opportunity" },
      },
      {
        id: "opp-7",
        status: "open",
        type: "content_gap",
        targetType: "keyword",
        targetName: "Opportunity 7",
        source: "content-pilot",
        score: 70,
        priority: "P2",
        impact: "Low",
        effort: "Low",
        proposedAction: { title: "Opportunity 7", description: "Seventh opportunity" },
      },
      {
        id: "opp-8",
        status: "open",
        type: "content_gap",
        targetType: "keyword",
        targetName: "Opportunity 8",
        source: "content-pilot",
        score: 80,
        priority: "P2",
        impact: "Low",
        effort: "Low",
        proposedAction: { title: "Opportunity 8", description: "Eighth opportunity" },
      },
      {
        id: "opp-top",
        status: "open",
        type: "content_gap",
        targetType: "keyword",
        targetName: "Opportunity top",
        source: "content-pilot",
        score: 35,
        priority: "P1",
        impact: "High",
        effort: "Low",
        proposedAction: { title: "Opportunity top", description: "Should be pulled into the queue after overfetch" },
      },
    ];

    mockPrisma.contentProposal.findMany.mockImplementation(async ({ take }: { take: number }) => proposalPool.slice(0, take));
    mockPrisma.opportunity.findMany.mockImplementation(async ({ take }: { take: number }) => opportunityPool.slice(0, take));

    const { GET } = await import("@/app/api/growth-brief/route");

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sections.readyToApprove[0].id).toBe("content:proposal-top");
    expect(body.sections.quickWins[0].id).toBe("opportunity:opp-top");
    expect(mockPrisma.contentProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: expect.any(Number) }),
    );
    expect(mockPrisma.opportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: expect.any(Number) }),
    );
    expect(mockPrisma.contentProposal.findMany.mock.calls[0]?.[0]?.take).toBeGreaterThan(8);
    expect(mockPrisma.opportunity.findMany.mock.calls[0]?.[0]?.take).toBeGreaterThan(8);
  });

  it("orders organic proposals by preserved scorer priority before score within the queue", async () => {
    mockPrisma.contentProposal.findMany.mockResolvedValue([
      {
        id: "proposal-clamped-p1",
        title: "Clamped P1 proposal",
        description: "Higher score but lower preserved band",
        priority: "P1",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: {
          organicPriority: {
            priority: "P1",
            score: 99,
            impact: "High",
            effort: "Low",
          },
        },
      },
      {
        id: "proposal-preserved-p0",
        title: "Preserved P0 proposal",
        description: "Should outrank the clamped P1 item",
        priority: "P1",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: {
          organicPriority: {
            priority: "P0",
            score: 81,
            impact: "High",
            effort: "Low",
          },
        },
      },
    ]);

    const { GET } = await import("@/app/api/growth-brief/route");

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sections.readyToApprove.map((item: { id: string }) => item.id)).toEqual([
      "content:proposal-preserved-p0",
      "content:proposal-clamped-p1",
    ]);
  });

  it("keeps low-evidence and competitor-angle content proposals out of Ready to Approve", async () => {
    mockPrisma.contentProposal.findMany.mockResolvedValue([
      {
        id: "low-gsc-gap",
        title: 'New article opportunity — "five impressions"',
        description: "Low evidence proposal",
        priority: "P2",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: { query: "five impressions", impressions: 5 },
      },
      {
        id: "competitor-angle",
        title: "Counter-angle: unverified ad idea",
        description: "Competitor-derived proposal",
        priority: "P2",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: { insightId: "competitor-insight" },
      },
      {
        id: "gsc-backed",
        title: 'New article opportunity — "organic rice philippines"',
        description: "Sufficient first-party evidence",
        priority: "P2",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: { query: "organic rice philippines", impressions: 120 },
      },
    ]);

    const { GET } = await import("@/app/api/growth-brief/route");

    const body = await (await GET(request())).json();

    expect(body.sections.readyToApprove.map((item: { id: string }) => item.id)).toEqual(["content:gsc-backed"]);
    expect(body.sections.needsAttention.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([
      "content-review:low-gsc-gap",
      "content-review:competitor-angle",
    ]));
    expect(body.sections.needsAttention.map((item: { description: string }) => item.description)).toEqual(expect.arrayContaining([
      expect.stringMatching(/cannot be approved/i),
    ]));
  });

  it("keeps a low-evidence content opportunity out of Quick Wins", async () => {
    mockPrisma.opportunity.findMany.mockResolvedValue([{ id: "low-gap", type: "content_gap", targetType: "keyword", targetName: "ulikan red rice", source: "content-pilot", priority: "P2", score: 36, impact: "Medium", effort: "Medium", evidence: { impressions: 5 }, proposedAction: { title: "Ulikan red rice", description: "Low-evidence gap" } }]);
    const { GET } = await import("@/app/api/growth-brief/route");
    const body = await (await GET(request())).json();
    expect(body.sections.quickWins.map((item: { id: string }) => item.id)).not.toContain("opportunity:low-gap");
    expect(body.sections.needsAttention.map((item: { id: string }) => item.id)).toContain("opportunity-review:low-gap");
  });

  it("sorts operator queues by priority rank then score evidence and surfaces source diagnostics", async () => {
    mockPrisma.contentProposal.findMany.mockResolvedValue([
      {
        id: "proposal-low",
        title: "Lower-scored organic proposal",
        description: "Review low score",
        priority: "P1",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: {
          organicPriority: {
            priority: "P1",
            score: 61,
            impact: "Medium",
            effort: "Low",
          },
        },
      },
      {
        id: "proposal-high",
        title: "Higher-scored organic proposal",
        description: "Review high score",
        priority: "P1",
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        sourceData: {
          organicPriority: {
            priority: "P1",
            score: 82,
            impact: "High",
            effort: "Low",
          },
        },
      },
    ]);
    mockPrisma.opportunity.findMany.mockResolvedValue([
      {
        id: "opp-low",
        status: "open",
        type: "content_gap",
        targetType: "keyword",
        targetName: "Low score keyword",
        source: "content-pilot",
        score: 45,
        priority: "P2",
        impact: "Medium",
        effort: "Low",
        proposedAction: {
          title: "Low score keyword",
          description: "Lower score first",
        },
      },
      {
        id: "opp-high",
        status: "open",
        type: "content_gap",
        targetType: "keyword",
        targetName: "High score keyword",
        source: "content-pilot",
        score: 72,
        priority: "P2",
        impact: "High",
        effort: "Low",
        proposedAction: {
          title: "High score keyword",
          description: "Higher score first",
        },
      },
    ]);
    mockPrisma.jobRun.findFirst.mockResolvedValue({
      id: "run-skills-1",
      status: "success",
      completedAt: new Date("2026-07-09T10:00:00Z"),
      summary: {
        sourceStatus: {
          gsc: {
            source: "gsc",
            state: "missing",
            latestAt: null,
            evidenceId: null,
          },
          ga4: {
            source: "ga4",
            state: "fresh",
            latestAt: "2026-07-09T09:00:00Z",
            evidenceId: "snap-ga4",
          },
        },
        skillsUnavailable: [
          {
            skillId: "organic-gap",
            missingRequiredSources: ["gsc"],
            staleRequiredSources: [],
            reason: "required data unavailable after refresh attempt",
          },
        ],
      },
    });

    const { GET } = await import("@/app/api/growth-brief/route");

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sections.readyToApprove.map((item: { id: string }) => item.id)).toEqual([
      "content:proposal-high",
      "content:proposal-low",
    ]);
    expect(body.sections.readyToApprove[0].meta).toEqual(
      expect.arrayContaining(["Score 82", "Impact High", "Effort Low"]),
    );
    expect(body.sections.quickWins.map((item: { id: string }) => item.id)).toEqual([
      "opportunity:opp-high",
      "opportunity:opp-low",
    ]);
    expect(body.sections.quickWins[0].meta).toEqual(
      expect.arrayContaining(["Score 72", "Impact High", "Effort Low"]),
    );
    expect(body.dataQuality.runSkills).toEqual({
      status: "success",
      completedAt: "2026-07-09T10:00:00.000Z",
      unavailableSources: ["gsc"],
      unavailableSkillCount: 1,
      unavailableSkillDetails: ["organic-gap: missing gsc"],
    });
  });
});
