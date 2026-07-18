import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  snapshot: vi.fn(),
  commandCenter: vi.fn(),
  evidenceState: vi.fn(),
  readAnalysis: vi.fn(),
  tasks: vi.fn(),
  blockingProposals: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAppAuth: mocks.requireAppAuth }));
vi.mock("@/lib/db", () => ({
  prisma: { seoFollowUpTask: { findMany: mocks.tasks } },
}));
vi.mock("@/lib/seo/snapshot", () => ({ getLatestSnapshot: mocks.snapshot }));
vi.mock("@/lib/topical-map/command-center", () => ({
  loadActiveTopicalMapCommandCenter: mocks.commandCenter,
}));
vi.mock("@/lib/seo/analysis", () => ({
  analysisEvidenceState: mocks.evidenceState,
  readAnalysisForStrategy: mocks.readAnalysis,
}));
vi.mock("@/lib/content-pilot/map-candidate-history", () => ({
  getBlockingMapContentProposals: mocks.blockingProposals,
}));

const identity = {
  versionId: "strategy-1",
  strategyVersion: "2026-07-18",
  contractRevision: "5",
  packageSha256: "a".repeat(64),
  activatedAt: "2026-07-18T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.requireAppAuth.mockResolvedValue(null);
  mocks.snapshot.mockResolvedValue({
    payload: { generatedAt: "2026-07-18T00:00:00.000Z" },
  });
  mocks.evidenceState.mockReturnValue("current");
  mocks.tasks.mockResolvedValue([
    {
      id: "ready-1",
      sourceKey: `topical-map-content:strategy-1:${"b".repeat(64)}`,
      title: "Rice Guide",
      description: "keep; refresh",
      targetUrl: "/blogs/news/rice-guide",
      priority: "P1",
      earliestReviewAt: new Date("2026-07-17T16:00:00.000Z"),
      dueAt: null,
      sourceData: {
        candidateId: "b".repeat(64),
        action: "refresh",
        strategyVersionId: "strategy-1",
        packageSha256: "a".repeat(64),
        ruleIds: ["content-1"],
      },
    },
    {
      id: "future-1",
      sourceKey: `topical-map-content:strategy-1:${"c".repeat(64)}`,
      title: "Future Rice Guide",
      description: "Create the exact future mapped guide.",
      targetUrl: "/blogs/news/future-rice-guide",
      priority: "P2",
      earliestReviewAt: new Date("2026-08-07T16:00:00.000Z"),
      dueAt: new Date("2026-08-16T15:59:59.999Z"),
      sourceData: {
        candidateId: "c".repeat(64),
        action: "create",
        strategyVersionId: "strategy-1",
        packageSha256: "a".repeat(64),
        phase: { label: "Rice Nutrition", startDay: 22, endDay: 30 },
        ruleIds: ["content:future"],
        phaseRuleIds: ["schedule:rice"],
      },
    },
  ]);
  mocks.blockingProposals.mockResolvedValue(new Map());
  mocks.commandCenter.mockResolvedValue({
    identity,
    pages: [
      {
        url: "/blogs/news/rice-guide",
        title: "Rice Guide",
        decision: "keep; refresh",
        priority: "P1",
        ruleIds: ["role-1", "content-1"],
        ruleDomains: { content_decisions: ["content-1"] },
      },
      {
        url: "/blogs/news/medical-guide",
        title: "Medical Guide",
        decision: "refresh after medical review",
        priority: "P1",
        ruleIds: ["content-2"],
        ruleDomains: { content_decisions: ["content-2"] },
      },
    ],
  });
  mocks.readAnalysis.mockReturnValue({
    gaps: [{
      candidateId: "b".repeat(64),
      kind: "content",
      action: "refresh",
      page: "/blogs/news/rice-guide",
      priority: "P1",
      ruleIds: ["role-1", "content-1"],
    }],
    observations: [{ query: "unmapped rice idea" }],
    suppressed: [{
      page: "/blogs/news/medical-guide",
      reason: "manual_gate",
      ruleIds: ["content-2"],
    }],
  });
});

describe("GET /api/content-pilot/map-suggestions", () => {
  it("returns exact mapped actionable and research work without raw observations", async () => {
    const { GET } = await import("@/app/api/content-pilot/map-suggestions/route");
    const response = await GET(new Request("https://app.example/api/content-pilot/map-suggestions"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.strategy).toEqual({
      versionId: "strategy-1",
      packageSha256: "a".repeat(64),
      analysisGeneratedAt: "2026-07-18T00:00:00.000Z",
    });
    expect(body.currentWork).toEqual({ status: "current", reason: null });
    expect(body.actionable[0]).toMatchObject({
      candidateId: "b".repeat(64),
      targetUrl: "/blogs/news/rice-guide",
      title: "Rice Guide",
      action: "refresh",
      decision: "keep; refresh",
      ruleIds: ["content-1"],
    });
    expect(body.research[0]).toMatchObject({
      targetUrl: "/blogs/news/medical-guide",
      title: "Medical Guide",
      reason: "manual_gate",
      ruleIds: ["content-2"],
    });
    expect(body.upcoming).toEqual([{
      taskId: "future-1",
      title: "Future Rice Guide",
      targetUrl: "/blogs/news/future-rice-guide",
      action: "create",
      obligations: "Create the exact future mapped guide.",
      priority: "P2",
      earliestReviewAt: "2026-08-07T16:00:00.000Z",
      dueAt: "2026-08-16T15:59:59.999Z",
      phaseLabel: "Rice Nutrition",
      ruleIds: ["content:future", "schedule:rice"],
    }]);
    expect(body).not.toHaveProperty("observations");
  });

  it("keeps future phases visible when current strategy-bound analysis is stale", async () => {
    mocks.evidenceState.mockReturnValue("evidence_stale");
    const { GET } = await import("@/app/api/content-pilot/map-suggestions/route");
    const response = await GET(new Request("https://app.example/api/content-pilot/map-suggestions"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.currentWork).toEqual({
      status: "refresh_required",
      reason: "Current strategy-bound SEO analysis must be refreshed.",
    });
    expect(body.actionable).toEqual([]);
    expect(body.research).toEqual([]);
    expect(body.upcoming).toHaveLength(1);
  });

  it("hides mapped content already queued or completed", async () => {
    mocks.blockingProposals.mockResolvedValue(new Map([["b".repeat(64), "published-1"]]));
    const { GET } = await import("@/app/api/content-pilot/map-suggestions/route");
    const response = await GET(new Request("https://app.example/api/content-pilot/map-suggestions"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.actionable).toEqual([]);
  });

  it("excludes future phases whose persisted strategy identity does not match", async () => {
    mocks.tasks.mockResolvedValue([{
      id: "phase-other",
      sourceKey: `topical-map-content:strategy-other:${"c".repeat(64)}`,
      title: "Other strategy phase",
      description: "Do not show.",
      targetUrl: "/blogs/news/other",
      priority: "P2",
      earliestReviewAt: new Date("2026-08-07T16:00:00.000Z"),
      dueAt: null,
      sourceData: {
        candidateId: "c".repeat(64),
        action: "create",
        strategyVersionId: "strategy-other",
        packageSha256: "c".repeat(64),
        phase: { label: "Other", startDay: 22, endDay: 30 },
        ruleIds: ["schedule:other"],
      },
    }]);
    const { GET } = await import("@/app/api/content-pilot/map-suggestions/route");
    const response = await GET(new Request("https://app.example/api/content-pilot/map-suggestions"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.upcoming).toEqual([]);
  });
});
