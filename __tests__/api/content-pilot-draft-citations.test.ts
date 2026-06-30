import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// Regression coverage for the citations-write isolation fix: the `citations`
// column's migration (20260701030000_add_proposal_citations) is not yet
// applied to the live DB, so the citations-only update must be able to fail
// (simulating `42703 column "citations" does not exist`) without affecting
// the core draft persistence (draftStatus/draftContent) or the route's
// response.

const mockAuth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  getSessionShop: vi.fn(),
  getSessionUser: vi.fn(),
}));

const mockPrisma = vi.hoisted(() => ({
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
  requireAppAuth: mockAuth.requireAppAuth,
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
    mockAuth.getSessionShop.mockResolvedValue(null);
    mockAuth.getSessionUser.mockResolvedValue("operator");
    mockCheckRateLimit.mockReturnValue(true);

    mockPrisma.contentProposal.findUnique.mockResolvedValue({ ...baseProposal });
    mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.contentProposalDraftHistory.create.mockResolvedValue({});
    mockPublishDraft.resolveArticleHandle.mockReturnValue(null);
    mockShopifyAdmin.fetchBlogArticles.mockResolvedValue([]);
    mockDraftGen.generateDraft.mockResolvedValue({ bodyHtml: draftBody, title: "Test Draft" });
    mockDraftGen.collectDraftCitations.mockResolvedValue([
      { sourceType: "article", title: "Ginger 101", score: 0.9 },
    ]);
  });

  it("persists the draft even when the citations-only update fails (column not migrated)", async () => {
    mockPrisma.contentProposal.update
      .mockResolvedValueOnce({ draftStatus: "ready", draftContent: { bodyHtml: draftBody, title: "Test Draft" } }) // main draft-persist update
      .mockRejectedValueOnce(new Error('column "citations" does not exist')); // citations-only update

    const { POST } = await import("@/app/api/content-pilot/proposals/[id]/generate-draft/route");

    const res = await POST(postRequest(), { params: Promise.resolve({ id: "proposal-1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.draftStatus).toBe("ready");
    expect(json.draftContent).toBeTruthy();

    // Main draft write must not include `citations` in its payload.
    expect(mockPrisma.contentProposal.update).toHaveBeenCalledTimes(2);
    const mainUpdateArgs = mockPrisma.contentProposal.update.mock.calls[0]?.[0];
    expect(mainUpdateArgs.data).not.toHaveProperty("citations");
    expect(mainUpdateArgs.data.draftStatus).toBe("ready");

    // History row is written from the successful draft, independent of citations.
    expect(mockPrisma.contentProposalDraftHistory.create).toHaveBeenCalledTimes(1);

    // The second (citations-only) update was attempted and its failure swallowed.
    const citationsUpdateArgs = mockPrisma.contentProposal.update.mock.calls[1]?.[0];
    expect(citationsUpdateArgs.data).toHaveProperty("citations");
  });

  it("does not compute citations when pre-publish validation fails", async () => {
    mockDraftGen.generateDraft.mockResolvedValue({ bodyHtml: "<p>too short</p>", title: "Short" });
    mockPrisma.contentProposal.update.mockResolvedValue({ draftStatus: "failed" });

    const { POST } = await import("@/app/api/content-pilot/proposals/[id]/generate-draft/route");

    const res = await POST(postRequest(), { params: Promise.resolve({ id: "proposal-1" }) });

    expect(res.status).toBe(422);
    expect(mockDraftGen.collectDraftCitations).not.toHaveBeenCalled();
  });
});
