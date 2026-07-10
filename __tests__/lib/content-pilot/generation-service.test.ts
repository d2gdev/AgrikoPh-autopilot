import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateProposalDraft } from "@/lib/content-pilot/generation-service";

const mockPrisma = vi.hoisted(() => ({
  contentProposal: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  contentProposalDraftHistory: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const mockGenerateDraft = vi.hoisted(() => vi.fn());
const mockFetchArticles = vi.hoisted(() => vi.fn());
const mockCollectDraftCitations = vi.hoisted(() => vi.fn());

const mockTx = vi.hoisted(() => ({
  contentProposal: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  contentProposalDraftHistory: {
    create: vi.fn(),
  },
}));

const txClient = mockTx as unknown as {
  contentProposal: {
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  contentProposalDraftHistory: {
    create: ReturnType<typeof vi.fn>;
  };
};

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    status: "approved",
    draftStatus: null,
    articleHandle: "new-article",
    proposalType: "new-content",
    proposedState: {},
    title: "Seed the season guide",
    description: "Generate a fresh article",
    draftContent: null,
    draftError: null,
    draftGenerationStartedAt: null,
    draftGenerationToken: null,
    publishOperationId: null,
    publishStartedAt: null,
    publishFinalizedAt: null,
    publishWarning: null,
    updatedAt: new Date(),
    createdAt: new Date(),
    citations: null,
    priority: "P1",
    impact: "High",
    effort: "Medium",
    sourceData: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(txClient));
  mockPrisma.contentProposal.findUnique.mockResolvedValue(null);
  mockPrisma.contentProposal.update.mockResolvedValue({});
  mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.contentProposalDraftHistory.create.mockResolvedValue({ id: "history-1" });
  mockFetchArticles.mockResolvedValue([{ handle: "new-article" }]);
  mockGenerateDraft.mockResolvedValue({ bodyHtml: "<h2>Seed</h2> ".repeat(200), title: "Seed season guide" });
  mockCollectDraftCitations.mockResolvedValue([]);

  mockTx.contentProposal.findUnique.mockResolvedValue({
    ...proposal(),
    draftStatus: "ready",
    draftContent: { title: "Seed season guide" },
    draftGeneratedAt: new Date(),
  });
  mockTx.contentProposal.updateMany.mockResolvedValue({ count: 0 });
  mockTx.contentProposalDraftHistory.create.mockResolvedValue({ id: "history-1" });
});

describe("generateProposalDraft", () => {
  it("claims a generation slot and finalizes only with matching token", async () => {
    mockPrisma.contentProposal.findUnique.mockResolvedValue(proposal({}));
    mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockTx.contentProposal.updateMany.mockResolvedValueOnce({ count: 1 });
    mockTx.contentProposal.findUnique.mockResolvedValueOnce({
      ...proposal(),
      draftStatus: "ready",
      draftContent: { title: "Seed season guide" },
      draftGeneratedAt: new Date(),
    });

    const result = await generateProposalDraft({
      prismaClient: mockPrisma,
      proposalId: "proposal-1",
      actor: "operator",
      generateDraftImpl: mockGenerateDraft,
      fetchBlogArticlesImpl: mockFetchArticles,
      collectDraftCitationsImpl: mockCollectDraftCitations,
    });

    expect(result.kind).toBe("ready");
    const claim = mockPrisma.contentProposal.updateMany.mock.calls[0]?.[0];
    expect(claim?.where).toMatchObject({
      id: "proposal-1",
      status: { in: ["approved", "override_approved"] },
      draftStatus: { notIn: ["generating", "publishing"] },
    });
    expect((claim?.data as Record<string, unknown>).draftStatus).toBe("generating");
    expect(mockTx.contentProposalDraftHistory.create).toHaveBeenCalledWith({
      data: {
        proposalId: "proposal-1",
        savedBy: "operator",
        reason: "generated",
        draftContent: expect.any(Object),
      },
    });
    expect(mockCollectDraftCitations).toHaveBeenCalled();
  });

  it("discards a late AI result after the token is cleared or replaced", async () => {
    mockPrisma.contentProposal.findUnique.mockResolvedValue(proposal());
    mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockTx.contentProposal.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await generateProposalDraft({
      prismaClient: mockPrisma,
      proposalId: "proposal-1",
      actor: "operator",
      generateDraftImpl: mockGenerateDraft,
      fetchBlogArticlesImpl: mockFetchArticles,
      collectDraftCitationsImpl: mockCollectDraftCitations,
    });

    expect(result).toEqual({ kind: "discarded", reason: "Proposal changed while generating" });
    expect(mockTx.contentProposalDraftHistory.create).not.toHaveBeenCalled();
    expect(mockPrisma.contentProposal.update).not.toHaveBeenCalled();
    expect(mockCollectDraftCitations).not.toHaveBeenCalled();
  });

  it("rolls back ready state when draft-history creation fails", async () => {
    mockPrisma.contentProposal.findUnique.mockResolvedValue(proposal());
    mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockTx.contentProposal.updateMany.mockResolvedValueOnce({ count: 1 });
    mockTx.contentProposalDraftHistory.create.mockRejectedValueOnce(new Error("history failed"));

    const result = await generateProposalDraft({
      prismaClient: mockPrisma,
      proposalId: "proposal-1",
      actor: "operator",
      generateDraftImpl: mockGenerateDraft,
      fetchBlogArticlesImpl: mockFetchArticles,
      collectDraftCitationsImpl: mockCollectDraftCitations,
    });

    expect(result).toEqual({ kind: "failed", error: "history failed" });
    expect(mockPrisma.contentProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "proposal-1",
        draftGenerationToken: expect.any(String),
      }),
      data: expect.objectContaining({ draftStatus: "failed" }),
    }));
  });

  it("returns conflict when generation is already active for that proposal", async () => {
    mockPrisma.contentProposal.findUnique.mockResolvedValue(proposal());
    mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 0 });

    const result = await generateProposalDraft({
      prismaClient: mockPrisma,
      proposalId: "proposal-1",
      actor: "operator",
      generateDraftImpl: mockGenerateDraft,
      fetchBlogArticlesImpl: mockFetchArticles,
      collectDraftCitationsImpl: mockCollectDraftCitations,
    });

    expect(result).toEqual({
      kind: "conflict",
      reason: "Proposal is already generating or has active draft ownership",
    });
    expect(mockTx.contentProposal.updateMany).not.toHaveBeenCalled();
    expect(mockGenerateDraft).not.toHaveBeenCalled();
  });

  it("never claims generation ownership while publishing, including when preserving a receipt", async () => {
    mockPrisma.contentProposal.findUnique.mockResolvedValue(proposal({ draftStatus: "publishing" }));
    mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 0 });

    const result = await generateProposalDraft({
      prismaClient: mockPrisma,
      proposalId: "proposal-1",
      actor: "operator",
      preservePublishedReceipt: true,
      generateDraftImpl: mockGenerateDraft,
      fetchBlogArticlesImpl: mockFetchArticles,
      collectDraftCitationsImpl: mockCollectDraftCitations,
    });

    expect(result.kind).toBe("conflict");
    expect(mockPrisma.contentProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        draftStatus: { notIn: ["generating", "publishing"] },
      }),
    }));
    expect(mockGenerateDraft).not.toHaveBeenCalled();
  });

  it("returns failed when validation rejects the generated draft before finalization", async () => {
    mockPrisma.contentProposal.findUnique.mockResolvedValue(
      proposal({ proposedState: { targetWordCount: 500 } }),
    );
    mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockGenerateDraft.mockResolvedValueOnce({ bodyHtml: "<p>too short</p>", title: "Short" });

    const result = await generateProposalDraft({
      prismaClient: mockPrisma,
      proposalId: "proposal-1",
      actor: "operator",
      generateDraftImpl: mockGenerateDraft,
      fetchBlogArticlesImpl: mockFetchArticles,
      collectDraftCitationsImpl: mockCollectDraftCitations,
    });

    expect(result).toEqual({
      kind: "failed",
      error: "Draft too short: 2 words (target: 500, minimum: 400)",
    });
    expect(mockCollectDraftCitations).not.toHaveBeenCalled();
    expect(mockTx.contentProposal.updateMany).not.toHaveBeenCalled();
  });

  it("returns discarded when token is cleared during validation failure", async () => {
    mockPrisma.contentProposal.findUnique.mockResolvedValue(proposal());
    mockPrisma.contentProposal.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.contentProposal.updateMany.mockResolvedValueOnce({ count: 0 });
    mockGenerateDraft.mockResolvedValueOnce({ bodyHtml: "<p>too short</p>", title: "Short" });
    mockGenerateDraft.mockResolvedValueOnce({ bodyHtml: "<p>too short</p>", title: "Short" });

    const result = await generateProposalDraft({
      prismaClient: mockPrisma,
      proposalId: "proposal-1",
      actor: "operator",
      generateDraftImpl: mockGenerateDraft,
      fetchBlogArticlesImpl: mockFetchArticles,
      collectDraftCitationsImpl: mockCollectDraftCitations,
    });

    expect(result).toEqual({
      kind: "discarded",
      reason: "Proposal changed before validation failure persistence could complete",
    });
  });

  it("discards missing-identity failure when the generation token was cleared", async () => {
    mockPrisma.contentProposal.findUnique.mockResolvedValue(proposal({
      proposalType: "refresh",
      articleHandle: null,
    }));
    mockPrisma.contentProposal.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await generateProposalDraft({
      prismaClient: mockPrisma,
      proposalId: "proposal-1",
      actor: "operator",
      resolveArticleHandleImpl: () => null,
      generateDraftImpl: mockGenerateDraft,
      fetchBlogArticlesImpl: mockFetchArticles,
      collectDraftCitationsImpl: mockCollectDraftCitations,
    });

    expect(result).toEqual({
      kind: "discarded",
      reason: "Proposal changed before missing identity failure persistence could complete",
    });
    expect(mockGenerateDraft).not.toHaveBeenCalled();
  });

  it("preserves published receipt fields while a receipt-preserving generation is claimed and AI runs", async () => {
    const publishedAt = new Date("2026-07-10T00:00:00.000Z");
    const publishedReceipt = proposal({
      draftStatus: "published",
      draftGenerationToken: null,
      draftGenerationStartedAt: null,
      publishedAt,
      shopifyArticleId: "gid://shopify/Article/42",
      publishedHandle: "live-season-guide",
      draftContent: { title: "Live season guide", bodyHtml: "<p>Live content</p>" },
    });
    let releaseDraft: ((draft: { bodyHtml: string; title: string }) => void) | undefined;
    const draftStarted = new Promise<void>((resolve) => {
      mockGenerateDraft.mockImplementationOnce(() => new Promise((release) => {
        releaseDraft = release;
        resolve();
      }));
    });

    mockPrisma.contentProposal.findUnique.mockResolvedValue(publishedReceipt);
    mockPrisma.contentProposal.updateMany.mockImplementationOnce(async ({ data }) => {
      Object.assign(publishedReceipt, data);
      return { count: 1 };
    });
    mockTx.contentProposal.updateMany.mockResolvedValueOnce({ count: 1 });

    const generation = generateProposalDraft({
      prismaClient: mockPrisma,
      proposalId: "proposal-1",
      actor: "operator",
      preservePublishedReceipt: true,
      generateDraftImpl: mockGenerateDraft,
      fetchBlogArticlesImpl: mockFetchArticles,
      collectDraftCitationsImpl: mockCollectDraftCitations,
    });

    await draftStarted;

    const claim = mockPrisma.contentProposal.updateMany.mock.calls[0]?.[0];
    expect(claim?.where).toMatchObject({
      draftStatus: {
        notIn: ["generating", "publishing"],
      },
    });
    expect(claim?.data).toMatchObject({
      draftGenerationToken: expect.any(String),
      draftGenerationStartedAt: expect.any(Date),
    });
    expect((claim?.data as Record<string, unknown>).draftStatus).toBeUndefined();
    expect(publishedReceipt).toMatchObject({
      draftStatus: "published",
      publishedAt,
      shopifyArticleId: "gid://shopify/Article/42",
      publishedHandle: "live-season-guide",
      draftContent: { title: "Live season guide", bodyHtml: "<p>Live content</p>" },
    });

    releaseDraft?.({ bodyHtml: "<h2>Seed</h2> ".repeat(200), title: "Updated season guide" });
    expect((await generation).kind).toBe("ready");
  });
});
