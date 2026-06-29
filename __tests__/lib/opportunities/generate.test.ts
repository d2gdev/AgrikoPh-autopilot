import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateMarketOpportunities,
  opportunityFromMarketInsight,
  opportunityFromPriceHistory,
  opportunityFromProposal,
  opportunityTypeFromProposal,
  upsertOpportunities,
} from "@/lib/opportunities/generate";
import {
  classifyOpportunityPriority,
  normalizeOpportunityScore,
} from "@/lib/opportunities/scoring";
import type { ProposalInput } from "@/lib/content-pilot/generate-proposals";

function proposal(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    articleHandle: "organic-rice-guide",
    proposalType: "content-refresh",
    changeType: "metadata",
    priority: "high",
    impact: "high",
    effort: "low",
    title: "GSC quick win - optimise for organic rice",
    description: "Rewrite title and meta.",
    proposedState: { targetQuery: "organic rice" },
    sourceData: { query: "organic rice", impressions: 300, clicks: 1 },
    priorityScore: 84,
    ...overrides,
  };
}

const mockPrisma = {
  opportunity: {
    upsert: vi.fn(),
  },
  marketInsight: {
    findMany: vi.fn(),
  },
  shoppingPriceHistory: {
    findMany: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.opportunity.upsert.mockResolvedValue({});
  mockPrisma.marketInsight.findMany.mockResolvedValue([]);
  mockPrisma.shoppingPriceHistory.findMany.mockResolvedValue([]);
});

describe("opportunity scoring", () => {
  it("normalizes scores and classifies priorities", () => {
    expect(normalizeOpportunityScore(101)).toBe(100);
    expect(normalizeOpportunityScore(-1)).toBe(0);
    expect(classifyOpportunityPriority(80)).toBe("P0");
    expect(classifyOpportunityPriority(60)).toBe("P1");
    expect(classifyOpportunityPriority(35)).toBe("P2");
    expect(classifyOpportunityPriority(34)).toBe("P3");
  });
});

describe("opportunityFromProposal", () => {
  it("maps GSC metadata proposals to ctr_gap opportunities", () => {
    const result = opportunityFromProposal(proposal());

    expect(result).toMatchObject({
      type: "ctr_gap",
      targetType: "article",
      targetId: "organic-rice-guide",
      targetUrl: "/blogs/news/organic-rice-guide",
      score: 84,
      priority: "P0",
      source: "content-pilot",
    });
    expect(result.dedupeKey).toBe("ctr_gap:article:organic-rice-guide:metadata");
  });

  it("maps new content proposals to keyword content gaps", () => {
    const result = opportunityFromProposal(
      proposal({
        articleHandle: null,
        proposalType: "new-content",
        changeType: "new_article",
        proposedState: { targetKeyword: "low gi rice philippines" },
        sourceData: { query: "low gi rice philippines" },
        priorityScore: 55,
      }),
    );

    expect(result).toMatchObject({
      type: "content_gap",
      targetType: "keyword",
      targetId: "low gi rice philippines",
      priority: "P2",
    });
  });

  it("classifies internal-link proposals", () => {
    expect(opportunityTypeFromProposal(proposal({ proposalType: "internal-link", changeType: "internal_link" }))).toBe("internal_link");
  });
});

describe("upsertOpportunities", () => {
  it("upserts opportunities by deterministic dedupe key", async () => {
    const input = opportunityFromProposal(proposal());

    await upsertOpportunities(mockPrisma as any, [input]);

    expect(mockPrisma.opportunity.upsert).toHaveBeenCalledWith({
      where: { dedupeKey: input.dedupeKey },
      create: expect.objectContaining({
        dedupeKey: input.dedupeKey,
        status: "open",
        evidence: expect.any(Object),
        proposedAction: expect.any(Object),
      }),
      update: expect.objectContaining({
        score: input.score,
      }),
    });
  });
});

describe("market opportunities", () => {
  it("maps market insights into opportunities", () => {
    const result = opportunityFromMarketInsight({
      id: "insight-1",
      type: "long_running_competitor_ad",
      severity: "warning",
      title: "Competitor ad running long",
      summary: "A competitor ad has run for 30 days.",
      evidence: { adArchiveId: "123" },
      competitorId: "competitor-1",
      keywordId: null,
      adId: "ad-1",
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      type: "competitor_ad_change",
      targetType: "competitor_ad",
      targetId: "ad-1",
      score: 70,
      priority: "P1",
      source: "market-intelligence",
      dedupeKey: "competitor_ad_change:insight-1",
    });
  });

  it("maps significant price history rows and ignores minor changes", () => {
    const significant = opportunityFromPriceHistory({
      id: "price-1",
      productKey: "store:item",
      title: "Organic rice",
      store: "Competitor",
      price: 80,
      previousPrice: 100,
      priceDelta: -20,
      priceDeltaPct: -20,
      currency: "PHP",
      capturedAt: new Date("2026-06-24T00:00:00.000Z"),
      competitorId: "competitor-1",
      marketKeywordId: null,
    });

    expect(significant).toMatchObject({
      type: "competitor_price_change",
      targetType: "competitor_product",
      targetId: "store:item",
      score: 85,
      priority: "P0",
    });

    expect(opportunityFromPriceHistory({
      id: "price-2",
      productKey: "store:minor",
      title: "Small change",
      store: "Competitor",
      price: 99,
      previousPrice: 100,
      priceDelta: -1,
      priceDeltaPct: -1,
      currency: "PHP",
      capturedAt: new Date("2026-06-24T00:00:00.000Z"),
      competitorId: null,
      marketKeywordId: null,
    })).toBeNull();
  });

  it("generates and upserts market opportunities", async () => {
    mockPrisma.marketInsight.findMany.mockResolvedValue([
      {
        id: "insight-1",
        type: "price_change",
        severity: "warning",
        title: "Price changed",
        summary: "A price changed.",
        evidence: {},
        competitorId: "competitor-1",
        keywordId: null,
        adId: null,
        createdAt: new Date("2026-06-24T00:00:00.000Z"),
      },
    ]);
    mockPrisma.shoppingPriceHistory.findMany.mockResolvedValue([]);

    const result = await generateMarketOpportunities(mockPrisma as any);

    expect(result).toEqual({ generated: 1, upserted: 1 });
    expect(mockPrisma.opportunity.upsert).toHaveBeenCalledOnce();
  });
});
