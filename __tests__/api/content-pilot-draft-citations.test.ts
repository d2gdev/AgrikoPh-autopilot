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
  contentProposal: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  contentProposalDraftHistory: {
    create: vi.fn(),
  },
}));

const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockDraftGen = vi.hoisted(() => ({
  generateDraft: vi.fn(),
  collectDraftCitations: vi.fn(),
}));
const mockPublishDraft = vi.hoisted(() => ({
  resolveArticleHandle: vi.fn(),
}));
const mockShopifyAdmin = vi.hoisted(() => ({
  fetchBlogArticles: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  requireAppAuth: mockAuth.requireAppAuth,
  requirePermission: mockAuth.requirePermission,
  getSessionShop: mockAuth.getSessionShop,
  getSessionUser: mockAuth.getSessionUser,
}));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/content-pilot/generate-draft", () => mockDraftGen);
vi.mock("@/lib/content-pilot/publish-draft", () => mockPublishDraft);
vi.mock("@/lib/shopify-admin", () => mockShopifyAdmin);

function postRequest() {
  return new Request("http://test.local/api/content-pilot/proposals/proposal-1/generate-draft", {
    method: "POST",
  }) as NextRequest;
}

const baseProposal = {
  id: "proposal-1",
  status: "approved",
  proposalType: "new-content",
  draftStatus: null,
  draftGeneratedAt: null,
  updatedAt: new Date(),
  articleHandle: null,
  proposedState: {},
};

const draftBody = `<h2>Section</h2><p>${"word ".repeat(150)}</p>`;

describe("generate-draft citations isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.requirePermission.mockResolvedValue(null);
    mockAuth.getSessionShop.mockResolvedValue(null);
    mockAuth.getSessionUser.mockResolvedValue("operator");
    mockCheckRateLimit.mockReturnValue(true);

    mockPrisma.contentProposal.findUnique.mockResolvedValue({
      ...baseProposal,
      draftStatus: null,
      draftGeneratedAt: null,
      draftError: null,
      draftGenerationToken: null,
      draftGenerationStartedAt: null,
    });
    mockPrisma.contentProposal.update.mockResolvedValue({});
    mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.contentProposalDraftHistory.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        contentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            ...baseProposal,
            draftStatus: "ready",
            draftContent: { bodyHtml: draftBody, title: "Test Draft" },
            draftGeneratedAt: new Date(),
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: mockPrisma.contentProposal.update,
        },
        contentProposalDraftHistory: mockPrisma.contentProposalDraftHistory,
      })
    );
    mockPublishDraft.resolveArticleHandle.mockReturnValue(null);
    mockShopifyAdmin.fetchBlogArticles.mockResolvedValue([]);
    mockDraftGen.generateDraft.mockResolvedValue({ bodyHtml: draftBody, title: "Test Draft" });
    mockDraftGen.collectDraftCitations.mockResolvedValue([
      { sourceType: "article", title: "Ginger 101", score: 0.9 },
    ]);
  });

  it("persists draft content even when citations persistence fails", async () => {
    mockPrisma.contentProposal.update
      .mockResolvedValueOnce({ draftStatus: "ready", draftContent: { bodyHtml: draftBody, title: "Test Draft" } }) // citation-only finalization
      .mockRejectedValueOnce(new Error('column "citations" does not exist'));

    const { POST } = await import("@/app/api/content-pilot/proposals/[id]/generate-draft/route");

    const res = await POST(postRequest(), { params: Promise.resolve({ id: "proposal-1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.draftStatus).toBe("ready");
    expect(json.draftContent).toBeTruthy();

    // Main draft write must include draft content and ready status.
    expect(mockPrisma.contentProposalDraftHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          proposalId: "proposal-1",
          savedBy: "operator",
          reason: "generated",
        }),
      }),
    );

    // The standalone citations update should be attempted and failure-swallowed.
    expect(mockPrisma.contentProposal.update).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { citations: expect.anything() },
    });
  });

  it("does not compute citations when pre-publish validation fails", async () => {
    mockDraftGen.generateDraft.mockResolvedValue({ bodyHtml: "<p>too short</p>", title: "Short" });

    const { POST } = await import("@/app/api/content-pilot/proposals/[id]/generate-draft/route");

    const res = await POST(postRequest(), { params: Promise.resolve({ id: "proposal-1" }) });
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error).toBe("Draft validation failed");
    expect(json.detail).toContain("Draft too short");
    expect(mockDraftGen.collectDraftCitations).not.toHaveBeenCalled();
  });
});
