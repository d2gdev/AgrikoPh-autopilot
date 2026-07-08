import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    marketKeyword: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    keywordResearchResult: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    rawSnapshot: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/connectors/google-ads", () => ({
  fetchGoogleAdsKeywordResearch: vi.fn(),
  fetchGoogleAdsKeywordIdeas: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { fetchGoogleAdsKeywordResearch, fetchGoogleAdsKeywordIdeas } from "@/lib/connectors/google-ads";
import { fetchKeywordResearchHandler } from "@/jobs/fetch-keyword-research";

const mockPrisma = prisma as unknown as {
  jobRun: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  marketKeyword: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  keywordResearchResult: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  rawSnapshot: {
    upsert: ReturnType<typeof vi.fn>;
  };
};

const mockFetchResearch = fetchGoogleAdsKeywordResearch as ReturnType<typeof vi.fn>;
const mockFetchIdeas = fetchGoogleAdsKeywordIdeas as ReturnType<typeof vi.fn>;

describe("fetchKeywordResearchHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("MARKET_INTEL_KEYWORD_IDEAS_LIMIT", "0");

    mockPrisma.jobRun.create.mockResolvedValue({ id: "run-1" });
    mockPrisma.jobRun.findUnique.mockResolvedValue({ id: "run-1", jobName: "fetch-keyword-research" });
    mockPrisma.jobRun.update.mockResolvedValue({});
    mockPrisma.marketKeyword.findMany.mockResolvedValue([
      {
        id: "kw-1",
        keyword: "organic black rice philippines",
        locationName: "Philippines",
        languageCode: "en",
        createdAt: new Date("2026-06-01T00:00:00Z"),
        active: true,
      },
    ]);
    mockPrisma.keywordResearchResult.findMany.mockResolvedValue([]);
    mockPrisma.rawSnapshot.upsert.mockResolvedValue({});
    mockFetchIdeas.mockResolvedValue({ disabled: false, results: [] });
  });

  it("creates a new row when no duplicate exists", async () => {
    mockPrisma.keywordResearchResult.findUnique.mockResolvedValue(null);
    mockPrisma.keywordResearchResult.upsert.mockResolvedValue({ id: "new-row" });
    mockFetchResearch.mockResolvedValue({
      disabled: false,
      results: [
        {
          keyword: "organic black rice philippines",
          closeVariants: [],
          avgMonthlySearches: 10,
          competition: "LOW",
          competitionIndex: 12,
          lowTopOfPageBidMicros: "1000000",
          highTopOfPageBidMicros: "2000000",
          monthlySearchVolumes: [],
          rawPayload: { ok: true },
        },
      ],
    });

    const result = await fetchKeywordResearchHandler();

    expect(mockPrisma.keywordResearchResult.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrisma.keywordResearchResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.anything(),
        create: expect.objectContaining({
          keyword: "organic black rice philippines",
          source: "google_ads",
          jobRunId: "run-1",
        }),
      }),
    );
    expect(result.status).toBe("success");
    expect(result.summary.researchRowsStored).toBe(1);
    expect(result.summary.researchRowsCreated).toBe(1);
    expect(result.summary.researchRowsUpdated).toBe(0);
  });

  it("updates an existing same-day keyword research row via upsert", async () => {
    mockPrisma.keywordResearchResult.findUnique.mockResolvedValue({ id: "existing-row" });
    mockPrisma.keywordResearchResult.upsert.mockResolvedValue({ id: "existing-row" });
    mockFetchResearch.mockResolvedValue({
      disabled: false,
      results: [
        {
          keyword: "organic black rice philippines",
          closeVariants: [],
          avgMonthlySearches: 10,
          competition: "LOW",
          competitionIndex: 12,
          lowTopOfPageBidMicros: "1000000",
          highTopOfPageBidMicros: "2000000",
          monthlySearchVolumes: [],
          rawPayload: { ok: true },
        },
      ],
    });

    const result = await fetchKeywordResearchHandler();

    expect(mockPrisma.keywordResearchResult.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrisma.keywordResearchResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source_keyword_locationNameForDedupe_languageCodeForDedupe_captureDate: expect.objectContaining({
            source: "google_ads",
            keyword: "organic black rice philippines",
          }),
        }),
        update: expect.objectContaining({
          keyword: "organic black rice philippines",
          source: "google_ads",
          jobRunId: "run-1",
        }),
      }),
    );
    expect(result.status).toBe("success");
    expect(result.summary.researchRowsStored).toBe(1);
    expect(result.summary.researchRowsCreated).toBe(0);
    expect(result.summary.researchRowsUpdated).toBe(1);
  });

  it("upserts a keyword_research RawSnapshot for skill evidence", async () => {
    mockPrisma.marketKeyword.findMany.mockResolvedValue([{ id: "seed-1", keyword: "organic rice", active: true }]);
    mockPrisma.keywordResearchResult.findUnique.mockResolvedValue(null);
    mockPrisma.keywordResearchResult.findMany.mockResolvedValue([
      {
        keyword: "organic rice",
        avgMonthlySearches: 900,
        competition: "MEDIUM",
        competitionIndex: 55,
      },
    ]);
    mockFetchResearch.mockResolvedValue({
      disabled: false,
      results: [{
        keyword: "organic rice",
        closeVariants: [],
        avgMonthlySearches: 900,
        competition: "MEDIUM",
        competitionIndex: 55,
        lowTopOfPageBidMicros: null,
        highTopOfPageBidMicros: null,
        monthlySearchVolumes: [],
        rawPayload: {},
      }],
    });

    await fetchKeywordResearchHandler({ runId: "run-1" });

    expect(mockPrisma.rawSnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        source_dateRangeStart_dateRangeEnd: expect.objectContaining({ source: "keyword_research" }),
      }),
      create: expect.objectContaining({
        source: "keyword_research",
        jobRunId: "run-1",
        payload: expect.objectContaining({
          keywords: [expect.objectContaining({ keyword: "organic rice", avgMonthlySearches: 900 })],
        }),
      }),
    }));
  });
});
