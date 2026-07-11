import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  requirePermission: vi.fn(),
  getSessionShop: vi.fn(),
  getSessionUser: vi.fn(),
}));

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  articleRecord: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  contentProposal: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    findUnique: vi.fn(),
  },
  rawSnapshot: {
    upsert: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  keywordResearchResult: {
    findMany: vi.fn(),
  },
  marketKeyword: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
}));

const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockSeoData = vi.hoisted(() => ({
  getLatestGscData: vi.fn(),
  getLatestGa4Data: vi.fn(),
  getPreviousGscQueries: vi.fn(),
  getPreviousGscData: vi.fn(),
  getSeoHistoryTrend: vi.fn(),
}));
const mockGroundSeoBriefContext = vi.hoisted(() => vi.fn(async (content: string) => content));
const mockGetAiClient = vi.hoisted(() => vi.fn());
const mockChatCompletion = vi.hoisted(() => vi.fn());
const mockJobs = vi.hoisted(() => ({
  fetchSeoDataHandler: vi.fn(),
  fetchGscDataHandler: vi.fn(),
  snapshotSeoHistoryHandler: vi.fn(),
  acquireJobLock: vi.fn(),
  releaseJobLock: vi.fn(),
}));
const mockEnqueueJob = vi.hoisted(() => vi.fn());
const mockMaterializeJobsStatusSnapshot = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  requireAppAuth: mockAuth.requireAppAuth,
  requirePermission: mockAuth.requirePermission,
  getSessionShop: mockAuth.getSessionShop,
  getSessionUser: mockAuth.getSessionUser,
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/seo/data", () => mockSeoData);
vi.mock("@/lib/ai/client", () => ({ getAiClient: mockGetAiClient, chatCompletionWithFailover: mockChatCompletion }));
vi.mock("@/lib/seo/brief-grounding", () => ({ groundSeoBriefContext: mockGroundSeoBriefContext }));
vi.mock("@/jobs/fetch-seo-data", () => ({ fetchSeoDataHandler: mockJobs.fetchSeoDataHandler }));
vi.mock("@/jobs/fetch-gsc-data", () => ({ fetchGscDataHandler: mockJobs.fetchGscDataHandler }));
vi.mock("@/jobs/snapshot-seo-history", () => ({ snapshotSeoHistoryHandler: mockJobs.snapshotSeoHistoryHandler }));
vi.mock("@/lib/job-lock", () => ({
  acquireJobLock: mockJobs.acquireJobLock,
  releaseJobLock: mockJobs.releaseJobLock,
}));
vi.mock("@/lib/jobs/orchestrator", () => ({
  enqueueJob: (...args: Parameters<typeof mockEnqueueJob>) => mockEnqueueJob(...args),
}));
vi.mock("@/lib/dashboard/jobs-status", () => ({
  materializeJobsStatusSnapshot: (...args: Parameters<typeof mockMaterializeJobsStatusSnapshot>) => mockMaterializeJobsStatusSnapshot(...args),
}));

function jsonRequest(path: string, body: Record<string, unknown>, method = "POST") {
  return new Request(`http://test.local${path}`, {
    method,
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("SEO Pilot route regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.requirePermission.mockResolvedValue(null);
    mockAuth.getSessionShop.mockResolvedValue(null);
    mockAuth.getSessionUser.mockResolvedValue("api-key");
    mockCheckRateLimit.mockReturnValue(true);
    mockPrisma.$transaction.mockImplementation(async (cb) => cb(mockPrisma));
    mockPrisma.contentProposal.findMany.mockResolvedValue([]);
    mockPrisma.contentProposal.createMany.mockImplementation(async ({ data }) => { const p = await mockPrisma.contentProposal.create({ data: data[0] }); mockPrisma.contentProposal.findUnique.mockResolvedValue(p); return { count: 1 }; });
    mockPrisma.contentProposal.findUnique.mockResolvedValue({ id: "proposal-1" });
    mockPrisma.articleRecord.findMany.mockResolvedValue([]);
    mockPrisma.rawSnapshot.upsert.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.keywordResearchResult.findMany.mockResolvedValue([]);
    mockPrisma.marketKeyword.findFirst.mockResolvedValue(null);
    mockPrisma.marketKeyword.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.marketKeyword.create.mockResolvedValue({});
    mockPrisma.marketKeyword.update.mockResolvedValue({});
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [],
      pages: [],
      queryPagePairs: [],
      fetchedAt: null,
      source: "none",
      window: null,
    });
    mockSeoData.getSeoHistoryTrend.mockResolvedValue([]);
    mockSeoData.getPreviousGscQueries.mockResolvedValue([{ query: "previous", clicks: 1, impressions: 2, ctr: "50%", position: "5" }]);
    mockSeoData.getLatestGa4Data.mockResolvedValue({
      pages: [],
      fetchedAt: null,
      source: "none",
      window: null,
    });
    mockSeoData.getPreviousGscQueries.mockResolvedValue([]);
    mockSeoData.getPreviousGscData.mockImplementation(async () => {
      const queries = await mockSeoData.getPreviousGscQueries();
      return queries ? { queries, fetchedAt: new Date("2026-06-01T00:00:00.000Z"), dateRangeStart: new Date("2026-05-01T00:00:00.000Z"), dateRangeEnd: new Date("2026-05-31T00:00:00.000Z"), source: "rawSnapshot" } : null;
    });
    mockGetAiClient.mockResolvedValue({
      model: "test-model",
      client: {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: "- Improve titles on high-impression pages." } }],
            }),
          },
        },
      },
    });
    mockChatCompletion.mockResolvedValue({
      content: "- Improve titles on high-impression pages.",
      provider: "deepseek",
      model: "test-model",
    });
    mockJobs.acquireJobLock.mockResolvedValue(true);
    mockJobs.releaseJobLock.mockResolvedValue(undefined);
    mockEnqueueJob.mockResolvedValue({
      created: true,
      runId: "dashboard-run",
      status: "queued",
    });
    mockMaterializeJobsStatusSnapshot.mockResolvedValue(undefined);
  });

  it("rejects arbitrary non-SEO history sources", async () => {
    const { GET } = await import("@/app/api/seo/history/route");
    const res = await GET(new Request("http://test.local/api/seo/history?source=meta_ads") as NextRequest);
    expect(res.status).toBe(400);
    expect(mockSeoData.getSeoHistoryTrend).not.toHaveBeenCalled();
  });

  it("promotes missing meta as a publishable seo-fix proposal", async () => {
    mockPrisma.articleRecord.findUnique.mockResolvedValue({
      handle: "black-rice",
      title: "Black Rice Benefits",
      wordCount: 760,
    });
    mockPrisma.contentProposal.findFirst.mockResolvedValue(null);
    mockPrisma.contentProposal.create.mockResolvedValue({ id: "proposal-1" });
    const { POST } = await import("@/app/api/seo/promote/route");

    const res = await POST(jsonRequest("/api/seo/promote", {
      handle: "black-rice",
      title: "Client title ignored",
      issue: "missing-meta",
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ id: "proposal-1", existed: false });
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        articleHandle: "black-rice",
        proposalType: "seo-fix",
        title: "Fix meta: Black Rice Benefits",
        proposedState: expect.objectContaining({
          articleTitle: "Black Rice Benefits",
          targetQuery: "Black Rice Benefits",
        }),
      }),
    });
  });

  it("promotes missing H1 as a body refresh with add_h1 intent", async () => {
    mockPrisma.articleRecord.findUnique.mockResolvedValue({
      handle: "moringa",
      title: "Moringa Benefits",
      wordCount: 420,
    });
    mockPrisma.contentProposal.findFirst.mockResolvedValue(null);
    mockPrisma.contentProposal.create.mockResolvedValue({ id: "proposal-2" });
    const { POST } = await import("@/app/api/seo/promote/route");

    const res = await POST(jsonRequest("/api/seo/promote", {
      handle: "moringa",
      title: "Moringa Benefits",
      issue: "missing-h1",
    }));

    expect(res.status).toBe(200);
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        articleHandle: "moringa",
        proposalType: "content-refresh",
        title: "Add heading structure: Moringa Benefits",
        proposedState: expect.objectContaining({
          action: "add_h1",
          issue: "missing-h1",
          targetWordCount: 500,
        }),
      }),
    });
  });

  it("builds keyword status from normalized GSC data", async () => {
    mockPrisma.marketKeyword.findMany.mockResolvedValue([{ keyword: "black rice benefits" }]);
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [{ query: "black rice benefits", clicks: 12, impressions: 400, ctr: "3.0%", position: "8.1" }],
      pages: [],
      queryPagePairs: [],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    mockSeoData.getPreviousGscQueries.mockResolvedValue([
      { query: "black rice benefits", clicks: 8, impressions: 300, ctr: "2.7%", position: "12.5" },
    ]);
    const { GET } = await import("@/app/api/seo/keywords/route");

    const res = await GET(new Request("http://test.local/api/seo/keywords") as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.keywords).toEqual([
      expect.objectContaining({
        keyword: "black rice benefits",
        position: 8.1,
        clicks: 12,
        impressions: 400,
        status: "improved",
      }),
    ]);
    expect(mockSeoData.getLatestGscData).toHaveBeenCalled();
  });

  it("rejects malformed content-gap promotions before DB writes", async () => {
    const { POST } = await import("@/app/api/seo/gaps/promote/route");

    const res = await POST(jsonRequest("/api/seo/gaps/promote", {
      gaps: [{ query: "x", suggestedTitle: "short" }],
    }));

    expect(res.status).toBe(400);
    expect(mockPrisma.contentProposal.create).not.toHaveBeenCalled();
  });

  it("does not report already-covered GSC queries as new content gaps", async () => {
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [
        { query: "black rice benefits", clicks: 3, impressions: 320, ctr: "0.9%", position: "8.0" },
        { query: "moringa tea recipe", clicks: 1, impressions: 180, ctr: "0.6%", position: "12.0" },
      ],
      pages: [],
      queryPagePairs: [
        {
          query: "black rice benefits",
          page: "https://agrikoph.com/blogs/news/black-rice-benefits",
          clicks: 3,
          impressions: 320,
          position: "8.0",
        },
      ],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "black-rice-benefits",
        title: "Black Rice Benefits",
        wordCount: 900,
        internalLinkCount: 2,
        seoData: { seoTitle: "Black Rice Benefits", seoDescription: "A complete guide." },
      },
    ]);
    const { POST } = await import("@/app/api/seo/analyze/route");

    const res = await POST(new Request("http://test.local/api/seo/analyze", { method: "POST" }) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.analysis.limits).toEqual({
      queriesTotal: 2,
      queriesAnalyzed: 2,
      articlesTotalLowerBound: 1,
      articlesAnalyzed: 1,
      articlesTruncated: false,
    });
    expect(body.analysis.contentGaps).toEqual([
      expect.objectContaining({
        query: "moringa tea recipe",
        suggestedTitle: "Moringa tea recipe: Benefits, Uses & Complete Guide",
      }),
    ]);
    expect(body.analysis.contentGaps).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ query: "black rice benefits" })])
    );
  });

  it("filters AI strategy bullets to grounded items and returns evidence for each visible item", async () => {
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [
        { query: "black rice benefits", clicks: 3, impressions: 320, ctr: "0.9%", position: "8.0" },
      ],
      pages: [],
      queryPagePairs: [],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "black-rice-benefits",
        title: "Black Rice Benefits",
        wordCount: 220,
        internalLinkCount: 0,
        seoData: { seoTitle: "", seoDescription: "" },
      },
    ]);
    mockChatCompletion.mockResolvedValue({ content: JSON.stringify({
                    summary: "Black Rice Benefits needs basic SEO cleanup.",
                    quickWins: [
                      "Expand Black Rice Benefits and fix its missing meta description.",
                      "Launch a celebrity recipe hub for keto smoothies.",
                    ],
                    recommendations: [
                      "Target the black rice benefits query with a better SERP snippet.",
                      "Build an unrelated backlink campaign for luxury watches.",
                    ],
                  }), provider: "deepseek", model: "test-model" });
    const { POST } = await import("@/app/api/seo/analyze/route");

    const res = await POST(new Request("http://test.local/api/seo/analyze", { method: "POST" }) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.analysis.quickWins).toEqual([
      "Expand Black Rice Benefits and fix its missing meta description.",
    ]);
    expect(body.analysis.quickWinEvidence).toEqual([
      expect.stringContaining("Black Rice Benefits"),
    ]);
    expect(body.analysis.recommendations).toEqual([
      "Target the black rice benefits query with a better SERP snippet.",
    ]);
    expect(body.analysis.recommendationEvidence).toEqual([
      expect.stringContaining("black rice benefits"),
    ]);
    expect(JSON.stringify(body.analysis)).not.toContain("celebrity recipe hub");
    expect(JSON.stringify(body.analysis)).not.toContain("luxury watches");
  });

  it("preserves deterministic meta, thin-content, and internal-link findings when AI fails", async () => {
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [{ query: "black rice benefits", clicks: 3, impressions: 320, ctr: "0.9%", position: "8.0" }],
      pages: [],
      queryPagePairs: [],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      { handle: "black-rice", title: "Black Rice", wordCount: 220, internalLinkCount: 0, seoData: { seoTitle: "", seoDescription: "" } },
    ]);
    mockChatCompletion.mockRejectedValue(new Error("network unavailable"));
    const { POST } = await import("@/app/api/seo/analyze/route");

    const res = await POST(new Request("http://test.local/api/seo/analyze", { method: "POST" }) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.analysis.aiStatus).toBe("partial");
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(body.analysis.quickWins).toEqual(expect.arrayContaining([
      expect.stringMatching(/missing meta/i),
      expect.stringMatching(/thin content/i),
      expect.stringMatching(/internal link/i),
    ]));
    expect(body.analysis.quickWinEvidence).toHaveLength(body.analysis.quickWins.length);
    expect(mockPrisma.rawSnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ payload: expect.objectContaining({ aiStatus: "partial" }), fetchedAt: new Date(body.generatedAt) }),
      create: expect.objectContaining({ fetchedAt: new Date(body.generatedAt) }),
    }));
  });

  it("promotes analyzed missing-meta gaps as seo-fix proposals", async () => {
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [{ query: "black rice", clicks: 1, impressions: 200, ctr: "0.5%", position: "8.0" }],
      pages: [],
      queryPagePairs: [],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    mockPrisma.articleRecord.findMany.mockResolvedValue([{ handle: "black-rice-benefits", title: "Black Rice Benefits", wordCount: 760 }]);
    mockPrisma.contentProposal.create.mockResolvedValue({ id: "proposal-3", title: "Improve SERP snippet: Black Rice Benefits" });
    const { POST } = await import("@/app/api/seo/gaps/promote/route");

    const res = await POST(jsonRequest("/api/seo/gaps/promote", {
      gaps: [{
        query: "black rice",
        impressions: 200,
        position: 8,
        suggestedTitle: "Client Supplied Title",
        issue: "missing-meta",
        articleHandle: "black-rice-benefits",
      }],
    }));

    expect(res.status).toBe(200);
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposalType: "seo-fix",
        articleHandle: "black-rice-benefits",
        title: "Improve SERP snippet: Black Rice Benefits",
        proposedState: expect.objectContaining({
          targetQuery: "black rice",
          articleHandle: "black-rice-benefits",
        }),
      }),
    });
  });


  it("does not promote client-supplied SEO fix handles that do not exist server-side", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([]);
    const { POST } = await import("@/app/api/seo/gaps/promote/route");

    const res = await POST(jsonRequest("/api/seo/gaps/promote", {
      gaps: [{
        query: "black rice",
        impressions: 200,
        position: 8,
        suggestedTitle: "Black Rice Benefits",
        issue: "missing-meta",
        articleHandle: "ghost-handle",
      }],
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      created: 0,
      skipped: 1,
      skippedReasons: expect.objectContaining({ missingArticle: 1 }),
    }));
    expect(mockPrisma.contentProposal.create).not.toHaveBeenCalled();
  });

  it("promotes existing blog-page CTR opportunities as seo-fix proposals", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([{ handle: "black-rice-benefits", title: "Black Rice Benefits", wordCount: 760 }]);
    mockPrisma.contentProposal.create.mockResolvedValue({ id: "proposal-4", title: "Improve SERP snippet: Black Rice: A Complete Guide" });
    const { POST } = await import("@/app/api/seo/gaps/promote/route");

    const res = await POST(jsonRequest("/api/seo/gaps/promote", {
      gaps: [{
        query: "black rice",
        impressions: 300,
        position: 6,
        suggestedTitle: "Black Rice: A Complete Guide",
        type: "low_ctr",
        page: "https://agrikoph.com/blogs/news/black-rice-benefits",
      }],
    }));

    expect(res.status).toBe(200);
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposalType: "seo-fix",
        articleHandle: "black-rice-benefits",
      }),
    });
  });

  it("retains landing-page attribution when the matching pair is beyond the display limit", async () => {
    const filler = Array.from({ length: 50 }, (_, index) => ({
      query: `filler ${index}`,
      page: `https://agrikoph.com/blogs/news/filler-${index}`,
      clicks: 0,
      impressions: 1000 - index,
      position: "8.0",
    }));
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [{ query: "target query", clicks: 0, impressions: 200, ctr: "0%", position: "8.0" }],
      pages: [],
      queryPagePairs: [...filler, {
        query: "target query",
        page: "https://agrikoph.com/blogs/news/target-article",
        clicks: 0,
        impressions: 200,
        position: "8.0",
      }],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    const { GET } = await import("@/app/api/seo/route");

    const res = await GET(new Request("http://test.local/api/seo") as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.trends.previousFetchedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(body.opportunities.find((row: { query: string }) => row.query === "target query"))
      .toEqual(expect.objectContaining({
        page: "https://agrikoph.com/blogs/news/target-article",
      }));
    expect(body.limits).toEqual({
      queryPagePairsTotal: 51,
      queryPagePairsReturned: 50,
      queryPagePairsTruncated: true,
    });
  });

  it("returns complete GSC freshness in summary and full SEO responses", async () => {
    const freshness = {
      selectedSource: "rawSnapshot",
      selectedCapturedAt: new Date("2026-07-10T03:00:00.000Z"),
      selectedDateRangeStart: new Date("2026-06-10T00:00:00.000Z"),
      selectedDateRangeEnd: new Date("2026-07-08T00:00:00.000Z"),
      normalizedCapturedAt: new Date("2026-07-08T03:00:00.000Z"),
      normalizedDateRangeStart: new Date("2026-06-08T00:00:00.000Z"),
      normalizedDateRangeEnd: new Date("2026-07-06T00:00:00.000Z"),
      rawCapturedAt: new Date("2026-07-10T03:00:00.000Z"),
      rawDateRangeStart: new Date("2026-06-10T00:00:00.000Z"),
      rawDateRangeEnd: new Date("2026-07-08T00:00:00.000Z"),
      fallbackReason: "raw_newer_than_normalized",
    };
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [],
      pages: [],
      queryPagePairs: [],
      fetchedAt: freshness.selectedCapturedAt,
      source: "rawSnapshot",
      window: null,
      freshness,
    });
    mockSeoData.getLatestGa4Data.mockResolvedValue({
      pages: [],
      fetchedAt: null,
      source: "none",
      freshness: {
        selectedSource: "none",
        selectedCapturedAt: null,
        normalizedCapturedAt: null,
        rawCapturedAt: null,
        fallbackReason: null,
      },
    });
    const { GET } = await import("@/app/api/seo/route");

    const summary = await GET(new Request("http://test.local/api/seo?view=summary&refresh=1") as NextRequest);
    const full = await GET(new Request("http://test.local/api/seo") as NextRequest);

    expect((await summary.json()).gscFreshness).toEqual(JSON.parse(JSON.stringify(freshness)));
    expect((await full.json()).gscFreshness).toEqual(JSON.parse(JSON.stringify(freshness)));
  });

  it("promotes mapped striking-distance work as an expandable content refresh", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([{ handle: "target-article", title: "Target Article", wordCount: 760 }]);
    mockPrisma.contentProposal.create.mockResolvedValue({ id: "proposal-5", title: "Expand thin content: Target Article" });
    const { POST } = await import("@/app/api/seo/gaps/promote/route");

    const res = await POST(jsonRequest("/api/seo/gaps/promote", {
      gaps: [{
        query: "target query",
        impressions: 300,
        position: 12,
        suggestedTitle: "Target Article",
        type: "striking_distance",
        page: "https://agrikoph.com/blogs/news/target-article",
      }],
    }));

    expect(res.status).toBe(200);
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposalType: "content-refresh",
        articleHandle: "target-article",
        proposedState: expect.objectContaining({ action: "expand" }),
      }),
    });
  });


  it("keys opportunity promotion state by query, page, and type", () => {
    // opportunityKey's definition moved to components/types.ts during the
    // Phase 8c page split; page.tsx now imports and calls it.
    const typesSource = readFileSync("app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts", "utf8");
    const pageSource = readFileSync("app/(embedded)/(seo-pillar)/seo-pillar/page.tsx", "utf8");

    expect(typesSource).toContain("export const opportunityKey =");
    expect(typesSource).toContain(`o.query, o.page ?? "", o.type`);
    expect(pageSource).toContain("opportunityKey(o)");
    expect(pageSource).not.toContain("promotedOpp.has(o.query)");
    expect(pageSource).not.toContain("promotingOpp.has(o.query)");
  });

  it("removes skipped SEO promote results from the actionable UI queues", () => {
    const pageSource = readFileSync("app/(embedded)/(seo-pillar)/seo-pillar/page.tsx", "utf8");

    expect(pageSource).toContain("d.created > 0 || d.skipped > 0");
    expect(pageSource).toContain("const visibleOpportunities = (data?.opportunities ?? []).filter((o) => !promotedOpp.has(opportunityKey(o)))");
    expect(pageSource).toContain("const gaps = (analysis?.contentGaps ?? []).filter((g) => !promoted.has(gapKey(g)))");
    expect(pageSource).toContain("removed from this view");
    expect(pageSource).not.toContain("d.skippedReasons?.duplicate > 0");
    expect(pageSource).not.toContain("const unpromotedGaps =");
  });

  it("returns retryable error when SEO brief output is blank", async () => {
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [{ query: "black rice", clicks: 3, impressions: 200, ctr: "1.5%", position: "7.0" }],
      pages: [],
      queryPagePairs: [],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    mockSeoData.getLatestGa4Data.mockResolvedValue({
      pages: [{ page: "/blogs/news/black-rice", sessions: 20 }],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    // The failover helper trims + extracts content; a blank brief arrives as "".
    mockChatCompletion.mockResolvedValue({ content: "", provider: "deepseek", model: "test-model" });
    const { POST } = await import("@/app/api/seo/brief/route");

    const res = await POST(new Request("http://test.local/api/seo/brief", { method: "POST" }) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body).toEqual({ error: "AI returned an empty brief - please retry" });
  });

  it("accepts SEO brief reasoning content when final content is blank", async () => {
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [{ query: "black rice", clicks: 3, impressions: 200, ctr: "1.5%", position: "7.0" }],
      pages: [],
      queryPagePairs: [],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    mockSeoData.getLatestGa4Data.mockResolvedValue({
      pages: [{ page: "/blogs/news/black-rice", sessions: 20 }],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    // The helper resolves reasoning_content into `content` when final content is
    // blank; the route just consumes the returned content.
    mockChatCompletion.mockResolvedValue({ content: "- Improve black rice snippets.", provider: "deepseek", model: "test-model" });
    const { POST } = await import("@/app/api/seo/brief/route");

    const res = await POST(new Request("http://test.local/api/seo/brief", { method: "POST" }) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ brief: "- Improve black rice snippets." });
    expect(mockChatCompletion).toHaveBeenCalled();
  });

  it("returns actionable error when SEO brief provider config fails", async () => {
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [{ query: "mushroom chicharon", clicks: 5, impressions: 300, ctr: "1.7%", position: "6.5" }],
      pages: [],
      queryPagePairs: [],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    mockSeoData.getLatestGa4Data.mockResolvedValue({
      pages: [{ page: "/products/mushroom-chicharon", sessions: 30 }],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    mockChatCompletion.mockRejectedValue(new Error("No AI provider configured"));
    const { POST } = await import("@/app/api/seo/brief/route");

    const res = await POST(new Request("http://test.local/api/seo/brief", { method: "POST" }) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({
      status: 503,
      error: "AI provider is not configured",
      detail: "Set a valid DeepSeek or OpenRouter API key, then retry SEO brief generation.",
    });
  });

  it("passes deterministic GSC query and GA4 page metrics into brief grounding context", async () => {
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [{
        query: "black rice",
        clicks: 12,
        impressions: 400,
        ctr: "3.4%",
        position: "8.2",
      }],
      pages: [],
      queryPagePairs: [],
      fetchedAt: new Date("2026-06-01T00:00:00.000Z"),
      source: "normalized",
      window: null,
    });
    mockSeoData.getLatestGa4Data.mockResolvedValue({
      pages: [{
        page: "/blogs/news/black-rice-benefits",
        sessions: 52,
        bounceRate: "0.38",
        conversionRate: "0.02",
      }],
      fetchedAt: new Date("2026-06-01T00:00:00.000Z"),
      source: "normalized",
      freshness: {
        selectedSource: "normalized",
        selectedCapturedAt: new Date("2026-06-01T00:00:00.000Z"),
        normalizedCapturedAt: new Date("2026-06-01T00:00:00.000Z"),
        rawCapturedAt: null,
        fallbackReason: null,
      },
    });

    const { POST } = await import("@/app/api/seo/brief/route");

    const res = await POST(new Request("http://test.local/api/seo/brief", { method: "POST" }) as NextRequest);
    await res.json();

    const prompt = mockGroundSeoBriefContext.mock.calls.at(-1)?.[0] ?? "";
    expect(prompt).toContain("black rice");
    expect(prompt).toContain("clicks: 12");
    expect(prompt).toContain("impressions: 400");
    expect(prompt).toContain("ctr: 3.4%");
    expect(prompt).toContain("position: 8.2");
    expect(prompt).toContain("Top pages");
    expect(prompt).toContain("sessions: 52");
    expect(prompt).toContain("bounce: 0.38");
    expect(prompt).toContain("conversion: 0.02");
    expect(mockGroundSeoBriefContext).toHaveBeenCalledTimes(1);
  });

  it("does not expose raw provider failures from SEO brief generation", async () => {
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [{ query: "black rice", clicks: 3, impressions: 200, ctr: "1.5%", position: "7.0" }],
      pages: [], queryPagePairs: [], fetchedAt: new Date("2026-06-01T00:00:00Z"), source: "normalized", window: null,
    });
    mockSeoData.getLatestGa4Data.mockResolvedValue({ pages: [], fetchedAt: null, source: "none", window: null });
    mockChatCompletion.mockRejectedValue(new Error("provider response: Bearer secret-value"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/seo/brief/route");

    const res = await POST(new Request("http://test.local/api/seo/brief", { method: "POST" }) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ status: 503, error: "Brief generation temporarily unavailable", detail: "Check the AI provider status and retry SEO brief generation." });
    expect(JSON.stringify(body)).not.toContain("secret-value");
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("secret-value");
    errorSpy.mockRestore();
  });

  it("blocks a user without CONTENT_REVIEW before SEO keyword persistence", async () => {
    mockAuth.requirePermission.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const { POST } = await import("@/app/api/seo/keywords/route");

    const res = await POST(jsonRequest("/api/seo/keywords", { keyword: "black rice" }));

    expect(res.status).toBe(403);
    expect(mockPrisma.marketKeyword.create).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("blocks a user without CONTENT_REVIEW before SEO keyword deletion", async () => {
    mockAuth.requirePermission.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const { DELETE } = await import("@/app/api/seo/keywords/route");

    const res = await DELETE(jsonRequest("/api/seo/keywords", { keyword: "black rice" }, "DELETE"));

    expect(res.status).toBe(403);
    expect(mockPrisma.marketKeyword.updateMany).not.toHaveBeenCalled();
  });

  it("blocks a user without CONTENT_REVIEW before queueing an SEO refresh", async () => {
    mockAuth.requirePermission.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const { POST } = await import("@/app/api/seo/refresh/route");

    const res = await POST(new Request("http://test.local/api/seo/refresh", { method: "POST" }) as NextRequest);

    expect(res.status).toBe(403);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("blocks a user without CONTENT_REVIEW before SEO brief data or AI work", async () => {
    mockAuth.requirePermission.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const { POST } = await import("@/app/api/seo/brief/route");

    const res = await POST(new Request("http://test.local/api/seo/brief", { method: "POST" }) as NextRequest);

    expect(res.status).toBe(403);
    expect(mockSeoData.getLatestGscData).not.toHaveBeenCalled();
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });


  it("skips existing non-blog page opportunities instead of creating new articles", async () => {
    const { POST } = await import("@/app/api/seo/gaps/promote/route");

    const res = await POST(jsonRequest("/api/seo/gaps/promote", {
      gaps: [{
        query: "black rice",
        impressions: 300,
        position: 6,
        suggestedTitle: "Black Rice Product Page",
        type: "low_ctr",
        page: "https://agrikoph.com/products/black-rice",
      }],
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      created: 0,
      skipped: 1,
      skippedReasons: expect.objectContaining({ nonBlogExistingPage: 1 }),
    }));
    expect(mockPrisma.contentProposal.create).not.toHaveBeenCalled();
  });

  it("bulk-decomposes stale missing-meta records using analyze-compatible meta signals", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "stale-meta-fields",
        title: "Stale Meta Fields",
        wordCount: 700,
        seoData: {
          metaTitle: "Legacy title",
          metaDescription: "Legacy description",
          seoTitle: "",
          seoDescription: "",
        },
      },
      {
        handle: "missing-meta-code",
        title: "Missing Meta Code",
        wordCount: 650,
        seoData: {
          metaTitle: "Legacy title",
          metaDescription: "Legacy description",
          issues: ["missing_meta"],
        },
      },
      {
        handle: "complete-meta",
        title: "Complete Meta",
        wordCount: 800,
        seoData: {
          metaTitle: "Complete meta title",
          metaDescription: "Complete meta description",
          seoTitle: "Complete meta title",
          seoDescription: "Complete meta description",
        },
      },
    ]);
    mockPrisma.contentProposal.create.mockImplementation(async ({ data }) => ({
      id: `proposal-${String(data.articleHandle)}`,
      title: data.title,
      proposalType: data.proposalType,
    }));
    const { POST } = await import("@/app/api/seo/recommendations/decompose/route");

    const res = await POST(jsonRequest("/api/seo/recommendations/decompose", {
      recommendation: "Create systematic meta titles and descriptions for all articles",
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ created: 2, skipped: 0, dropped: 0 }));
    expect(mockPrisma.articleRecord.findMany).toHaveBeenCalledWith(expect.not.objectContaining({ take: expect.anything() }));
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposalType: "seo-fix",
        articleHandle: "stale-meta-fields",
        title: "Fix meta: Stale Meta Fields",
      }),
    });
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposalType: "seo-fix",
        articleHandle: "missing-meta-code",
        title: "Fix meta: Missing Meta Code",
      }),
    });
  });

  it("does not recreate rejected decomposed recommendations for the same article action under a new title", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "black-rice-benefits",
        title: "Black Rice Benefits",
        wordCount: 700,
        seoData: { seoTitle: "", seoDescription: "" },
      },
    ]);
    mockChatCompletion.mockResolvedValue({ content: JSON.stringify([
                    {
                      type: "seo-fix",
                      title: "Improve the Black Rice Benefits SERP snippet",
                      articleHandle: "black-rice-benefits",
                      targetQuery: "black rice benefits",
                    },
                  ]), provider: "deepseek", model: "test-model" });
    mockPrisma.contentProposal.findMany.mockResolvedValue([
      {
        articleHandle: "black-rice-benefits",
        proposalType: "seo-fix",
        title: "Rejected previous meta task",
        proposedState: { targetQuery: "black rice benefits" },
      },
    ]);
    const { POST } = await import("@/app/api/seo/recommendations/decompose/route");

    const res = await POST(jsonRequest("/api/seo/recommendations/decompose", {
      recommendation: "Improve the Black Rice Benefits SERP metadata",
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ created: 0, skipped: 1 }));
    expect(mockPrisma.contentProposal.create).not.toHaveBeenCalled();
  });

  it("normalizes tracked keywords before persistence", async () => {
    const { POST } = await import("@/app/api/seo/keywords/route");

    const res = await POST(jsonRequest("/api/seo/keywords", { keyword: "  Black   Rice Benefits  " }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.keyword).toBe("black rice benefits");
    expect(mockPrisma.marketKeyword.create).toHaveBeenCalledWith({ data: { keyword: "black rice benefits", category: "seo", languageCode: "en", active: true } });
  });

  it("deactivates matching tracked keywords on DELETE", async () => {
    const { DELETE } = await import("@/app/api/seo/keywords/route");

    const res = await DELETE(jsonRequest("/api/seo/keywords", { keyword: "  Black   Rice Benefits  " }, "DELETE"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, keyword: "black rice benefits" });
    expect(mockPrisma.marketKeyword.updateMany).toHaveBeenCalledWith({
      where: {
        keyword: { equals: "black rice benefits", mode: "insensitive" },
        category: "seo",
        languageCode: "en",
        locationName: null,
        active: true,
      },
      data: { active: false },
    });
  });

  it("returns 404 when no active SEO keyword exists to untrack", async () => {
    mockPrisma.marketKeyword.updateMany.mockResolvedValue({ count: 0 });
    const { DELETE } = await import("@/app/api/seo/keywords/route");

    const res = await DELETE(jsonRequest("/api/seo/keywords", { keyword: "missing keyword" }, "DELETE"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Keyword not currently tracked" });
  });

  it("recovers concurrent tracked-keyword inserts", async () => {
    const { POST } = await import("@/app/api/seo/keywords/route");
    mockPrisma.marketKeyword.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    mockPrisma.marketKeyword.findFirst.mockResolvedValue({ id: "winner" });
    const res = await POST(jsonRequest("/api/seo/keywords", { keyword: " Black   Rice Benefits " }));
    expect(await res.json()).toEqual({ ok: true, keyword: "black rice benefits" });
    expect(mockPrisma.marketKeyword.update).toHaveBeenCalledWith({ where: { id: "winner" }, data: { active: true, category: "seo" } });
  });

  it("queues SEO refresh work instead of running fetch handlers inline", async () => {
    const { POST } = await import("@/app/api/seo/refresh/route");

    const res = await POST(new Request("http://test.local/api/seo/refresh", { method: "POST" }) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      queued: true,
      alreadyQueued: false,
      runId: "dashboard-run",
      status: "queued",
      jobName: "dashboard-refresh",
    }));
    expect(mockCheckRateLimit).toHaveBeenCalledWith("seo-refresh:api-key", 3, 60_000);
    expect(mockEnqueueJob).toHaveBeenCalledWith({ jobName: "dashboard-refresh", triggeredBy: "api-key" });
    expect(mockJobs.fetchSeoDataHandler).not.toHaveBeenCalled();
    expect(mockJobs.fetchGscDataHandler).not.toHaveBeenCalled();
    expect(mockJobs.snapshotSeoHistoryHandler).not.toHaveBeenCalled();
  });
});
