import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  requirePermission: vi.fn(),
  getSessionShop: vi.fn(),
  getSessionUser: vi.fn(),
}));

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  guardrailConfig: {
    update: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  jobRun: {
    findMany: vi.fn(),
  },
  recommendation: {
    count: vi.fn(),
  },
  rawSnapshot: {
    count: vi.fn(),
  },
  contentProposal: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  contentProposalDraftHistory: {
    create: vi.fn(),
  },
}));

const mockGetConnectorHealth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockGetAiClient = vi.hoisted(() => vi.fn());
const mockGenerateDraft = vi.hoisted(() => vi.fn());
const mockCollectDraftCitations = vi.hoisted(() => vi.fn());
const mockResolveArticleHandle = vi.hoisted(() => vi.fn());
const mockFetchBlogArticles = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: {
    CONTENT_REVIEW: "content:review",
    JOBS_RUN: "jobs:run",
    SETTINGS_ADMIN: "settings:admin",
  },
  requireAppAuth: mockAuth.requireAppAuth,
  requirePermission: mockAuth.requirePermission,
  getSessionShop: mockAuth.getSessionShop,
  getSessionUser: mockAuth.getSessionUser,
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/config/connector-health", () => ({ getConnectorHealth: mockGetConnectorHealth }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/ai/client", () => ({ getAiClient: mockGetAiClient }));
vi.mock("@/lib/content-pilot/generate-draft", () => ({
  generateDraft: mockGenerateDraft,
  collectDraftCitations: mockCollectDraftCitations,
}));
vi.mock("@/lib/content-pilot/publish-draft", () => ({ resolveArticleHandle: mockResolveArticleHandle }));
vi.mock("@/lib/shopify-admin", () => ({ fetchBlogArticles: mockFetchBlogArticles }));

function jsonRequest(path: string, body: Record<string, unknown>) {
  return new Request(`http://test.local${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("embedded API-key fallback route auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.requirePermission.mockResolvedValue(null);
    mockAuth.getSessionShop.mockResolvedValue(null);
    mockAuth.getSessionUser.mockResolvedValue("api-key");
    mockCheckRateLimit.mockReturnValue(true);
    mockGetConnectorHealth.mockResolvedValue([{ key: "shopify", ok: true }]);
    mockGetAiClient.mockResolvedValue({
      model: "test-model",
      client: {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: "Fresh Agriko product image alt text" } }],
            }),
          },
        },
      },
    });
    mockPrisma.guardrailConfig.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.jobRun.findMany.mockResolvedValue([]);
    mockPrisma.recommendation.count.mockResolvedValue(0);
    mockPrisma.rawSnapshot.count.mockResolvedValue(0);
    mockCollectDraftCitations.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      contentProposal: {
        findUnique: mockPrisma.contentProposal.findUnique,
        update: mockPrisma.contentProposal.update,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      contentProposalDraftHistory: {
        create: mockPrisma.contentProposalDraftHistory.create,
      },
    })
  );
  mockPrisma.contentProposal.findUnique.mockResolvedValue({
      id: "proposal-1",
      status: "approved",
      proposalType: "seo-fix",
      articleHandle: "black-rice",
      draftStatus: null,
      draftGeneratedAt: null,
      updatedAt: new Date(),
      proposedState: { targetQuery: "black rice" },
      title: "Fix meta: Black Rice",
      description: "Rewrite meta",
    });
    mockPrisma.contentProposal.update.mockResolvedValue({ draftStatus: "ready", draftContent: {} });
    mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.contentProposalDraftHistory.create.mockResolvedValue({});
    mockGenerateDraft.mockResolvedValue({ metaTitle: "Black Rice | Agriko", metaDescription: "Discover black rice benefits from Agriko." });
    mockResolveArticleHandle.mockReturnValue("black-rice");
    mockFetchBlogArticles.mockResolvedValue([{ handle: "black-rice", title: "Black Rice" }]);
  });

  it("loads connector health without requiring a Shopify session shop", async () => {
    const { GET } = await import("@/app/api/settings/connector-health/route");

    const res = await GET(new Request("http://test.local/api/settings/connector-health?refresh=1"));

    expect(res.status).toBe(200);
    expect(mockAuth.requireAppAuth).toHaveBeenCalled();
    expect(mockAuth.getSessionShop).not.toHaveBeenCalled();
  });

  it("saves settings with the fallback actor when shop is unavailable", async () => {
    const { PUT } = await import("@/app/api/settings/route");

    const res = await PUT(new Request("http://test.local/api/settings", {
      method: "PUT",
      body: JSON.stringify({ guardrails: [{ key: "SOFT_FLAG_MIN_CONFIDENCE", value: "0.7" }] }),
    }) as NextRequest);

    expect(res.status).toBe(200);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: "api-key",
        action: "settings_changed",
      }),
    });
  });

  it("generates image alt text when requireAppAuth succeeds but getSessionShop is null", async () => {
    const { POST } = await import("@/app/api/images/route");

    const res = await POST(jsonRequest("/api/images", {
      imageId: "image-1",
      productId: "product-1",
      imageUrl: "https://cdn.example.com/image.jpg",
      productTitle: "Agriko Mushroom Chicharon",
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.altText).toBe("Fresh Agriko product image alt text");
    expect(mockCheckRateLimit).toHaveBeenCalledWith("alttext:api-key", 30, 60_000);
  });

  it("rate limits draft generation by session user when shop is unavailable", async () => {
    mockCheckRateLimit.mockReturnValueOnce(false);
    const { POST } = await import("@/app/api/content-pilot/proposals/[id]/generate-draft/route");

    const res = await POST(
      new Request("http://test.local/api/content-pilot/proposals/proposal-1/generate-draft", { method: "POST" }),
      { params: Promise.resolve({ id: "proposal-1" }) },
    );

    expect(res.status).toBe(429);
    expect(mockCheckRateLimit).toHaveBeenCalledWith("gen-draft:api-key", 120, 60_000);
    expect(mockCheckRateLimit).not.toHaveBeenCalledWith("gen-draft:api", 120, 60_000);
  });



  it("rate limits content brief generation by session user when shop is unavailable", async () => {
    mockCheckRateLimit.mockReturnValueOnce(false);
    const { POST } = await import("@/app/api/content-pilot/brief/route");

    const res = await POST(jsonRequest("/api/content-pilot/brief", { topic: "black rice benefits" }));

    expect(res.status).toBe(429);
    expect(mockCheckRateLimit).toHaveBeenCalledWith("brief:api-key", 10, 60_000);
    expect(mockCheckRateLimit).not.toHaveBeenCalledWith("brief:api", 10, 60_000);
  });

  it("returns an actionable AI provider error when draft generation provider auth fails", async () => {
    mockGenerateDraft.mockRejectedValueOnce(new Error("Model output could not be parsed as valid draft JSON (after retry): 401 Authentication Fails, Your api key: ****7995 is invalid"));
    const { POST } = await import("@/app/api/content-pilot/proposals/[id]/generate-draft/route");

    const res = await POST(
      new Request("http://test.local/api/content-pilot/proposals/proposal-1/generate-draft", { method: "POST" }),
      { params: Promise.resolve({ id: "proposal-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toContain("AI provider authentication failed");
    expect(body.detail).toContain("API key is invalid");

    const failedUpdate = mockPrisma.contentProposal.updateMany.mock.calls.find((call) => {
      const [args] = call;
      return args?.data?.draftStatus === "failed";
    })?.[0];
    expect(failedUpdate).toMatchObject({
      where: expect.objectContaining({
        id: "proposal-1",
        status: { in: ["approved", "override_approved"] },
        draftGenerationToken: expect.any(String),
      }),
      data: expect.objectContaining({
        draftStatus: "failed",
        draftError: expect.stringContaining("Model output could not be parsed as valid draft JSON"),
      }),
    });
  });

  it("returns cron status without requiring a Shopify session shop", async () => {
    const { GET } = await import("@/app/api/cron/status/route");

    const res = await GET(new Request("http://test.local/api/cron/status") as NextRequest);

    expect(res.status).toBe(200);
    expect(mockAuth.requireAppAuth).toHaveBeenCalled();
    expect(mockAuth.getSessionShop).not.toHaveBeenCalled();
  });
});
