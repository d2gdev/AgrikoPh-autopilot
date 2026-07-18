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
      primaryKeywordOrTheme: "organic rice guide",
      secondaryVariants: "rice guide Philippines",
      ruleIds: ["content-1"],
    }],
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
});

describe("POST /api/content-pilot/brief", () => {
  it("rejects free-form topic input", async () => {
    const { POST } = await import("@/app/api/content-pilot/brief/route");
    const response = await POST(request({ topic: "invented topic" }) as never);

    expect(response.status).toBe(400);
    expect(mocks.completions).not.toHaveBeenCalled();
  });

  it("generates a brief only from the exact current map candidate", async () => {
    const { POST } = await import("@/app/api/content-pilot/brief/route");
    const response = await POST(request({
      strategyVersionId: "strategy-1",
      packageSha256: "a".repeat(64),
      analysisGeneratedAt: "2026-07-18T00:00:00.000Z",
      candidateId: "b".repeat(64),
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.brief).toBe("Mapped brief");
    const call = mocks.completions.mock.calls[0]?.[0];
    expect(JSON.stringify(call?.messages)).toContain("Mapped Rice Guide");
    expect(JSON.stringify(call?.messages)).toContain("/blogs/news/rice-guide");
    expect(JSON.stringify(call?.messages)).not.toContain("health food Philippines");
  });
});
