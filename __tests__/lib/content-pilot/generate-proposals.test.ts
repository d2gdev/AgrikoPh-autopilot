import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateProposals } from "@/lib/content-pilot/generate-proposals";

const mockPrisma = {
  articleRecord: { findMany: vi.fn() },
  rawSnapshot: { findFirst: vi.fn() },
  gscQuery: { findFirst: vi.fn(), findMany: vi.fn() },
  skillInsight: { findFirst: vi.fn() },
  marketInsight: { findMany: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.articleRecord.findMany.mockReset();
  mockPrisma.articleRecord.findMany.mockResolvedValue([]);
  mockPrisma.rawSnapshot.findFirst.mockResolvedValue(null);
  mockPrisma.gscQuery.findFirst.mockResolvedValue(null);
  mockPrisma.gscQuery.findMany.mockResolvedValue([]);
  mockPrisma.skillInsight.findFirst.mockResolvedValue(null);
  mockPrisma.marketInsight.findMany.mockResolvedValue([]);
});

describe("generateProposals", () => {
  it("returns empty array when no articles indexed", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([]);
    const result = await generateProposals(mockPrisma as any);
    expect(result).toEqual([]);
  });

  it("generates an orphan-link proposal for an article with zero inbound links", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "moringa-benefits",
        title: "Moringa Benefits",
        publishedAt: new Date("2025-01-01"),
        wordCount: 900,
        inboundCount: 0,
        internalLinkCount: 2,
        seoData: { score: 85, issues: [] },
        topicsData: [{ topic: "moringa", confidence: 0.8, matchedKeywords: ["moringa"] }],
      },
      {
        handle: "moringa-recipes",
        title: "Moringa Recipes",
        publishedAt: new Date("2025-02-01"),
        wordCount: 1200,
        inboundCount: 3,
        internalLinkCount: 4,
        seoData: { score: 88, issues: [] },
        topicsData: [{ topic: "moringa", confidence: 0.9, matchedKeywords: ["moringa"] }],
      },
    ]);

    const result = await generateProposals(mockPrisma as any);
    const orphanProposal = result.find((p) => p.proposalType === "internal-link");
    expect(orphanProposal).toBeDefined();
    expect(orphanProposal?.articleHandle).toBe("moringa-benefits");
    expect(orphanProposal?.changeType).toBe("internal_link");
  });

  it("prefers specific topical source matches over broad shared topics", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "black-rice-adobo-fried-rice",
        title: "Black Rice Adobo Fried Rice",
        publishedAt: new Date("2025-01-01"),
        wordCount: 900,
        inboundCount: 0,
        internalLinkCount: 0,
        seoData: { score: 85, issues: [] },
        topicsData: [
          { topic: "rice", confidence: 0.82 },
          { topic: "nutrition", confidence: 0.54 },
          { topic: "cooking", confidence: 0.51 },
        ],
      },
      {
        handle: "turmeric-tea-benefits-philippines",
        title: "Turmeric Tea Benefits Philippines",
        publishedAt: new Date("2025-02-01"),
        wordCount: 1800,
        inboundCount: 5,
        internalLinkCount: 12,
        seoData: { score: 88, issues: [] },
        topicsData: [
          { topic: "ginger", confidence: 0.68 },
          { topic: "nutrition", confidence: 0.36 },
          { topic: "cooking", confidence: 0.41 },
        ],
      },
      {
        handle: "rice-nutrition-breakdown",
        title: "Rice Nutrition Facts",
        publishedAt: new Date("2025-02-01"),
        wordCount: 1300,
        inboundCount: 1,
        internalLinkCount: 1,
        seoData: { score: 88, issues: [] },
        topicsData: [
          { topic: "rice", confidence: 0.78 },
          { topic: "nutrition", confidence: 1 },
          { topic: "cooking", confidence: 0.5 },
        ],
      },
    ]);

    const result = await generateProposals(mockPrisma as any);
    const orphanProposal = result.find(
      (p) => p.proposalType === "internal-link" && p.articleHandle === "black-rice-adobo-fried-rice"
    );

    expect(orphanProposal?.proposedState.fromArticle).toBe("rice-nutrition-breakdown");
    expect(orphanProposal?.sourceData.suggestedSource).toBe("rice-nutrition-breakdown");
  });

  it("generates a thin-content proposal for short articles with low SEO score", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "short-article",
        title: "Short Article",
        publishedAt: new Date("2025-01-01"),
        wordCount: 350,
        inboundCount: 1,
        internalLinkCount: 1,
        seoData: { score: 40, issues: ["missing-meta-description"] },
        topicsData: [],
      },
    ]);

    const result = await generateProposals(mockPrisma as any);
    const thinProposal = result.find((p) => p.proposalType === "content-refresh");
    expect(thinProposal).toBeDefined();
    expect(thinProposal?.articleHandle).toBe("short-article");
  });

  it("generates a missing-meta proposal for articles with that issue", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "no-meta",
        title: "No Meta Article",
        publishedAt: new Date("2025-03-01"),
        wordCount: 1000,
        inboundCount: 2,
        internalLinkCount: 3,
        seoData: { score: 65, issues: ["missing-meta-description"] },
        topicsData: [],
      },
    ]);

    const result = await generateProposals(mockPrisma as any);
    const metaProposal = result.find((p) => p.proposalType === "seo-fix");
    expect(metaProposal).toBeDefined();
    expect(metaProposal?.changeType).toBe("metadata");
  });

  it("sorts proposals by priority score descending", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "article-a",
        title: "Article A",
        publishedAt: new Date("2024-01-01"),
        wordCount: 300,
        inboundCount: 0,
        internalLinkCount: 0,
        seoData: { score: 30, issues: ["missing-meta-description"] },
        topicsData: [],
      },
    ]);

    const result = await generateProposals(mockPrisma as any);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.priorityScore).toBeGreaterThanOrEqual(result[i + 1]!.priorityScore);
    }
  });

  it("prefers normalized GSC rows over raw snapshots for quick-win proposals", async () => {
    const window = {
      dateRangeStart: new Date("2026-05-27T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-06-24T00:00:00.000Z"),
      capturedAt: new Date("2026-06-24T12:00:00.000Z"),
    };
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "black-rice-benefits",
        title: "Black Rice Benefits",
        publishedAt: new Date("2026-01-01"),
        wordCount: 1200,
        inboundCount: 2,
        internalLinkCount: 2,
        seoData: { score: 88, issues: [] },
        topicsData: [{ topic: "rice", confidence: 0.9 }],
      },
    ]);
    mockPrisma.gscQuery.findFirst.mockResolvedValue(window);
    mockPrisma.gscQuery.findMany.mockResolvedValue([
      {
        query: "organic black rice benefits",
        page: "https://agrikoph.com/blogs/news/black-rice-benefits",
        clicks: 1,
        impressions: 300,
        position: 9,
        ctr: 1 / 300,
      },
    ]);
    mockPrisma.rawSnapshot.findFirst.mockResolvedValue({
      payload: {
        topQueries: [
          {
            query: "stale raw keyword",
            clicks: 0,
            impressions: 10,
            position: "12.0",
          },
        ],
        pairs: [],
      },
    });

    const result = await generateProposals(mockPrisma as any);

    const quickWin = result.find((p) => p.title.includes("organic black rice benefits"));
    expect(quickWin).toMatchObject({
      articleHandle: "black-rice-benefits",
      proposalType: "seo-fix",
      changeType: "metadata",
    });
    expect(result.some((p) => p.title.includes("stale raw keyword"))).toBe(false);
    expect(result.some((p) => p.articleHandle == null && p.proposalType === "content-refresh")).toBe(false);
  });

  it("seeds counter-angle new-content proposals from the latest competitor-analysis insight", async () => {
    mockPrisma.skillInsight.findFirst.mockResolvedValue({
      id: "insight-1",
      items: [
        {
          competitor: "RiceCo",
          activeAdCount: 4,
          dominantFormat: "video",
          messagingThemes: ["health"],
          primaryCta: "Shop Now",
          recentLaunches7d: 2,
          gaps: ["no diabetic-friendly messaging"],
          recommendedTests: ["Diabetic-friendly black rice angle", "Athlete recovery angle"],
        },
      ],
    });

    const result = await generateProposals(mockPrisma as any);
    const competitorProposals = result.filter((p) => p.title.startsWith("Counter-angle:"));

    expect(competitorProposals).toHaveLength(2);
    for (const p of competitorProposals) {
      expect(p.proposalType).toBe("new-content");
      expect(p.changeType).toBe("new_article");
      expect(p.articleHandle).toBeNull();
      expect(p.proposedState.competitor).toBe("RiceCo");
      expect(p.description).toContain("RiceCo");
    }
    const targetKeywords = competitorProposals.map((p) => p.proposedState.targetKeyword);
    expect(new Set(targetKeywords).size).toBe(2);
  });

  it("produces zero competitor proposals when no competitor-analysis insight exists, without affecting other findings", async () => {
    mockPrisma.skillInsight.findFirst.mockResolvedValue(null);
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "no-meta",
        title: "No Meta Article",
        publishedAt: new Date("2025-03-01"),
        wordCount: 1000,
        inboundCount: 2,
        internalLinkCount: 3,
        seoData: { score: 65, issues: ["missing-meta-description"] },
        topicsData: [],
      },
    ]);

    const result = await generateProposals(mockPrisma as any);
    expect(result.some((p) => p.title.startsWith("Counter-angle:"))).toBe(false);
    expect(result.some((p) => p.proposalType === "seo-fix")).toBe(true);
  });

  it("seeds new-content proposals from open keyword_gap MarketInsights", async () => {
    mockPrisma.marketInsight.findMany.mockResolvedValue([
      {
        id: "mi-1",
        competitorId: "comp-1",
        evidence: {
          keyword: "organic black rice benefits",
          competitorDomain: "riceco.com",
          competitorPosition: 3,
          searchVolume: 1500,
        },
      },
      {
        id: "mi-2",
        competitorId: "comp-2",
        evidence: {
          keyword: "turmeric tea for inflammation",
          competitorDomain: "spicehub.com",
          competitorPosition: 7,
          searchVolume: 400,
        },
      },
    ]);

    const result = await generateProposals(mockPrisma as any);
    const gapProposals = result.filter((p) => p.title.startsWith("Keyword gap:"));

    expect(gapProposals).toHaveLength(2);
    for (const p of gapProposals) {
      expect(p.proposalType).toBe("new-content");
      expect(p.changeType).toBe("new_article");
      expect(p.articleHandle).toBeNull();
      expect(typeof p.proposedState.targetKeyword).toBe("string");
      expect(p.proposedState.targetKeyword).toBeTruthy();
    }

    const targetKeywords = gapProposals.map((p) => p.proposedState.targetKeyword);
    expect(new Set(targetKeywords).size).toBe(2);

    const highVolume = gapProposals.find((p) => p.proposedState.targetKeyword === "organic black rice benefits");
    expect(highVolume?.priority).toBe("high");
    const lowVolume = gapProposals.find((p) => p.proposedState.targetKeyword === "turmeric tea for inflammation");
    expect(lowVolume?.priority).toBe("medium");

    const sourceData = highVolume?.sourceData as Record<string, unknown>;
    expect(sourceData.marketInsightId).toBe("mi-1");
    expect(sourceData.competitorId).toBe("comp-1");
  });

  it("produces zero keyword-gap proposals when no open insights exist, without affecting other findings", async () => {
    mockPrisma.marketInsight.findMany.mockResolvedValue([]);
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "no-meta-2",
        title: "No Meta Article Two",
        publishedAt: new Date("2025-03-01"),
        wordCount: 1000,
        inboundCount: 2,
        internalLinkCount: 3,
        seoData: { score: 65, issues: ["missing-meta-description"] },
        topicsData: [],
      },
    ]);

    const result = await generateProposals(mockPrisma as any);
    expect(result.some((p) => p.title.startsWith("Keyword gap:"))).toBe(false);
    expect(result.some((p) => p.proposalType === "seo-fix")).toBe(true);
  });

  it("skips malformed keyword_gap evidence without throwing", async () => {
    mockPrisma.marketInsight.findMany.mockResolvedValue([
      { id: "mi-bad-1", competitorId: "comp-1", evidence: { competitorDomain: "riceco.com", competitorPosition: 3, searchVolume: 1500 } }, // missing keyword
      { id: "mi-bad-2", competitorId: "comp-1", evidence: { keyword: 42, competitorDomain: "riceco.com", competitorPosition: 3, searchVolume: 1500 } }, // wrong type keyword
      { id: "mi-bad-3", competitorId: "comp-1", evidence: { keyword: "valid keyword", competitorDomain: "riceco.com", competitorPosition: "3", searchVolume: 1500 } }, // wrong type position
      { id: "mi-bad-4", competitorId: "comp-1", evidence: null }, // null evidence
      { id: "mi-bad-5", competitorId: "comp-1", evidence: "not-an-object" }, // wrong evidence type
      {
        id: "mi-good",
        competitorId: "comp-1",
        evidence: { keyword: "good keyword", competitorDomain: "riceco.com", competitorPosition: 5, searchVolume: 300 },
      },
    ]);

    const result = await generateProposals(mockPrisma as any);
    const gapProposals = result.filter((p) => p.title.startsWith("Keyword gap:"));
    expect(gapProposals).toHaveLength(1);
    expect(gapProposals[0]?.proposedState.targetKeyword).toBe("good keyword");
  });
});
