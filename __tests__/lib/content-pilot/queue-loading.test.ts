import { describe, expect, it, vi } from "vitest";
import {
  contentPilotQueueCacheKey,
  loadAllProposalPages,
  loadProposalDraft,
  restoreProposalAfterFailedReload,
} from "@/lib/content-pilot/queue-loading";

describe("Content Pilot queue loading", () => {
  it("scopes cached proposals to the Shopify context", () => {
    const one = contentPilotQueueCacheKey((href) => `${href}?shop=one.myshopify.com`);
    const two = contentPilotQueueCacheKey((href) => `${href}?shop=two.myshopify.com`);

    expect(one).not.toBe(two);
  });

  it("loads more than one thousand proposals without a hidden page cap", async () => {
    const fetchPage = vi.fn(async (cursor: string | null) => {
      const page = cursor == null ? 0 : Number(cursor);
      const count = page < 10 ? 100 : 1;
      return {
        proposals: Array.from({ length: count }, (_, index) => ({ id: `${page}-${index}` })),
        total: 1001,
        hasMore: page < 10,
        nextCursor: page < 10 ? String(page + 1) : null,
      };
    });

    const proposals = await loadAllProposalPages(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(11);
    expect(proposals).toHaveLength(1001);
  });

  it("rejects a repeated cursor instead of looping forever", async () => {
    const fetchPage = vi.fn(async () => ({ proposals: [{ id: "one" }], total: 10, hasMore: true, nextCursor: "same" }));

    await expect(loadAllProposalPages(fetchPage)).rejects.toThrow("repeated cursor");
  });

  it("terminates when unique cursors exceed the first-page total bound", async () => {
    let page = 0;
    const fetchPage = vi.fn(async () => {
      if (page > 5) throw new Error("test safety stop");
      return {
        proposals: [{ id: String(page) }],
        total: 2,
        hasMore: true,
        nextCursor: String(++page),
      };
    });

    await expect(loadAllProposalPages(fetchPage)).rejects.toThrow("total bound");
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("surfaces preview request failures so the operator can retry", async () => {
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(loadProposalDraft(authFetch, "proposal-1")).rejects.toThrow("Unavailable");
  });

  it("restores the pre-generation row when both generation and authoritative reload fail", () => {
    type Proposal = { id: string; draftStatus: string | null };
    const previous: Proposal = { id: "proposal-1", draftStatus: null };
    expect(restoreProposalAfterFailedReload(
      [{ id: "proposal-1", draftStatus: "generating" }, { id: "proposal-2", draftStatus: "ready" }] satisfies Proposal[],
      "proposal-1",
      previous,
    )).toEqual([previous, { id: "proposal-2", draftStatus: "ready" }]);
  });
});
