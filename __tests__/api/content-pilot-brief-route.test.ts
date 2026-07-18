import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  requirePermission: vi.fn(),
  getSessionShop: vi.fn(),
  getSessionUser: vi.fn(),
  checkRateLimit: vi.fn(),
  snapshot: vi.fn(),
  commandCenter: vi.fn(),
  evidenceState: vi.fn(),
  readAnalysis: vi.fn(),
  completions: vi.fn(),
  blockingProposals: vi.fn(),
  hasReadyTask: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAppAuth: mocks.requireAppAuth,
  requirePermission: mocks.requirePermission,
  getSessionShop: mocks.getSessionShop,
  getSessionUser: mocks.getSessionUser,
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/seo/snapshot", () => ({ getLatestSnapshot: mocks.snapshot }));
vi.mock("@/lib/topical-map/command-center", () => ({
  loadActiveTopicalMapCommandCenter: mocks.commandCenter,
}));
vi.mock("@/lib/seo/analysis", () => ({
  analysisEvidenceState: mocks.evidenceState,
  readAnalysisForStrategy: mocks.readAnalysis,
}));
vi.mock("@/lib/ai/client", () => ({
  getAiClient: vi.fn(async () => ({
    model: "test-model",
    client: { chat: { completions: { create: mocks.completions } } },
  })),
}));
vi.mock("@/lib/content-pilot/map-candidate-history", () => ({
  getBlockingMapContentProposals: mocks.blockingProposals,
  hasReadyMappedContentTask: mocks.hasReadyTask,
}));

const identity = {
  versionId: "strategy-1",
  strategyVersion: "2026-07-18",
  contractRevision: "5",
  packageSha256: "a".repeat(64),
  activatedAt: "2026-07-18T00:00:00.000Z",
};

function request(body: unknown) {
  return new Request("https://app.example/api/content-pilot/brief", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.requireAppAuth.mockResolvedValue(null);
  mocks.requirePermission.mockResolvedValue(null);
  mocks.getSessionShop.mockResolvedValue("shop");
  mocks.checkRateLimit.mockReturnValue(true);
  mocks.snapshot.mockResolvedValue({
    payload: { generatedAt: "2026-07-18T00:00:00.000Z" },
  });
  mocks.evidenceState.mockReturnValue("current");
  mocks.commandCenter.mockResolvedValue({
    identity,
    pages: [{
      url: "/blogs/news/rice-guide",
      title: "Mapped Rice Guide",
      decision: "keep; refresh",
      cluster: "Organic rice",
      role: "guide",
      exclusiveIntentScope: "organic rice buying guide",
      primaryKeywordOrTheme: "organic rice guide",
      secondaryVariants: "rice guide Philippines",
      ruleIds: ["content-1"],
    }, {
      url: "/blogs/news/rice-benefits",
      title: "Rice Benefits",
      cluster: "Organic rice",
      role: "benefits spoke",
      exclusiveIntentScope: "organic rice health benefits",
      primaryKeywordOrTheme: "rice benefits",
      ruleIds: ["content-2"],
    }],
    work: {
      internalLinks: [{
        fromUrl: "/blogs/news/rice-guide",
        toUrl: "/collections/organic-rice",
        requiredAction: "add exact link",
        recommendedAnchor: "organic rice",
        linkPurpose: "connect the guide to the mapped collection",
        policy: {
          resolutionStatus: "resolved",
          conditions: [],
          evidenceRequirements: [],
          reviewRequirements: [],
        },
        ruleIds: ["link-1"],
      }, {
        fromUrl: "/blogs/news/rice-guide",
        toUrl: "/blogs/news/unapproved-link",
        requiredAction: "add exact link",
        policy: {
          resolutionStatus: "manual_gate",
          conditions: [],
          evidenceRequirements: [],
          reviewRequirements: [],
        },
        ruleIds: ["link-2"],
      }],
    },
  });
  mocks.readAnalysis.mockReturnValue({
    gaps: [{
      candidateId: "b".repeat(64),
      kind: "content",
      action: "refresh",
      page: "/blogs/news/rice-guide",
      ruleIds: ["content-1"],
      observedEvidence: [{ query: "organic rice guide", impressions: 100, position: 9 }],
    }],
    observations: [],
    suppressed: [],
  });
  mocks.completions.mockResolvedValue({
    choices: [{ message: { content: "Mapped brief" }, finish_reason: "stop" }],
  });
  mocks.blockingProposals.mockResolvedValue(new Map());
  mocks.hasReadyTask.mockResolvedValue(true);
});

describe("POST /api/content-pilot/brief", () => {
  it("rejects free-form topic input", async () => {
    const { POST } = await import("@/app/api/content-pilot/brief/route");
    const response = await POST(request({ topic: "invented topic" }) as never);

    expect(response.status).toBe(400);
    expect(mocks.completions).not.toHaveBeenCalled();
  });

  it("builds a map-bounded brief without inventing adjacent content", async () => {
    const { POST } = await import("@/app/api/content-pilot/brief/route");
    const response = await POST(request({
      strategyVersionId: "strategy-1",
      packageSha256: "a".repeat(64),
      analysisGeneratedAt: "2026-07-18T00:00:00.000Z",
      candidateId: "b".repeat(64),
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.brief).toContain("Mapped Rice Guide");
    expect(body.brief).toContain("/blogs/news/rice-guide");
    expect(body.brief).toContain("Ownership boundaries");
    expect(body.brief).toContain("/blogs/news/rice-benefits");
    expect(body.brief).toContain("organic rice health benefits");
    expect(body.brief).toContain("/collections/organic-rice");
    expect(body.brief).not.toContain("/blogs/news/unapproved-link");
    expect(body.brief).not.toContain("health food Philippines");
    expect(mocks.completions).not.toHaveBeenCalled();
  });

  it("does not generate another brief for mapped work already handled", async () => {
    mocks.blockingProposals.mockResolvedValue(new Map([["b".repeat(64), "published-1"]]));
    const { POST } = await import("@/app/api/content-pilot/brief/route");
    const response = await POST(request({
      strategyVersionId: "strategy-1",
      packageSha256: "a".repeat(64),
      analysisGeneratedAt: "2026-07-18T00:00:00.000Z",
      candidateId: "b".repeat(64),
    }) as never);

    expect(response.status).toBe(409);
    expect(mocks.completions).not.toHaveBeenCalled();
  });
});
