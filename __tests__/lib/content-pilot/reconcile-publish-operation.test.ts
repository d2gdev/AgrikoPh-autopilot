import { describe, expect, it, vi } from "vitest";

const inspectPublishOutcome = vi.fn();
vi.mock("@/lib/content-pilot/shopify-publish-inspection", () => ({ inspectPublishOutcome }));

describe("reconcilePublishOperation", () => {
  it("returns ready only after the type-specific Shopify inspector proves the write was not applied", async () => {
    inspectPublishOutcome.mockResolvedValueOnce({ kind: "not_applied" });
    const client: any = {
      contentProposal: {
        findUnique: vi.fn().mockResolvedValue({
          id: "p1", status: "approved", draftStatus: "publishing", publishOperationId: "op1",
          proposalType: "content-refresh", articleHandle: "black-rice", proposedState: {}, draftContent: { bodyHtml: "<p>new</p>" },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { reconcilePublishOperation } = await import("@/lib/content-pilot/publish-reconciliation");

    await expect(reconcilePublishOperation({ prismaClient: client, proposalId: "p1" })).resolves.toEqual({ kind: "not_applied" });
    expect(client.contentProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "p1", draftStatus: { in: ["publishing", "publish-error"] } }),
      data: expect.objectContaining({ draftStatus: "ready", publishOperationId: null }),
    }));
  });
});
