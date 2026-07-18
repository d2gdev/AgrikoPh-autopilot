import { describe, expect, it, vi } from "vitest";
import { getBlockingMapContentProposals } from "@/lib/content-pilot/map-candidate-history";
import { CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES } from "@/lib/content-pilot/proposal-dedupe";
import type { MapAwareSeoGap } from "@/lib/seo/analysis";

describe("mapped content proposal history", () => {
  it("matches both legacy handle and exact-URL proposal keys", async () => {
    const gap = {
      candidateId: "b".repeat(64),
      kind: "content",
      action: "refresh",
      page: "/blogs/news/rice-guide",
      suggestedTitle: "Rice Guide",
    } as MapAwareSeoGap;
    const findMany = vi.fn().mockResolvedValue([{
      id: "published-1",
      dedupeKey: "content-refresh:article:rice-guide",
    }]);

    const blocked = await getBlockingMapContentProposals(
      { contentProposal: { findMany } },
      [gap],
    );

    expect(blocked.get(gap.candidateId)).toBe("published-1");
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: { in: CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES },
        dedupeKey: {
          in: [
            "content-refresh:article-url:/blogs/news/rice-guide",
            "content-refresh:article:rice-guide",
          ],
        },
      },
      select: { id: true, dedupeKey: true },
    });
  });
});
