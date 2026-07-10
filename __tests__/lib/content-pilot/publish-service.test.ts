import { describe, expect, it, vi } from "vitest";

const publishDraft = vi.fn();
const resolveArticleHandle = vi.fn(() => "article-handle");

vi.mock("@/lib/content-pilot/publish-draft", () => ({ publishDraft, resolveArticleHandle }));
vi.mock("@/jobs/fetch-blog-content", () => ({ fetchBlogContentHandler: vi.fn().mockResolvedValue(undefined) }));

const proposal = {
  id: "p1", status: "approved", draftStatus: "ready", proposalType: "content-refresh",
  articleHandle: "article-handle", proposedState: {}, sourceData: {}, publishOperationId: null,
};

describe("publishContentProposal", () => {
  it("records a durable receipt when local SEO context fails after Shopify succeeds", async () => {
    const fresh = { ...proposal, draftContent: { bodyHtml: "<p>edited</p>" }, publishOperationId: "op-context" };
    const prismaClient: any = {
      contentProposal: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue(fresh) },
      articleRecord: { findFirst: vi.fn().mockRejectedValue(new Error("SEO index unavailable")) },
      opportunity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (fn: any) => fn(prismaClient)),
    };
    publishDraft.mockResolvedValue({ shopifyId: "gid://shopify/Article/1", handle: "edited" });
    const { publishContentProposal } = await import("@/lib/content-pilot/publish-service");

    const result = await publishContentProposal({ prismaClient, proposalId: "p1", actor: "operator", trigger: "manual" });

    expect(result.kind).toBe("published_with_warnings");
    expect(prismaClient.contentProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ draftStatus: "published", shopifyArticleId: "gid://shopify/Article/1" }),
    }));
  });
  it("publishes the fresh operation-owned row rather than the stale candidate", async () => {
    const fresh = { ...proposal, draftContent: { bodyHtml: "<p>edited</p>" }, publishOperationId: "op-1" };
    const prismaClient: any = {
      contentProposal: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(fresh),
        update: vi.fn().mockResolvedValue({}),
      },
      articleRecord: { findFirst: vi.fn().mockResolvedValue({ seoData: { score: 77, blogHandle: "news" } }) },
      opportunity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (fn: any) => fn(prismaClient)),
    };
    publishDraft.mockResolvedValue({ shopifyId: "gid://shopify/Article/1", handle: "edited" });

    const { publishContentProposal } = await import("@/lib/content-pilot/publish-service");
    const result = await publishContentProposal({ prismaClient, proposalId: "p1", actor: "operator", trigger: "manual" });

    expect(result.kind).toBe("published");
    expect(publishDraft).toHaveBeenCalledWith(fresh);
    expect(prismaClient.contentProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "p1", draftStatus: "ready" }),
      data: expect.objectContaining({ draftStatus: "publishing", publishOperationId: expect.any(String) }),
    }));
  });

  it("keeps the Shopify-success receipt published when finalization fails", async () => {
    const fresh = { ...proposal, draftContent: { bodyHtml: "<p>edited</p>" }, publishOperationId: "op-2" };
    const prismaClient: any = {
      contentProposal: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue(fresh), update: vi.fn().mockResolvedValue({}) },
      articleRecord: { findFirst: vi.fn().mockResolvedValue(null) },
      opportunity: { updateMany: vi.fn().mockRejectedValue(new Error("opportunity unavailable")) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (fn: any) => fn(prismaClient)),
    };
    publishDraft.mockResolvedValue({ shopifyId: "gid://shopify/Article/1", handle: "edited" });
    const { publishContentProposal } = await import("@/lib/content-pilot/publish-service");

    const result = await publishContentProposal({ prismaClient, proposalId: "p1", actor: "operator", trigger: "manual" });

    expect(result.kind).toBe("published_with_warnings");
    expect(prismaClient.contentProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ draftStatus: "published" }) }));
    expect(prismaClient.contentProposal.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ draftStatus: "ready" }) }));
  });

  it("requires reconciliation when receipt storage fails after Shopify success", async () => {
    const fresh = { ...proposal, draftContent: { bodyHtml: "<p>edited</p>" }, publishOperationId: "op-receipt" };
    const prismaClient: any = {
      contentProposal: {
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error("receipt unavailable")),
        findUnique: vi.fn().mockResolvedValue(fresh),
      },
      articleRecord: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    publishDraft.mockResolvedValue({ shopifyId: "gid://shopify/Article/1", handle: "edited" });
    const { publishContentProposal } = await import("@/lib/content-pilot/publish-service");

    const result = await publishContentProposal({ prismaClient, proposalId: "p1", actor: "operator", trigger: "manual" });

    expect(result.kind).toBe("reconciliation_required");
    expect(prismaClient.contentProposal.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ draftStatus: "ready" }) }));
  });
});
