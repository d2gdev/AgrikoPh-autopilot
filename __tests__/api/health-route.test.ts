import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  $queryRaw: vi.fn(),
  jobRun: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  jobLock: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  rawSnapshot: {
    findFirst: vi.fn(),
  },
  pageAnalytics: {
    findFirst: vi.fn(),
  },
  articleRecord: {
    findFirst: vi.fn(),
  },
  marketInsight: {
    findFirst: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/db-url", () => ({
  getDatabaseUrlDiagnostics: vi.fn(() => ({
    source: "DATABASE_URL",
    host: "db.internal",
    database: "autopilot",
    errors: [],
  })),
}));

function resetPrismaMocks() {
  mockPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
  mockPrisma.jobRun.count.mockResolvedValue(0);
  mockPrisma.jobRun.findFirst.mockResolvedValue(null);
  mockPrisma.jobLock.count.mockResolvedValue(0);
  mockPrisma.jobLock.findFirst.mockResolvedValue(null);
  mockPrisma.rawSnapshot.findFirst.mockResolvedValue(null);
  mockPrisma.pageAnalytics.findFirst.mockResolvedValue(null);
  mockPrisma.articleRecord.findFirst.mockResolvedValue(null);
  mockPrisma.marketInsight.findFirst.mockResolvedValue(null);
}

describe("/api/health", () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.stubEnv("AUTOPILOT_API_KEY", "private-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns only public liveness fields without private auth", async () => {
    const { GET } = await import("@/app/api/health/route");

    const res = await GET(new Request("http://localhost/api/health"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "ok" });
    expect(body.timestamp).toEqual(expect.any(String));
    expect(body).not.toHaveProperty("db");
    expect(body).not.toHaveProperty("jobs");
    expect(body).not.toHaveProperty("locks");
    expect(body).not.toHaveProperty("freshness");
  });

  it("returns private diagnostics only to a matching private API key", async () => {
    const { GET } = await import("@/app/api/health/route");

    const res = await GET(
      new Request("http://localhost/api/health?details=1", {
        headers: { "x-autopilot-api-key": "private-key" },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.db.url.host).toBe("db.internal");
    expect(body).toHaveProperty("jobs");
    expect(body).toHaveProperty("locks");
    expect(body).toHaveProperty("freshness");
  });
});
