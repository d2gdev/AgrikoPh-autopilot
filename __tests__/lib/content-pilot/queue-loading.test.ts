import { describe, expect, it, vi } from "vitest";
import {
  contentPilotQueueCacheKey,
  loadAllProposalPages,
  loadProposalDraft,
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
        hasMore: page < 10,
        nextCursor: page < 10 ? String(page + 1) : null,
      };
    });

    const proposals = await loadAllProposalPages(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(11);
    expect(proposals).toHaveLength(1001);
  });

  it("rejects a repeated cursor instead of looping forever", async () => {
    const fetchPage = vi.fn(async () => ({ proposals: [], hasMore: true, nextCursor: "same" }));

    await expect(loadAllProposalPages(fetchPage)).rejects.toThrow("repeated cursor");
  });

  it("surfaces preview request failures so the operator can retry", async () => {
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(loadProposalDraft(authFetch, "proposal-1")).rejects.toThrow("Unavailable");
  });
});
