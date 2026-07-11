import { describe, expect, it, vi } from "vitest";

const publishDraft = vi.fn();
const resolveArticleHandle = vi.fn(() => "article-handle");
const fetchBlogContentHandler = vi.fn().mockResolvedValue(undefined);
const runFetchBlogContentLocked = vi.fn(async () => ({ acquired: true, result: await fetchBlogContentHandler() }));

vi.mock("@/lib/content-pilot/publish-draft", () => ({ publishDraft, resolveArticleHandle }));
vi.mock("@/jobs/fetch-blog-content", () => ({ fetchBlogContentHandler, runFetchBlogContentLocked }));

const proposal = {
  id: "p1", status: "approved", draftStatus: "ready", proposalType: "content-refresh",
  articleHandle: "article-handle", proposedState: {}, sourceData: {}, publishOperationId: null,
};

describe("publishContentProposal", () => {
  it("persists the minimal receipt before any post-success enrichment", async () => {
    const fresh = { ...proposal, articleHandle: null, sourceData: { targetArticleHandle: "existing-article" }, publishOperationId: "op-receipt-first" };
    const events: string[] = [];
    const prismaClient: any = {
      contentProposal: {
        updateMany: vi.fn(async (args: any) => {
          events.push(args.data.draftStatus === "published" ? "receipt" : "other-update");
          return { count: 1 };
        }),
        findUnique: vi.fn().mockResolvedValue(fresh),
      },
      articleRecord: { findFirst: vi.fn(async () => { events.push("enrichment"); return { seoData: { score: 77, blogHandle: "news" } }; }) },
      opportunity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (fn: any) => fn(prismaClient)),
    };
    publishDraft.mockResolvedValue({ shopifyId: "gid://shopify/Article/1", handle: "edited" });
    resolveArticleHandle.mockReturnValueOnce("existing-article");
    const { publishContentProposal } = await import("@/lib/content-pilot/publish-service");

    await publishContentProposal({ prismaClient, proposalId: "p1", actor: "operator", trigger: "manual", reindex: false });

    expect(events.indexOf("receipt")).toBeLessThan(events.indexOf("enrichment"));
    expect(prismaClient.contentProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ articleHandle: "existing-article", draftStatus: "published" }),
    }));
  });

  it.each(["opportunity", "audit", "reindex"] as const)("keeps the receipt published when %s finalization fails", async (failure) => {
    const fresh = { ...proposal, draftContent: { bodyHtml: "<p>edited</p>" }, publishOperationId: `op-${failure}` };
    const prismaClient: any = {
      contentProposal: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue(fresh) },
      articleRecord: { findFirst: vi.fn().mockResolvedValue(null) },
      opportunity: { updateMany: failure === "opportunity" ? vi.fn().mockRejectedValue(new Error("opportunity unavailable")) : vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: failure === "audit" ? vi.fn().mockRejectedValue(new Error("audit unavailable")) : vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (fn: any) => fn(prismaClient)),
    };
    publishDraft.mockResolvedValue({ shopifyId: "gid://shopify/Article/1", handle: "edited" });
    const fetch = await import("@/jobs/fetch-blog-content");
    if (failure === "reindex") vi.mocked(fetch.fetchBlogContentHandler).mockRejectedValueOnce(new Error("reindex unavailable"));
    const { publishContentProposal } = await import("@/lib/content-pilot/publish-service");

    const result = await publishContentProposal({ prismaClient, proposalId: "p1", actor: "operator", trigger: "manual" });

    expect(result.kind).toBe("published_with_warnings");
    expect(prismaClient.contentProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ draftStatus: "published" }) }));
  });

  it("finalizes a published receipt idempotently with exactly one audit", async () => {
    const prismaClient: any = {
      contentProposal: {
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({ ...proposal, id: "p1", publishOperationId: "op-final", publishTrigger: "manual", publishActor: "operator" }),
      },
      opportunity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (fn: any) => fn(prismaClient)),
    };
    const { finalizePublishedProposal } = await import("@/lib/content-pilot/publish-service");

    await finalizePublishedProposal(prismaClient, "op-final");
    await finalizePublishedProposal(prismaClient, "op-final");

    expect(prismaClient.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("persists equivalent receipts and truthful audits for manual and scheduled publishing", async () => {
    const run = async (trigger: "manual" | "scheduled") => {
      const fresh = { ...proposal, draftContent: { bodyHtml: "<p>edited</p>" }, publishOperationId: `op-${trigger}`, publishTrigger: trigger, publishActor: trigger === "manual" ? "operator" : "cron" };
      const prismaClient: any = {
        contentProposal: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue(fresh) },
        articleRecord: { findFirst: vi.fn().mockResolvedValue({ seoData: { score: 77, blogHandle: "news" } }) },
        opportunity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, auditLog: { create: vi.fn().mockResolvedValue({}) },
        $transaction: vi.fn(async (fn: any) => fn(prismaClient)),
      };
      publishDraft.mockResolvedValue({ shopifyId: "gid://shopify/Article/1", handle: "edited" });
      const { publishContentProposal } = await import("@/lib/content-pilot/publish-service");
      await publishContentProposal({ prismaClient, proposalId: "p1", actor: trigger === "manual" ? "operator" : "cron", trigger, dueBefore: trigger === "scheduled" ? new Date() : undefined, reindex: false });
      const receipt = prismaClient.contentProposal.updateMany.mock.calls
        .map(([args]: [any]) => args.data)
        .find((data: any) => data.draftStatus === "published");
      return { receipt, audit: prismaClient.auditLog.create.mock.calls[0][0].data };
    };

    const manual = await run("manual");
    const scheduled = await run("scheduled");

    const { publishedAt: manualPublishedAt, ...manualReceipt } = manual.receipt;
    const { publishedAt: scheduledPublishedAt, ...scheduledReceipt } = scheduled.receipt;
    expect(manualPublishedAt).toBeInstanceOf(Date);
    expect(scheduledPublishedAt).toBeInstanceOf(Date);
    expect(scheduledReceipt).toEqual(manualReceipt);
    expect(manual.audit).toEqual(expect.objectContaining({ action: "published", meta: expect.objectContaining({ trigger: "manual" }) }));
    expect(scheduled.audit).toEqual(expect.objectContaining({ action: "published_scheduled", meta: expect.objectContaining({ trigger: "scheduled" }) }));
  });

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

  it("publishes the fresh edited draft after a scheduled due-list stale read", async () => {
    const fresh = { ...proposal, draftContent: { bodyHtml: "<p>scheduled edit</p>" }, publishOperationId: "op-scheduled", publishTrigger: "scheduled", publishActor: "cron" };
    const prismaClient: any = {
      contentProposal: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue(fresh) },
      articleRecord: { findFirst: vi.fn().mockResolvedValue(null) },
      opportunity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (fn: any) => fn(prismaClient)),
    };
    publishDraft.mockResolvedValue({ shopifyId: "gid://shopify/Article/1", handle: "edited" });
    const { publishContentProposal } = await import("@/lib/content-pilot/publish-service");

    await publishContentProposal({ prismaClient, proposalId: "p1", actor: "cron", trigger: "scheduled", dueBefore: new Date(), reindex: false });

    expect(publishDraft).toHaveBeenCalledWith(expect.objectContaining({ draftContent: { bodyHtml: "<p>scheduled edit</p>" } }));
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
