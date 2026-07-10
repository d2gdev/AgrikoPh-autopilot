import { describe, expect, it, vi } from "vitest";

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
