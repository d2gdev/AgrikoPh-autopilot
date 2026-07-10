import { describe, expect, it, vi } from "vitest";
import { createContentProposalOnce } from "@/lib/content-pilot/create-proposal";

const proposalData = {
  proposalType: "seo-fix",
  articleHandle: "black-rice",
  title: "Fix meta: Black Rice",
  proposedState: { issue: "missing-meta" },
};

describe("createContentProposalOnce", () => {
  it("returns the existing proposal when a concurrent canonical-key insert wins", async () => {
    const existing = { id: "winner", dedupeKey: "seo-fix:article:black-rice:action:missing-meta" };
    const client = {
      contentProposal: {
        create: vi.fn().mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" })),
        findUnique: vi.fn().mockResolvedValue(existing),
      },
    };

    await expect(createContentProposalOnce(client, proposalData as never)).resolves.toEqual({
      proposal: existing,
      created: false,
    });
    expect(client.contentProposal.findUnique).toHaveBeenCalledWith({ where: { dedupeKey: existing.dedupeKey } });
  });

  it("rethrows errors other than unique conflicts", async () => {
    const error = new Error("database unavailable");
    const client = {
      contentProposal: {
        create: vi.fn().mockRejectedValue(error),
        findUnique: vi.fn(),
      },
    };

    await expect(createContentProposalOnce(client, proposalData as never)).rejects.toBe(error);
    expect(client.contentProposal.findUnique).not.toHaveBeenCalled();
  });

  it("rethrows a unique conflict when the competing row cannot be found", async () => {
    const error = Object.assign(new Error("unique"), { code: "P2002" });
    const client = {
      contentProposal: {
        create: vi.fn().mockRejectedValue(error),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(createContentProposalOnce(client, proposalData as never)).rejects.toBe(error);
  });
});
