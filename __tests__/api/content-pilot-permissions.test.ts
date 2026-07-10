import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mockAuth = vi.hoisted(() => ({
  getSessionShop: vi.fn(),
  getSessionUser: vi.fn(),
  requireAppAuth: vi.fn(),
  requirePermission: vi.fn(),
}));
const mockGenerateDraft = vi.hoisted(() => vi.fn());
const mockPublishDraft = vi.hoisted(() => vi.fn());
const mockCreateContentProposalOnce = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockGenerateProposals = vi.hoisted(() => vi.fn());
const mockFetchBlogArticles = vi.hoisted(() => vi.fn());
const mockGetLatestGscData = vi.hoisted(() => vi.fn());
const mockChatCompletionWithFailover = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  articleRecord: { findMany: vi.fn(), findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
  contentProposal: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  getSessionShop: mockAuth.getSessionShop,
  getSessionUser: mockAuth.getSessionUser,
  requireAppAuth: mockAuth.requireAppAuth,
  requirePermission: mockAuth.requirePermission,
}));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/content-pilot/generate-draft", () => ({
  collectDraftCitations: vi.fn(),
  generateDraft: mockGenerateDraft,
  getDraftSchema: vi.fn(),
}));
vi.mock("@/lib/content-pilot/publish-draft", () => ({
  publishDraft: mockPublishDraft,
  resolveArticleHandle: vi.fn(),
}));
vi.mock("@/lib/content-pilot/generate-proposals", () => ({ generateProposals: mockGenerateProposals }));
vi.mock("@/lib/content-pilot/create-proposal", () => ({
  createContentProposalOnce: mockCreateContentProposalOnce,
  withContentProposalDedupeKey: vi.fn((proposal) => proposal),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/content-pilot/proposal-dedupe", () => ({
  CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES: [],
  CONTENT_PROPOSAL_REPLACEMENT_BLOCKING_STATUSES: [],
  contentProposalDedupeKey: vi.fn(),
  filterBlockedContentProposalInputs: vi.fn(),
}));
vi.mock("@/lib/content-pilot/priority-score", () => ({
  changeTypeToEffort: vi.fn(),
  classifyPriority: vi.fn(),
  findingToImpact: vi.fn(),
}));
vi.mock("@/lib/opportunities/content-proposal-outcomes", () => ({
  markContentProposalOpportunitiesTerminal: vi.fn(),
  markContentProposalOpportunityDismissed: vi.fn(),
  markContentProposalOpportunityRouted: vi.fn(),
}));
vi.mock("@/lib/opportunities/generate", () => ({ opportunityFromProposal: vi.fn(), upsertOpportunities: vi.fn() }));
vi.mock("@/lib/shopify-admin", () => ({ fetchBlogArticles: mockFetchBlogArticles }));
vi.mock("@/lib/seo/data", () => ({ getLatestGscData: mockGetLatestGscData }));
vi.mock("@/lib/seo/promotion", () => ({ articleHandleFromBlogPage: vi.fn(), classifySeoPromotion: vi.fn() }));
vi.mock("@/lib/seo/meta", () => ({ hasMissingMeta: vi.fn() }));
vi.mock("@/lib/ai/client", () => ({ chatCompletionWithFailover: mockChatCompletionWithFailover }));

function mockPrismaCalls() {
  return [
    mockPrisma.$transaction,
    ...Object.values(mockPrisma.articleRecord),
    ...Object.values(mockPrisma.auditLog),
    ...Object.values(mockPrisma.contentProposal),
  ].reduce((count, fn) => count + fn.mock.calls.length, 0);
}

function expectNoMutationBoundaries() {
  expect(mockPrismaCalls()).toBe(0);
  expect(mockCreateContentProposalOnce).not.toHaveBeenCalled();
  expect(mockGenerateDraft).not.toHaveBeenCalled();
  expect(mockPublishDraft).not.toHaveBeenCalled();
  expect(mockGenerateProposals).not.toHaveBeenCalled();
  expect(mockFetchBlogArticles).not.toHaveBeenCalled();
  expect(mockGetLatestGscData).not.toHaveBeenCalled();
  expect(mockChatCompletionWithFailover).not.toHaveBeenCalled();
}

const contentReviewMutations: Array<[string, (req: Request) => Promise<Response>]> = [
  ["reject", async (req) => (await import("@/app/api/content-pilot/proposals/[id]/reject/route")).POST(req, { params: Promise.resolve({ id: "proposal-1" }) })],
  ["reopen", async (req) => (await import("@/app/api/content-pilot/proposals/[id]/reopen/route")).POST(req, { params: Promise.resolve({ id: "proposal-1" }) })],
  ["clone", async (req) => (await import("@/app/api/content-pilot/proposals/[id]/clone/route")).POST(req, { params: Promise.resolve({ id: "proposal-1" }) })],
  ["generate draft", async (req) => (await import("@/app/api/content-pilot/proposals/[id]/generate-draft/route")).POST(req, { params: Promise.resolve({ id: "proposal-1" }) })],
  ["edit draft", async (req) => (await import("@/app/api/content-pilot/proposals/[id]/route")).PATCH(req, { params: Promise.resolve({ id: "proposal-1" }) })],
  ["generate proposals", async (req) => (await import("@/app/api/content-pilot/proposals/generate/route")).POST(req)],
  ["manual proposal", async (req) => (await import("@/app/api/content-pilot/proposals/manual/route")).POST(req as never)],
  ["refresh all", async (req) => (await import("@/app/api/content-pilot/proposals/refresh-all/route")).POST(req)],
  ["SEO promote", async (req) => (await import("@/app/api/seo/promote/route")).POST(req)],
  ["SEO gap promote", async (req) => (await import("@/app/api/seo/gaps/promote/route")).POST(req as never)],
  ["SEO recommendation decompose", async (req) => (await import("@/app/api/seo/recommendations/decompose/route")).POST(req as never)],
];

function mutationRequest(name: string) {
  return new Request(`http://test.local/${name}`, { method: "POST" });
}

describe("Content Pilot mutation permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.requirePermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden", permission: "content:review" }, { status: 403 }),
    );
    mockCheckRateLimit.mockReturnValue(true);
  });

  it.each(contentReviewMutations)("returns 401 before boundaries when %s is unauthenticated", async (name, invoke) => {
    mockAuth.requirePermission.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const req = mutationRequest(name);
    const response = await invoke(req);

    expect(response.status).toBe(401);
    expect(mockAuth.requirePermission).toHaveBeenCalledWith(req, "content:review");
    expectNoMutationBoundaries();
  });

  it.each(contentReviewMutations)("returns 403 before boundaries when %s lacks content:review", async (name, invoke) => {
    const req = mutationRequest(name);
    const response = await invoke(req);

    expect(response.status).toBe(403);
    expect(mockAuth.requirePermission).toHaveBeenCalledWith(req, "content:review");
    expectNoMutationBoundaries();
  });

  it("allows a content reviewer to create a manually requested proposal", async () => {
    mockAuth.requirePermission.mockResolvedValue(null);
    mockCreateContentProposalOnce.mockResolvedValue({
      created: true,
      proposal: { id: "proposal-1" },
    });
    const req = new Request("http://test.local/manual", {
      method: "POST",
      body: JSON.stringify({ topic: "Organic rice recipes" }),
    });
    const { POST } = await import("@/app/api/content-pilot/proposals/manual/route");

    const response = await POST(req as never);

    expect(response.status).toBe(200);
    expect(mockAuth.requirePermission).toHaveBeenCalledWith(req, "content:review");
    expect(mockCreateContentProposalOnce).toHaveBeenCalledTimes(1);
  });
});
