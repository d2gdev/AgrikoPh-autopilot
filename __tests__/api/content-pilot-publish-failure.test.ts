import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  requireCronAuth: vi.fn(),
  requirePermission: vi.fn(),
}));

const mockPrisma = vi.hoisted(() => ({
  auditLog: {
    create: vi.fn(),
  },
  contentProposal: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

const mockPublishDraft = vi.hoisted(() => vi.fn());
const mockResolveArticleHandle = vi.hoisted(() => vi.fn());
const mockFetchBlogContentHandler = vi.hoisted(() => vi.fn());
const mockMarkResolved = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_PUBLISH: "content:publish" },
  getSessionUser: mockAuth.getSessionUser,
  requireCronAuth: mockAuth.requireCronAuth,
  requirePermission: mockAuth.requirePermission,
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/content-pilot/publish-draft", () => ({
  publishDraft: mockPublishDraft,
  resolveArticleHandle: mockResolveArticleHandle,
}));
vi.mock("@/jobs/fetch-blog-content", () => ({
  fetchBlogContentHandler: mockFetchBlogContentHandler,
}));
vi.mock("@/lib/opportunities/content-proposal-outcomes", () => ({
  markContentProposalOpportunityResolved: mockMarkResolved,
}));

function readyRefreshProposal() {
  return {
    id: "proposal-1",
    articleHandle: "creating-your-own-herbal-blends-a-practical-guide-for-everyday-use",
    proposalType: "content-refresh",
    draftStatus: "ready",
    draftError: null,
    sourceData: {},
  };
}

describe("Content Pilot publish failure recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.getSessionUser.mockResolvedValue("operator");
    mockAuth.requireCronAuth.mockReturnValue(null);
    mockAuth.requirePermission.mockResolvedValue(null);
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.contentProposal.findMany.mockResolvedValue([]);
    mockPrisma.contentProposal.findUnique.mockResolvedValue(readyRefreshProposal());
    mockPrisma.contentProposal.update.mockResolvedValue({});
    mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockResolveArticleHandle.mockReturnValue("creating-your-own-herbal-blends-a-practical-guide-for-everyday-use");
    mockFetchBlogContentHandler.mockResolvedValue({});
    mockMarkResolved.mockResolvedValue({});
  });

  it("marks a manual publish failed when the target Shopify article no longer exists", async () => {
    const error = new Error(
      "Target article 'creating-your-own-herbal-blends-a-practical-guide-for-everyday-use' no longer exists in Shopify — recreate it or reject this proposal."
    );
    mockPublishDraft.mockRejectedValue(error);

    const { POST } = await import("@/app/api/content-pilot/proposals/[id]/publish/route");
    const res = await POST(
      new Request("http://test.local/api/content-pilot/proposals/proposal-1/publish", { method: "POST" }),
      { params: Promise.resolve({ id: "proposal-1" }) }
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("no longer exists in Shopify");
    expect(mockPrisma.contentProposal.update).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: expect.objectContaining({
        draftStatus: "failed",
        draftError: expect.stringContaining("no longer exists in Shopify"),
      }),
    });
  });

  it("marks a scheduled publish failed when the target Shopify article no longer exists", async () => {
    const proposal = readyRefreshProposal();
    const error = new Error(
      "Target article 'creating-your-own-herbal-blends-a-practical-guide-for-everyday-use' no longer exists in Shopify — recreate it or reject this proposal."
    );
    mockPrisma.contentProposal.findMany.mockResolvedValue([proposal]);
    mockPublishDraft.mockRejectedValue(error);

    const { GET } = await import("@/app/api/cron/publish-scheduled/route");
    const res = await GET(new Request("http://test.local/api/cron/publish-scheduled") as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ published: 0 }));
    expect(body.results).toEqual([
      expect.objectContaining({ id: "proposal-1", ok: false, error: expect.stringContaining("no longer exists in Shopify") }),
    ]);
    expect(mockPrisma.contentProposal.update).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: expect.objectContaining({
        draftStatus: "failed",
        draftError: expect.stringContaining("no longer exists in Shopify"),
      }),
    });
  });
});
