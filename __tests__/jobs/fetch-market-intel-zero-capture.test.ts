import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    marketKeyword: {
      findMany: vi.fn(),
    },
    shoppingResult: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    shoppingPriceHistory: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    marketInsight: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    guardrailConfig: {
      findMany: vi.fn(),
    },
    competitorSocialPage: {
      findMany: vi.fn(),
    },
    competitor: {
      findMany: vi.fn(),
    },
    competitorAdCapture: {
      count: vi.fn(),
    },
    competitorAd: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    storeTask: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    rawSnapshot: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/connectors/meta-ad-library", () => ({}));
vi.mock("@/lib/connectors/apify-meta-ads", () => ({
  isApifyMetaEnabled: vi.fn().mockResolvedValue(false),
  fetchApifyMetaAdsByPages: vi.fn(),
}));
vi.mock("@/lib/connectors/dataforseo-shopping", () => ({
  fetchShoppingProducts: vi.fn(),
}));
vi.mock("@/lib/connectors/serper-shopping", () => ({
  fetchSerperShoppingProducts: vi.fn(),
}));
vi.mock("@/lib/market-intel/translate-captures", () => ({
  fillCaptureTranslations: vi.fn(),
}));
vi.mock("@/lib/market-intel/classify-angles", () => ({
  fillCreativeAngles: vi.fn(),
}));
vi.mock("@/lib/market-intel/ad-captures", () => ({
  recordCompetitorAdCapture: vi.fn(),
}));
vi.mock("@/lib/market-intel/spam-filter", () => ({
  isSpamStoryAd: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/market-intel/profiles", () => ({
  resolveRunLimits: vi.fn(),
}));
vi.mock("@/lib/shopify-admin", () => ({
  fetchCatalogProducts: vi.fn(),
}));
vi.mock("@/lib/alerts", () => ({
  sendOperatorAlert: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { isApifyMetaEnabled, fetchApifyMetaAdsByPages } from "@/lib/connectors/apify-meta-ads";
import { resolveRunLimits } from "@/lib/market-intel/profiles";
import { fetchSerperShoppingProducts } from "@/lib/connectors/serper-shopping";
import { fetchCatalogProducts } from "@/lib/shopify-admin";
import { sendOperatorAlert } from "@/lib/alerts";
import { fetchMarketIntelHandler } from "@/jobs/fetch-market-intel";

const mockJobRun = prisma.jobRun as unknown as {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};
const mockMarketKeyword = prisma.marketKeyword as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};
const mockShoppingResult = prisma.shoppingResult as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};
const mockPriceHistory = prisma.shoppingPriceHistory as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};
const mockMarketInsight = prisma.marketInsight as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};
const mockSocialPage = prisma.competitorSocialPage as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};
const mockCompetitor = prisma.competitor as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};
const mockAdCapture = prisma.competitorAdCapture as unknown as {
  count: ReturnType<typeof vi.fn>;
};
const mockStoreTask = prisma.storeTask as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};
const mockRawSnapshot = prisma.rawSnapshot as unknown as {
  upsert: ReturnType<typeof vi.fn>;
};
const mockGuardrailConfig = prisma.guardrailConfig as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};
const mockCompetitorAd = prisma.competitorAd as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};
const mockResolveRunLimits = resolveRunLimits as unknown as ReturnType<typeof vi.fn>;
const mockFetchSerper = fetchSerperShoppingProducts as unknown as ReturnType<typeof vi.fn>;
const mockFetchCatalog = fetchCatalogProducts as unknown as ReturnType<typeof vi.fn>;
const mockSendOperatorAlert = sendOperatorAlert as unknown as ReturnType<typeof vi.fn>;
const mockIsApifyEnabled = isApifyMetaEnabled as unknown as ReturnType<typeof vi.fn>;
const mockFetchApify = fetchApifyMetaAdsByPages as unknown as ReturnType<typeof vi.fn>;

// The watchdog windows over runs that actually executed an Apify pull
// (summary.apifyRan), not every daily run — see fetch-market-intel.ts.
const SEVEN_HISTORICAL_PULLS = Array.from({ length: 7 }, (_, i) => ({
  id: `hist-run-${i}`,
  summary: { apifyRan: true },
}));

function competitorRow(overrides: Partial<{ id: string; name: string; socialPages: Array<{ id: string; pageId: string | null }> }> = {}) {
  return {
    id: "competitor-1",
    name: "Falo",
    socialPages: [{ id: "page-1", pageId: null }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // "meta" source + one numeric-pageId page + Apify enabled: this run
  // executes a (zero-result) Apify pull, so the watchdog evaluates.
  mockResolveRunLimits.mockReturnValue({
    keywordLimit: 5,
    shoppingResultLimit: 5,
    competitorPageLimit: 5,
    adLimitPerPage: 10,
    longRunningAdDays: 30,
    sources: ["shopping", "meta"],
  });

  mockIsApifyEnabled.mockResolvedValue(true);
  mockFetchApify.mockResolvedValue({ adsByPageId: new Map(), total: 0 });
  mockCompetitorAd.findFirst.mockResolvedValue(null); // no fresh capture → Apify not skipped
  mockCompetitorAd.findUnique.mockResolvedValue(null);
  mockCompetitorAd.upsert.mockResolvedValue({});

  mockJobRun.create.mockResolvedValue({ id: "run-1" });
  mockJobRun.update.mockResolvedValue({});
  mockJobRun.findUnique.mockResolvedValue({ id: "run-1", jobName: "fetch-market-intel" });
  mockJobRun.findMany.mockResolvedValue(SEVEN_HISTORICAL_PULLS);

  mockMarketKeyword.findMany.mockResolvedValue([]);

  mockFetchSerper.mockResolvedValue({ disabled: false, products: [] });

  mockShoppingResult.findUnique.mockResolvedValue(null);
  mockShoppingResult.upsert.mockResolvedValue({});
  mockShoppingResult.findFirst.mockResolvedValue({ id: "recent" });
  mockShoppingResult.findMany.mockResolvedValue([]);

  mockPriceHistory.findUnique.mockResolvedValue(null);
  mockPriceHistory.upsert.mockResolvedValue({});
  mockPriceHistory.findFirst.mockResolvedValue(null);
  mockPriceHistory.findMany.mockResolvedValue([]);

  mockGuardrailConfig.findMany.mockResolvedValue([]);

  mockMarketInsight.findUnique.mockResolvedValue(null);
  mockMarketInsight.upsert.mockResolvedValue({});
  mockMarketInsight.findFirst.mockResolvedValue(null);
  mockMarketInsight.create.mockResolvedValue({});

  mockSocialPage.findMany.mockResolvedValue([
    { id: "page-1", pageId: "123456", pageName: "Falo", platform: "facebook", competitor: { id: "competitor-1", name: "Falo" } },
  ]);
  mockRawSnapshot.upsert.mockResolvedValue({});

  mockFetchCatalog.mockResolvedValue([]);

  // Zero-capture watchdog defaults: no active competitors, so the detection
  // step is a no-op unless a test opts in.
  mockCompetitor.findMany.mockResolvedValue([]);
  mockAdCapture.count.mockResolvedValue(0);
  mockStoreTask.findUnique.mockResolvedValue(null);
  mockStoreTask.upsert.mockResolvedValue({});
});

describe("zero-capture watchdog", () => {
  it("flags a competitor with 7 zero-runs, zero this-run, and a missing pageId: upserts one StoreTask and sends one alert", async () => {
    mockCompetitor.findMany.mockResolvedValue([competitorRow()]);
    // historical count, this-run count, all-time count — all zero except the
    // watchdog should still flag via the missing-pageId branch.
    mockAdCapture.count.mockResolvedValue(0);

    const result = await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockStoreTask.upsert).toHaveBeenCalledOnce();
    const call = mockStoreTask.upsert.mock.calls[0]![0];
    expect(call.where).toEqual({ dedupeKey: "store-task:zero-capture:competitor-1" });
    expect(call.create.taskType).toBe("fix_competitor_page");
    expect(call.create.targetType).toBe("competitor");
    expect(call.create.priority).toBe("high");
    expect(call.create.title).toContain("Falo");

    expect(mockSendOperatorAlert).toHaveBeenCalledOnce();
    expect(mockSendOperatorAlert).toHaveBeenCalledWith("competitor_zero_capture", {
      competitorId: "competitor-1",
      competitorName: "Falo",
      consecutiveRuns: 8,
    });

    expect(result.summary.zeroCaptureCompetitors).toBe(1);
  });

  it("does not alert when a matching StoreTask already exists, but still upserts (idempotent update)", async () => {
    mockCompetitor.findMany.mockResolvedValue([competitorRow()]);
    mockAdCapture.count.mockResolvedValue(0);
    mockStoreTask.findUnique.mockResolvedValue({ id: "task-1", dedupeKey: "store-task:zero-capture:competitor-1" });

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockStoreTask.upsert).toHaveBeenCalledOnce();
    expect(mockSendOperatorAlert).not.toHaveBeenCalled();
  });

  it("does nothing for a competitor with captures in any of the 7 historical runs", async () => {
    mockCompetitor.findMany.mockResolvedValue([competitorRow({ socialPages: [{ id: "page-1", pageId: "123456" }] })]);
    // Historical count call returns non-zero (first count call), this-run and
    // all-time counts are irrelevant once historicalCount !== 0 short-circuits.
    mockAdCapture.count.mockResolvedValueOnce(3).mockResolvedValue(0);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockStoreTask.upsert).not.toHaveBeenCalled();
    expect(mockSendOperatorAlert).not.toHaveBeenCalled();
  });

  it("skips the entire detection step when fewer than 7 historical Apify pulls exist", async () => {
    mockJobRun.findMany.mockResolvedValue(SEVEN_HISTORICAL_PULLS.slice(0, 6));
    mockCompetitor.findMany.mockResolvedValue([competitorRow()]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockCompetitor.findMany).not.toHaveBeenCalled();
    expect(mockStoreTask.upsert).not.toHaveBeenCalled();
    expect(mockSendOperatorAlert).not.toHaveBeenCalled();
  });

  it("skips the watchdog entirely on runs that did not execute an Apify pull (the daily-run false-positive fix)", async () => {
    // Apify disabled → this run pulls nothing → no zero-capture evidence.
    mockIsApifyEnabled.mockResolvedValue(false);
    mockCompetitor.findMany.mockResolvedValue([competitorRow()]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockJobRun.findMany).not.toHaveBeenCalled();
    expect(mockCompetitor.findMany).not.toHaveBeenCalled();
    expect(mockStoreTask.upsert).not.toHaveBeenCalled();
    expect(mockSendOperatorAlert).not.toHaveBeenCalled();
  });

  it("counts only Apify-executed runs toward the 7-pull window, ignoring interleaved daily runs", async () => {
    // 6 pulls + 10 daily no-pull runs interleaved: window has only 6 pulls → no-op.
    const dailyRuns = Array.from({ length: 10 }, (_, i) => ({
      id: `daily-run-${i}`,
      summary: { apifyRan: false, apifyAdsFetched: 0 },
    }));
    mockJobRun.findMany.mockResolvedValue([...dailyRuns, ...SEVEN_HISTORICAL_PULLS.slice(0, 6)]);
    mockCompetitor.findMany.mockResolvedValue([competitorRow()]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockCompetitor.findMany).not.toHaveBeenCalled();
    expect(mockStoreTask.upsert).not.toHaveBeenCalled();
  });

  it("treats pre-fix runs with apifyAdsFetched > 0 as pulls (backward compat with runs lacking apifyRan)", async () => {
    const legacyPull = { id: "legacy-run", summary: { apifyAdsFetched: 451 } };
    mockJobRun.findMany.mockResolvedValue([...SEVEN_HISTORICAL_PULLS.slice(0, 6), legacyPull]);
    mockCompetitor.findMany.mockResolvedValue([competitorRow()]);
    mockAdCapture.count.mockResolvedValue(0);

    await fetchMarketIntelHandler({ profile: "shopping" });

    // 6 apifyRan pulls + 1 legacy pull = 7 → watchdog evaluates and flags.
    expect(mockStoreTask.upsert).toHaveBeenCalledOnce();
  });
});
