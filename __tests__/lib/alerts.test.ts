import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  jobRun: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  jobLock: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  competitorAd: {
    findFirst: vi.fn(),
  },
  shoppingResult: {
    findFirst: vi.fn(),
  },
  keywordResearchResult: {
    findFirst: vi.fn(),
  },
  gscQuery: {
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

import { checkAndAlertJobHealth, notifyJobFailure } from "@/lib/alerts";

function webhookBodies(): Array<Record<string, unknown>> {
  return vi.mocked(global.fetch).mock.calls.map((call) =>
    JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>
  );
}

describe("alerts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T12:00:00.000Z"));
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;

    mockPrisma.jobRun.findFirst.mockResolvedValue({ completedAt: new Date("2026-06-25T11:00:00.000Z") });
    mockPrisma.jobRun.findMany.mockImplementation(({ where }: { where?: { status?: string } }) => {
      if (where?.status === "queued" || where?.status === "running") return Promise.resolve([]);
      return Promise.resolve([{ status: "success", completedAt: new Date("2026-06-25T11:00:00.000Z") }]);
    });
    mockPrisma.jobRun.count.mockResolvedValue(0);
    mockPrisma.jobLock.count.mockResolvedValue(0);
    mockPrisma.jobLock.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("does nothing when ALERT_WEBHOOK_URL is not configured", async () => {
    await notifyJobFailure({ jobName: "fetch-ads-data", error: new Error("boom") });
    await checkAndAlertJobHealth();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPrisma.jobRun.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.jobRun.count).not.toHaveBeenCalled();
    expect(mockPrisma.jobLock.count).not.toHaveBeenCalled();
  });

  it("posts sanitized job failure payload to webhook", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://alerts.example.com/hook");
    vi.stubEnv("SHOPIFY_APP_URL", "https://app.example.com");

    await notifyJobFailure({
      jobName: "fetch-market-intel",
      route: "/api/cron/fetch-market-intel",
      error: new Error("token failed\nwith newline"),
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://alerts.example.com/hook",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    const body = webhookBodies()[0]!;
    expect(body).toMatchObject({
      type: "job_failure",
      jobName: "fetch-market-intel",
      route: "/api/cron/fetch-market-intel",
      status: "failed",
      appUrl: "https://app.example.com",
    });
    expect(body.errorExcerpt).toContain("token failed with newline");
    expect(String(body.errorExcerpt)).not.toContain("\n");
  });

  it("alerts when queued dashboard jobs are stuck past the threshold", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://alerts.example.com/hook");
    vi.stubEnv("SHOPIFY_APP_URL", "https://app.example.com");
    vi.stubEnv("ALERT_QUEUED_JOB_STALE_MINUTES", "15");

    mockPrisma.jobRun.count.mockImplementation(({ where }: { where?: { status?: string } }) =>
      Promise.resolve(where?.status === "queued" ? 1 : 0)
    );
    mockPrisma.jobRun.findMany.mockImplementation(({ where }: { where?: { status?: string } }) => {
      if (where?.status === "queued") {
        return Promise.resolve([
          {
            id: "queued-1",
            jobName: "dashboard-refresh",
            startedAt: new Date("2026-06-25T11:40:00.000Z"),
            attempts: 0,
            maxAttempts: 2,
          },
        ]);
      }
      if (where?.status === "running") return Promise.resolve([]);
      return Promise.resolve([{ status: "success", completedAt: new Date("2026-06-25T11:00:00.000Z") }]);
    });

    await checkAndAlertJobHealth();

    const body = webhookBodies().find((payload) => payload.type === "stuck_queued_jobs");
    expect(body).toMatchObject({
      type: "stuck_queued_jobs",
      appUrl: "https://app.example.com",
      count: 1,
      staleThresholdMinutes: 15,
      oldestQueuedAt: "2026-06-25T11:40:00.000Z",
    });
    expect(body?.jobs).toEqual([
      {
        id: "queued-1",
        jobName: "dashboard-refresh",
        queuedAt: "2026-06-25T11:40:00.000Z",
        attempts: 0,
        maxAttempts: 2,
      },
    ]);
  });

  it("alerts when owned running queue jobs stop heartbeating", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://alerts.example.com/hook");
    vi.stubEnv("JOB_QUEUE_STALE_MINUTES", "20");

    mockPrisma.jobRun.count.mockImplementation(({ where }: { where?: { status?: string } }) =>
      Promise.resolve(where?.status === "running" ? 1 : 0)
    );
    mockPrisma.jobRun.findMany.mockImplementation(({ where }: { where?: { status?: string } }) => {
      if (where?.status === "running") {
        return Promise.resolve([
          {
            id: "running-1",
            jobName: "dashboard-refresh",
            startedAt: new Date("2026-06-25T11:00:00.000Z"),
            claimedAt: new Date("2026-06-25T11:01:00.000Z"),
            lastHeartbeatAt: new Date("2026-06-25T11:20:00.000Z"),
            ownerToken: "owner-token",
            parentRunId: null,
            attempts: 1,
            maxAttempts: 2,
          },
        ]);
      }
      if (where?.status === "queued") return Promise.resolve([]);
      return Promise.resolve([{ status: "success", completedAt: new Date("2026-06-25T11:00:00.000Z") }]);
    });

    await checkAndAlertJobHealth();

    const body = webhookBodies().find((payload) => payload.type === "stale_running_jobs");
    expect(body).toMatchObject({
      type: "stale_running_jobs",
      count: 1,
      staleThresholdMinutes: 20,
      oldestStartedAt: "2026-06-25T11:00:00.000Z",
    });
    expect(body?.jobs).toEqual([
      {
        id: "running-1",
        jobName: "dashboard-refresh",
        startedAt: "2026-06-25T11:00:00.000Z",
        claimedAt: "2026-06-25T11:01:00.000Z",
        lastHeartbeatAt: "2026-06-25T11:20:00.000Z",
        hasOwnerToken: true,
        parentRunId: null,
        attempts: 1,
        maxAttempts: 2,
      },
    ]);
  });

  it("alerts on expired job locks left in the database", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://alerts.example.com/hook");

    mockPrisma.jobLock.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    mockPrisma.jobLock.findMany
      .mockResolvedValueOnce([
        {
          jobName: "dashboard-refresh",
          lockedAt: new Date("2026-06-25T11:00:00.000Z"),
          expiresAt: new Date("2026-06-25T11:10:00.000Z"),
          ownerToken: "owner-token",
        },
      ])
      .mockResolvedValueOnce([]);

    await checkAndAlertJobHealth();

    const body = webhookBodies().find((payload) => payload.type === "expired_job_locks");
    expect(body).toMatchObject({
      type: "expired_job_locks",
      count: 1,
    });
    expect(body?.locks).toEqual([
      {
        jobName: "dashboard-refresh",
        lockedAt: "2026-06-25T11:00:00.000Z",
        expiresAt: "2026-06-25T11:10:00.000Z",
        hasOwnerToken: true,
      },
    ]);
  });
});
