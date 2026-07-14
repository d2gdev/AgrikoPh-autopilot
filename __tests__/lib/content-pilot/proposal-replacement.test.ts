import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/opportunities/content-proposal-outcomes", () => ({
  markContentProposalOpportunitiesTerminal: vi.fn().mockResolvedValue({ resolved: 0, dismissed: 1 }),
}));
vi.mock("@/lib/opportunities/generate", () => ({
  opportunityFromProposal: vi.fn((proposal) => ({ dedupeKey: `opp:${proposal.id}` })),
  upsertOpportunities: vi.fn().mockResolvedValue({ upserted: 1 }),
}));

import { replacePendingContentProposals } from "@/lib/content-pilot/proposal-replacement";

const input = { proposalType: "new-content", title: "A", proposedState: { targetKeyword: "a" } } as never;

function client(overrides: Record<string, unknown> = {}) {
  const tx: any = {
    contentProposal: {
      findMany: vi.fn().mockResolvedValue([{ id: "old", status: "pending", draftStatus: "ready", sourceData: {} }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({ id: "new", proposalType: "new-content", title: "A", proposedState: {} }),
    },
    ...overrides,
  };
  const root = { $transaction: vi.fn(async (fn: (tx: any) => unknown) => fn(tx)) };
  return { root, tx };
}

describe("replacePendingContentProposals", () => {
  it("keeps terminal marking, pending delete, canonical insert and opportunity upsert inside the transaction", async () => {
    const { root, tx } = client();
    await replacePendingContentProposals(root, [input]);
    expect(root.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.contentProposal.deleteMany).toHaveBeenCalled();
    expect(tx.contentProposal.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ dedupeKey: expect.any(String) })], skipDuplicates: true });
  });

  it("rejects on insert failure and performs no root writes", async () => {
    const { root, tx } = client();
    tx.contentProposal.createMany.mockRejectedValueOnce(new Error("insert failed"));
    await expect(replacePendingContentProposals(root, [input])).rejects.toThrow("insert failed");
    expect(root).toHaveProperty("$transaction");
  });

  it("derives opportunities only from rows returned by canonical inserts", async () => {
    const { root } = client();
    const { opportunityFromProposal } = await import("@/lib/opportunities/generate");
    await replacePendingContentProposals(root, [input]);
    expect(opportunityFromProposal).toHaveBeenCalledWith(expect.objectContaining({ id: "new" }));
  });
});
