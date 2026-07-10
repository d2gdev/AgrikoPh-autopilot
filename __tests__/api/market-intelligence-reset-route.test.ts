import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  marketInsight: {
    deleteMany: vi.fn(),
  },
  competitorAdCapture: {
    deleteMany: vi.fn(),
  },
  competitorAd: {
    deleteMany: vi.fn(),
  },
  shoppingPriceHistory: {
    deleteMany: vi.fn(),
  },
  shoppingResult: {
    deleteMany: vi.fn(),
  },
  keywordResearchResult: {
    deleteMany: vi.fn(),
  },
  competitorSocialPage: {
    updateMany: vi.fn(),
  },
  competitor: {
    updateMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const mockVerifySessionToken = vi.hoisted(() => vi.fn());
const mockGetSessionUser = vi.hoisted(() => vi.fn());
const mockAcquireJobLock = vi.hoisted(() => vi.fn());
const mockReleaseJobLock = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/shopify", () => ({
  verifySessionToken: mockVerifySessionToken,
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: mockGetSessionUser,
}));

vi.mock("@/lib/job-lock", () => ({
  acquireJobLock: mockAcquireJobLock,
  releaseJobLock: mockReleaseJobLock,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

let postResetRoute: (req: Request) => Promise<Response>;

async function loadRoute() {
  vi.resetModules();
  ({ POST: postResetRoute } = await import("@/app/api/market-intelligence/reset/route"));
}

function request(path = "/api/market-intelligence/reset", headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "x-forwarded-for": "203.0.113.10",
      "user-agent": "vitest-agent",
      "x-maintenance-secret": "maintenance-secret",
      "x-maintenance-confirm": "confirm-token",
      ...headers,
    },
  });
}

describe("market intelligence reset route", () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();

    vi.stubEnv("MARKET_INTEL_RESET_MAINTENANCE", "true");
    vi.stubEnv("MARKET_INTEL_RESET_MAINTENANCE_SECRET", "maintenance-secret");
    vi.stubEnv("MARKET_INTEL_RESET_CONFIRMATION", "confirm-token");
    vi.stubEnv("MARKET_INTEL_RESET_RATE_LIMIT_PER_MINUTE", "3");

    mockPrisma.marketInsight.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.competitorAdCapture.deleteMany.mockResolvedValue({ count: 3 });
    mockPrisma.competitorAd.deleteMany.mockResolvedValue({ count: 4 });
    mockPrisma.shoppingPriceHistory.deleteMany.mockResolvedValue({ count: 5 });
    mockPrisma.shoppingResult.deleteMany.mockResolvedValue({ count: 6 });
    mockPrisma.keywordResearchResult.deleteMany.mockResolvedValue({ count: 7 });
    mockPrisma.competitorSocialPage.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.competitor.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValue({ id: "audit-success" });

    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) =>
      callback(mockPrisma),
    );

    mockVerifySessionToken.mockResolvedValue("shop.myshopify.com");
    mockGetSessionUser.mockResolvedValue("user-123");
    mockAcquireJobLock.mockResolvedValue(true);
    mockReleaseJobLock.mockResolvedValue(undefined);
    mockCheckRateLimit.mockReturnValue(true);

    vi.stubEnv("MARKET_INTEL_RESET_ALLOWED_SHOPS", "shop.myshopify.com");

    await loadRoute();
  });

  it("rejects public API-key auth for reset", async () => {
    const res = await postResetRoute(
      new Request("http://localhost/api/market-intelligence/reset", {
        method: "POST",
        headers: {
          "x-autopilot-api-key": "token",
        },
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "market_intelligence_reset_attempt",
          after: expect.objectContaining({ state: "rejected", reason: "public_api_key_blocked" }),
        }),
      }),
    );
    expect(mockVerifySessionToken).not.toHaveBeenCalled();
  });

  it("requires maintenance mode env flag", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("MARKET_INTEL_RESET_MAINTENANCE", "false");
    await loadRoute();

    const res = await postResetRoute(request());

    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({
      error: "Reset is disabled until maintenance mode is enabled.",
    });
    expect(mockVerifySessionToken).not.toHaveBeenCalled();
  });

  it("enforces session auth and allowlist before destructive action", async () => {
    mockVerifySessionToken.mockResolvedValue(null);
    await loadRoute();

    const res = await postResetRoute(request());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockAuditAction("market_intelligence_reset_attempt")).toBe(true);
    expect(mockAcquireJobLock).not.toHaveBeenCalled();
  });

  it("enforces maintenance secret and confirmation token", async () => {
    const resBadMaint = await postResetRoute(
      request("/api/market-intelligence/reset", { "x-maintenance-secret": "wrong-secret" }),
    );
    expect(resBadMaint.status).toBe(401);
    expect(await resBadMaint.json()).toEqual({ error: "Unauthorized" });

    mockCheckRateLimit.mockClear();
    await loadRoute();
    const resBadConfirm = await postResetRoute(
      request("/api/market-intelligence/reset", { "x-maintenance-confirm": "wrong-token" }),
    );

    expect(resBadConfirm.status).toBe(400);
    const body = await resBadConfirm.json();
    expect(body.error).toBe("Invalid confirmation token");
    expect(body.expected).toBe("a server-provided confirmation token");
  });

  it("rejects reset credentials in the URL query string", async () => {
    const res = await postResetRoute(
      request("/api/market-intelligence/reset?maintenanceSecret=maintenance-secret&confirm=confirm-token"),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Reset credentials must be provided in headers." });
    expect(mockPrisma.marketInsight.deleteMany).not.toHaveBeenCalled();
  });

  it("rate limits repeated reset attempts", async () => {
    mockCheckRateLimit.mockReturnValue(false);
    await loadRoute();

    const res = await postResetRoute(
      request(),
    );

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Rate limit exceeded" });
    expect(mockPrisma.marketInsight.deleteMany).not.toHaveBeenCalled();
  });

  it("honors job lock failure path", async () => {
    mockAcquireJobLock.mockResolvedValue(false);
    await loadRoute();

    const res = await postResetRoute(
      request(),
    );

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "A reset is already in progress." });
    expect(mockReleaseJobLock).not.toHaveBeenCalled();
  });

  it("performs a transactional reset with audit logging when authorized", async () => {
    const res = await postResetRoute(
      request(),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toMatchObject({
      shoppingPriceHistory: 5,
      shoppingResults: 6,
      keywordResearch: 7,
      competitorAdCaptures: 3,
      competitorAds: 4,
      insights: 2,
    });
    expect(body.deactivated).toMatchObject({ metaKeywordPages: 1, keywordSearchCompetitors: 1 });

    expect(mockAcquireJobLock).toHaveBeenCalledWith(
      "market-intel-reset",
      expect.objectContaining({ ttlMs: 300000, ownerToken: expect.any(String) }),
    );
    expect(mockReleaseJobLock).toHaveBeenCalledWith("market-intel-reset", expect.any(String));
    expect(mockPrisma.marketInsight.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "market_intelligence_reset",
          after: expect.objectContaining({ deleted: expect.any(Object) }),
        }),
      }),
    );
  });

  it("returns reset_failed when transactional work fails", async () => {
    mockPrisma.marketInsight.deleteMany.mockRejectedValueOnce(new Error("db unavailable"));
    await loadRoute();

    const res = await postResetRoute(
      request(),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "db unavailable" });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "market_intelligence_reset_failed",
        }),
      }),
    );
  });
});

function mockAuditAction(action: string): boolean {
  return mockPrisma.auditLog.create.mock.calls.some(
    (call) => call[0]?.data?.action === action,
  );
}
