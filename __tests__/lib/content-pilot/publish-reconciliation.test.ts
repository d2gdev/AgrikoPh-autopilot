import { describe, expect, it, vi } from "vitest";

const shopifyFetch = vi.fn();
vi.mock("@/lib/shopify-admin", () => ({ shopifyFetch }));

describe("reconcilePublishOperation", () => {
  it("does not reset a receipt-less publishing operation without inspection proof", async () => {
    const client: any = {
      contentProposal: {
        findUnique: vi.fn().mockResolvedValue({ id: "p1", draftStatus: "publishing", shopifyArticleId: null, proposalType: "new-content" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { reconcilePublishOperation } = await import("@/lib/content-pilot/publish-reconciliation");

    const result = await reconcilePublishOperation({ prismaClient: client, proposalId: "p1" });

    expect(result.kind).toBe("ambiguous");
    expect(client.contentProposal.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ draftStatus: "ready" }) }));
  });
});

describe("inspectPublishOutcome", () => {
  it("confirms a new-content publish only when Shopify has the exact generated article", async () => {
    shopifyFetch.mockResolvedValueOnce({
      articles: { edges: [{ node: {
        id: "gid://shopify/Article/9", handle: "black-rice-guide", title: "Black Rice Guide",
        body: "<p>Complete guide</p>", seoTitle: { value: "Black Rice Guide" }, seoDescription: { value: "Everything about black rice" },
      } }] },
    });
    const { inspectPublishOutcome } = await import("@/lib/content-pilot/shopify-publish-inspection");

    await expect(inspectPublishOutcome({
      id: "p-new", proposalType: "new-content", articleHandle: "black-rice-guide", proposedState: {},
      draftContent: { title: "Black Rice Guide", bodyHtml: "<p>Complete guide</p>", tags: [], metaDescription: "Everything about black rice" },
    } as any)).resolves.toEqual({ kind: "applied", shopifyId: "gid://shopify/Article/9", handle: "black-rice-guide" });
  });

  it("proves an existing-article body update was not applied when Shopify returns a different body", async () => {
    shopifyFetch.mockResolvedValueOnce({
      articles: { edges: [{ node: {
        id: "gid://shopify/Article/3", handle: "black-rice", title: "Black Rice",
        body: "<p>Old content</p>", seoTitle: { value: null }, seoDescription: { value: null },
      } }] },
    });
    const { inspectPublishOutcome } = await import("@/lib/content-pilot/shopify-publish-inspection");

    await expect(inspectPublishOutcome({
      id: "p-refresh", proposalType: "content-refresh", articleHandle: "black-rice", proposedState: {},
      draftContent: { bodyHtml: "<p>Replacement content</p>" },
    } as any)).resolves.toEqual({ kind: "not_applied" });
  });

  it("keeps an unprovable new-content absence ambiguous instead of calling it not applied", async () => {
    shopifyFetch.mockResolvedValueOnce({ articles: { edges: [] } });
    const { inspectPublishOutcome } = await import("@/lib/content-pilot/shopify-publish-inspection");

    await expect(inspectPublishOutcome({
      id: "p-new", proposalType: "new-content", articleHandle: null, proposedState: {},
      draftContent: { title: "Black Rice Guide", bodyHtml: "<p>Complete guide</p>", tags: [], metaDescription: "Everything about black rice" },
    } as any)).resolves.toEqual({ kind: "ambiguous" });
  });
});
