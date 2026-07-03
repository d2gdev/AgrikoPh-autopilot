import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      create: vi.fn(),
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
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/connectors/dataforseo-keywords", () => ({
  fetchSearchVolume: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { fetchSearchVolume } from "@/lib/connectors/dataforseo-keywords";
import { fetchKeywordResearchHandler } from "@/jobs/fetch-keyword-research";

const mockPrisma = prisma as unknown as {
  jobRun: {
    create: ReturnType<typeof vi.fn>;
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
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const mockFetchSearchVolume = fetchSearchVolume as ReturnType<typeof vi.fn>;

describe("fetchKeywordResearchHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    mockPrisma.jobRun.create.mockResolvedValue({ id: "run-1" });
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
  });

  it("creates a new row when no duplicate exists", async () => {
    mockPrisma.keywordResearchResult.findUnique.mockResolvedValue(null);
    mockPrisma.keywordResearchResult.upsert.mockResolvedValue({ id: "new-row" });
    mockFetchSearchVolume.mockResolvedValue({
      disabled: false,
      volumes: new Map([["organic black rice philippines", 10]]),
    });

    const result = await fetchKeywordResearchHandler();

    expect(mockPrisma.keywordResearchResult.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrisma.keywordResearchResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.anything(),
        create: expect.objectContaining({
          keyword: "organic black rice philippines",
          source: "dataforseo",
          jobRunId: "run-1",
          avgMonthlySearches: 10,
          competition: null,
          competitionIndex: null,
          lowTopOfPageBidMicros: null,
          highTopOfPageBidMicros: null,
        }),
      }),
    );
    expect(result.status).toBe("success");
    expect(result.summary.researchRowsStored).toBe(1);
    expect(result.summary.researchRowsCreated).toBe(1);
    expect(result.summary.researchRowsUpdated).toBe(0);
    expect(result.summary.ideaRowsStored).toBe(0);
    expect(result.summary.keywordsPromoted).toBe(0);
  });

  it("updates an existing same-day keyword research row via upsert", async () => {
    mockPrisma.keywordResearchResult.findUnique.mockResolvedValue({ id: "existing-row" });
    mockPrisma.keywordResearchResult.upsert.mockResolvedValue({ id: "existing-row" });
    mockFetchSearchVolume.mockResolvedValue({
      disabled: false,
      volumes: new Map([["organic black rice philippines", 10]]),
    });

    const result = await fetchKeywordResearchHandler();

    expect(mockPrisma.keywordResearchResult.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrisma.keywordResearchResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source_keyword_locationNameForDedupe_languageCodeForDedupe_captureDate: expect.objectContaining({
            source: "dataforseo",
            keyword: "organic black rice philippines",
          }),
        }),
        update: expect.objectContaining({
          keyword: "organic black rice philippines",
          source: "dataforseo",
          jobRunId: "run-1",
        }),
      }),
    );
    expect(result.status).toBe("success");
    expect(result.summary.researchRowsStored).toBe(1);
    expect(result.summary.researchRowsCreated).toBe(0);
    expect(result.summary.researchRowsUpdated).toBe(1);
  });

  it("skips a seed keyword with no volume data instead of writing a null row", async () => {
    mockPrisma.marketKeyword.findMany.mockResolvedValue([
      { id: "kw-1", keyword: "known keyword", locationName: "Philippines", languageCode: "en", createdAt: new Date(), active: true },
      { id: "kw-2", keyword: "unknown keyword", locationName: "Philippines", languageCode: "en", createdAt: new Date(), active: true },
    ]);
    mockPrisma.keywordResearchResult.findUnique.mockResolvedValue(null);
    mockPrisma.keywordResearchResult.upsert.mockResolvedValue({ id: "new-row" });
    mockFetchSearchVolume.mockResolvedValue({
      disabled: false,
      volumes: new Map([["known keyword", 25]]),
    });

    const result = await fetchKeywordResearchHandler();

    expect(mockPrisma.keywordResearchResult.upsert).toHaveBeenCalledTimes(1);
    expect(result.summary.researchRowsStored).toBe(1);
  });

  it("reports 'dataforseo' in disabledSources when the connector is unconfigured, without failing the job", async () => {
    mockFetchSearchVolume.mockResolvedValue({ disabled: true, volumes: new Map() });

    const result = await fetchKeywordResearchHandler();

    expect(result.summary.disabledSources).toEqual(["dataforseo"]);
    expect(result.summary.researchRowsStored).toBe(0);
    expect(result.status).toBe("partial");
  });
});
