import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateMarketOpportunities,
  generateSkillInsightOpportunities,
  opportunitiesFromSkillInsight,
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
import { scoreOrganicOpportunity } from "@/lib/organic/prioritization";
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
  skillInsight: {
    findMany: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.opportunity.upsert.mockResolvedValue({});
  mockPrisma.marketInsight.findMany.mockResolvedValue([]);
  mockPrisma.shoppingPriceHistory.findMany.mockResolvedValue([]);
  mockPrisma.skillInsight.findMany.mockResolvedValue([]);
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
        sourceData: {
          query: "low gi rice philippines",
          organicPriority: scoreOrganicOpportunity({
            type: "content_gap",
            searchVolume: 1800,
            confidence: 0.75,
            effort: "medium",
            businessRelevance: "high",
            sourceFreshnessHours: 24,
          }),
        },
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

  it("uses shared organic scoring from proposal evidence and preserves the original proposal score", () => {
    const organicPriority = scoreOrganicOpportunity({
      type: "ctr_gap",
      impressions: 2000,
      clicks: 20,
      position: 8,
      expectedCtr: 0.035,
      confidence: 0.85,
      effort: "low",
      businessRelevance: "high",
      sourceFreshnessHours: 24,
    });

    const result = opportunityFromProposal(
      proposal({
        priority: "P1",
        impact: "Medium",
        effort: "Low",
        priorityScore: 42,
        sourceData: {
          query: "organic rice philippines",
          impressions: 2000,
          clicks: 20,
          position: 8,
          expectedCtr: 0.035,
          organicPriority,
        },
      }),
    );

    expect(result.score).toBe(organicPriority.score);
    expect(result.priority).toBe(organicPriority.priority);
    expect(result.impact).toBe(organicPriority.impact);
    expect(result.effort).toBe(organicPriority.effort);
    expect(result.evidence).toMatchObject({
      organicPriority,
      originalPriority: "P1",
      score: 42,
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

function skillInsight(overrides: Partial<Parameters<typeof opportunitiesFromSkillInsight>[0]> = {}) {
  return {
    id: "insight-1",
    skillId: "ad-pilot",
    skillName: "Ad Pilot",
    insightType: "fatigue-report",
    items: [],
    snapshotId: "snapshot-1",
    jobRunId: "run-1",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("opportunitiesFromSkillInsight", () => {
  it("maps fatigue-report items to rotate_creative opportunities", () => {
    const result = opportunitiesFromSkillInsight(
      skillInsight({
        insightType: "fatigue-report",
        items: [
          {
            adId: "ad-123",
            adName: "Summer Sale Video",
            adSetName: "Prospecting",
            status: "urgent",
            frequency: 5.2,
            ctrChange7d: -0.31,
            daysRunning: 21,
            estimatedDaysLeft: 3,
            rationale: "CTR fell sharply over the last week.",
          },
        ],
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "creative_fatigue",
      targetType: "ad",
      targetId: "ad-123",
      dedupeKey: "skill_insight:fatigue-report:ad-123",
      source: "skill-insight",
    });
    expect(result[0]!.proposedAction).toMatchObject({
      action: "rotate_creative",
      title: "Creative fatigue: Summer Sale Video",
    });
  });

  it("maps search-term-opportunities items to review_search_term opportunities noting Google is unavailable", () => {
    const result = opportunitiesFromSkillInsight(
      skillInsight({
        insightType: "search-term-opportunities",
        items: [
          {
            searchTerm: "organic brown rice philippines",
            theme: "rice",
            impressions: 500,
            clicks: 20,
            conversions: 2,
            currentCpaPHP: 150,
            recommendedMatchType: "phrase",
            recommendedBidPHP: 12,
            suggestedAdGroup: "Rice - Broad",
            isNegativeKeyword: false,
          },
        ],
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "search_term_opportunity",
      targetType: "search_term",
      targetId: "organic brown rice philippines",
      dedupeKey: "skill_insight:search-term-opportunities:organic brown rice philippines",
    });
    expect((result[0]!.proposedAction as { action: string; description: string }).action).toBe("review_search_term");
    expect((result[0]!.proposedAction as { description: string }).description).toMatch(/Google execution is not available/i);
  });

  it("maps competitor-analysis items to review_competitor_creative opportunities", () => {
    const result = opportunitiesFromSkillInsight(
      skillInsight({
        insightType: "competitor-analysis",
        items: [
          {
            competitor: "RivalBrand",
            activeAdCount: 12,
            dominantFormat: "video",
            messagingThemes: ["discount"],
            primaryCta: "Shop Now",
            recentLaunches7d: 3,
            gaps: ["No bundle offers"],
            recommendedTests: ["Test a bundle offer"],
          },
        ],
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "competitor_creative_review",
      targetType: "competitor",
      targetId: "RivalBrand",
      dedupeKey: "skill_insight:competitor-analysis:RivalBrand",
    });
    expect((result[0]!.proposedAction as { action: string }).action).toBe("review_competitor_creative");
  });

  it("skips malformed items missing their identifier instead of throwing", () => {
    expect(() =>
      opportunitiesFromSkillInsight(
        skillInsight({
          insightType: "fatigue-report",
          items: [{ adName: "No id ad" }, null, "not-an-object"],
        }),
      ),
    ).not.toThrow();

    const result = opportunitiesFromSkillInsight(
      skillInsight({
        insightType: "fatigue-report",
        items: [{ adName: "No id ad" }, null, "not-an-object"],
      }),
    );
    expect(result).toHaveLength(0);
  });

  it("returns an empty array for an empty items list", () => {
    expect(opportunitiesFromSkillInsight(skillInsight({ items: [] }))).toEqual([]);
  });
});

describe("generateSkillInsightOpportunities", () => {
  it("generates and upserts skill insight opportunities from recent rows", async () => {
    mockPrisma.skillInsight.findMany.mockResolvedValue([
      skillInsight({
        insightType: "fatigue-report",
        items: [{ adId: "ad-1", adName: "Ad One", status: "warning", rationale: "Frequency is climbing." }],
      }),
    ]);

    const result = await generateSkillInsightOpportunities(mockPrisma as any);

    expect(result).toEqual({ generated: 1, upserted: 1 });
    expect(mockPrisma.opportunity.upsert).toHaveBeenCalledOnce();
  });

  it("dedupes across two runs using the same stable key", async () => {
    mockPrisma.skillInsight.findMany.mockResolvedValue([
      skillInsight({
        insightType: "fatigue-report",
        items: [{ adId: "ad-1", adName: "Ad One", status: "warning", rationale: "Frequency is climbing." }],
      }),
    ]);

    await generateSkillInsightOpportunities(mockPrisma as any);
    await generateSkillInsightOpportunities(mockPrisma as any);

    expect(mockPrisma.opportunity.upsert).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = mockPrisma.opportunity.upsert.mock.calls;
    expect(firstCall![0].where.dedupeKey).toBe(secondCall![0].where.dedupeKey);
  });
});
