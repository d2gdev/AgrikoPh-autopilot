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
vi.mock("@/lib/content-pilot/generate-proposals", () => ({ generateProposals: vi.fn() }));
vi.mock("@/lib/content-pilot/create-proposal", () => ({
  createContentProposalOnce: vi.fn(),
  withContentProposalDedupeKey: vi.fn((proposal) => proposal),
}));
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
vi.mock("@/lib/shopify-admin", () => ({ fetchBlogArticles: vi.fn() }));
vi.mock("@/lib/seo/data", () => ({ getLatestGscData: vi.fn() }));
vi.mock("@/lib/seo/promotion", () => ({ articleHandleFromBlogPage: vi.fn(), classifySeoPromotion: vi.fn() }));
vi.mock("@/lib/seo/meta", () => ({ hasMissingMeta: vi.fn() }));
vi.mock("@/lib/ai/client", () => ({ chatCompletionWithFailover: vi.fn() }));

function mockPrismaCalls() {
  return [
    mockPrisma.$transaction,
    ...Object.values(mockPrisma.articleRecord),
    ...Object.values(mockPrisma.auditLog),
    ...Object.values(mockPrisma.contentProposal),
  ].reduce((count, fn) => count + fn.mock.calls.length, 0);
}

const contentReviewMutations: Array<[string, () => Promise<Response>]> = [
  ["reject", async () => (await import("@/app/api/content-pilot/proposals/[id]/reject/route")).POST(new Request("http://test.local/reject", { method: "POST" }), { params: Promise.resolve({ id: "proposal-1" }) })],
  ["reopen", async () => (await import("@/app/api/content-pilot/proposals/[id]/reopen/route")).POST(new Request("http://test.local/reopen", { method: "POST" }), { params: Promise.resolve({ id: "proposal-1" }) })],
  ["clone", async () => (await import("@/app/api/content-pilot/proposals/[id]/clone/route")).POST(new Request("http://test.local/clone", { method: "POST" }), { params: Promise.resolve({ id: "proposal-1" }) })],
  ["generate draft", async () => (await import("@/app/api/content-pilot/proposals/[id]/generate-draft/route")).POST(new Request("http://test.local/generate-draft", { method: "POST" }), { params: Promise.resolve({ id: "proposal-1" }) })],
  ["edit draft", async () => (await import("@/app/api/content-pilot/proposals/[id]/route")).PATCH(new Request("http://test.local/proposal", { method: "PATCH" }), { params: Promise.resolve({ id: "proposal-1" }) })],
  ["generate proposals", async () => (await import("@/app/api/content-pilot/proposals/generate/route")).POST(new Request("http://test.local/generate", { method: "POST" }))],
  ["manual proposal", async () => (await import("@/app/api/content-pilot/proposals/manual/route")).POST(new Request("http://test.local/manual", { method: "POST" }) as never)],
  ["refresh all", async () => (await import("@/app/api/content-pilot/proposals/refresh-all/route")).POST(new Request("http://test.local/refresh-all", { method: "POST" }))],
  ["SEO promote", async () => (await import("@/app/api/seo/promote/route")).POST(new Request("http://test.local/seo/promote", { method: "POST" }) as never)],
  ["SEO gap promote", async () => (await import("@/app/api/seo/gaps/promote/route")).POST(new Request("http://test.local/seo/gaps/promote", { method: "POST" }) as never)],
  ["SEO recommendation decompose", async () => (await import("@/app/api/seo/recommendations/decompose/route")).POST(new Request("http://test.local/seo/recommendations/decompose", { method: "POST" }) as never)],
];

describe("Content Pilot mutation permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.requirePermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden", permission: "content:review" }, { status: 403 }),
    );
  });

  it.each(contentReviewMutations)("blocks %s without content:review", async (_name, invoke) => {
    const response = await invoke();

    expect(response.status).toBe(403);
    expect(mockPrismaCalls()).toBe(0);
    expect(mockGenerateDraft).not.toHaveBeenCalled();
    expect(mockPublishDraft).not.toHaveBeenCalled();
  });
});
