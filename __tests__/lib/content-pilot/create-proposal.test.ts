import { describe, expect, it, vi } from "vitest";
import { createContentProposalOnce } from "@/lib/content-pilot/create-proposal";
import { contentProposalDedupeKey } from "@/lib/content-pilot/proposal-dedupe";

const proposalData = {
  proposalType: "seo-fix",
  articleHandle: "black-rice",
  title: "Fix meta: Black Rice",
  proposedState: { issue: "missing-meta" },
};

describe("createContentProposalOnce", () => {
  it("creates with the canonical dedupe key", async () => {
    const proposal = { id: "created" };
    const client = {
      contentProposal: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(proposal),
      },
    };

    await expect(createContentProposalOnce(client, proposalData as never)).resolves.toEqual({
      proposal,
      created: true,
    });
    expect(client.contentProposal.createMany).toHaveBeenCalled();
  });

  it("returns the existing proposal when a concurrent canonical-key insert wins", async () => {
    const existing = { id: "winner", dedupeKey: contentProposalDedupeKey(proposalData) };
    const client = {
      contentProposal: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue(existing),
      },
    };

    await expect(createContentProposalOnce(client, proposalData as never)).resolves.toEqual({
      proposal: existing,
      created: false,
    });
    expect(client.contentProposal.findUnique).toHaveBeenCalledWith({ where: { dedupeKey: existing.dedupeKey } });
  });

  it("returns a proposal stored under the legacy query-specific SEO key", async () => {
    const existing = {
      id: "legacy",
      dedupeKey: "seo-fix:article:black-rice:action:missing-meta:black rice",
    };
    const client = {
      contentProposal: {
        findFirst: vi.fn().mockResolvedValue(existing),
        createMany: vi.fn(),
        findUnique: vi.fn(),
      },
    };

    await expect(createContentProposalOnce(client, proposalData as never)).resolves.toEqual({
      proposal: existing,
      created: false,
    });
    expect(client.contentProposal.findFirst).toHaveBeenCalledWith({
      where: { proposalType: "seo-fix", articleHandle: "black-rice" },
      orderBy: { createdAt: "asc" },
    });
    expect(client.contentProposal.createMany).not.toHaveBeenCalled();
  });

  it("rethrows errors other than unique conflicts", async () => {
    const error = new Error("database unavailable");
    const client = {
      contentProposal: {
        createMany: vi.fn().mockRejectedValue(error),
        findUnique: vi.fn(),
      },
    };

    await expect(createContentProposalOnce(client, proposalData as never)).rejects.toBe(error);
    expect(client.contentProposal.findUnique).not.toHaveBeenCalled();
  });

  it("rethrows a unique conflict when the competing row cannot be found", async () => {
    const client = {
      contentProposal: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(createContentProposalOnce(client, proposalData as never)).rejects.toThrow("winner missing");
  });
});
