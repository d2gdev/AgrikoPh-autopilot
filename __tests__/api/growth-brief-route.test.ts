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

function request() {
  return new Request("http://test.local/api/growth-brief") as NextRequest;
}

describe("growth-brief route", () => {
  beforeEach(() => {
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
