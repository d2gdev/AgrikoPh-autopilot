import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  jobRun: {
    findFirst: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  $executeRaw: vi.fn(),
  jobLock: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const mockAcquireJobLock = vi.hoisted(() => vi.fn());
const mockReleaseJobLock = vi.hoisted(() => vi.fn());
const mockFetchMarketIntelHandler = vi.hoisted(() => vi.fn());
const mockFetchKeywordResearchHandler = vi.hoisted(() => vi.fn());
const mockMaterializeJobsStatusSnapshot = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/jobs/run-dashboard-refresh", () => ({
  runDashboardRefreshHandler: vi.fn().mockResolvedValue({
    jobName: "dashboard-refresh",
    runId: "queued-1",
    status: "success",
    summary: { newRecs: 0 },
    errors: [],
  }),
}));

vi.mock("@/lib/job-lock", () => ({
  acquireJobLock: (...args: Parameters<typeof mockAcquireJobLock>) => mockAcquireJobLock(...args),
  releaseJobLock: (...args: Parameters<typeof mockReleaseJobLock>) => mockReleaseJobLock(...args),
}));

vi.mock("@/jobs/fetch-market-intel", () => ({
  fetchMarketIntelHandler: (...args: Parameters<typeof mockFetchMarketIntelHandler>) =>
    mockFetchMarketIntelHandler(...args),
}));

vi.mock("@/jobs/fetch-keyword-research", () => ({
  fetchKeywordResearchHandler: (...args: Parameters<typeof mockFetchKeywordResearchHandler>) =>
    mockFetchKeywordResearchHandler(...args),
}));

vi.mock("@/lib/dashboard/jobs-status", () => ({
  materializeJobsStatusSnapshot: (...args: Parameters<typeof mockMaterializeJobsStatusSnapshot>) =>
    mockMaterializeJobsStatusSnapshot(...args),
}));

import { drainQueuedJobs, enqueueJob, recoverStaleQueuedRuns } from "@/lib/jobs/orchestrator";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma));
  mockPrisma.jobRun.findFirst.mockResolvedValue(null);
  mockPrisma.jobRun.create.mockResolvedValue({ id: "queued-1" });
  mockPrisma.jobRun.findMany.mockResolvedValue([]);
  mockPrisma.jobRun.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.jobRun.update.mockResolvedValue({});
  mockPrisma.$executeRaw.mockResolvedValue({});

  mockAcquireJobLock.mockResolvedValue(true);
  mockReleaseJobLock.mockResolvedValue(undefined);

  mockFetchMarketIntelHandler.mockResolvedValue({
    jobName: "fetch-market-intel",
    runId: "run-1",
    status: "success",
    summary: {},
    errors: [],
  });

  mockFetchKeywordResearchHandler.mockResolvedValue({
    jobName: "fetch-keyword-research",
    runId: "run-1",
    status: "success",
    summary: {},
    errors: [],
  });

  mockMaterializeJobsStatusSnapshot.mockResolvedValue({});
});

describe("job orchestrator", () => {
  it("deduplicates queued dashboard refresh runs", async () => {
    mockPrisma.jobRun.findFirst.mockResolvedValueOnce({ id: "existing-1", status: "queued" });

    const result = await enqueueJob({ jobName: "dashboard-refresh", triggeredBy: "user" });

    expect(result).toEqual({ runId: "existing-1", status: "queued", created: false });
    expect(mockPrisma.jobRun.create).not.toHaveBeenCalled();
  });

  it("creates a queued dashboard refresh when no active run exists", async () => {
    const result = await enqueueJob({ jobName: "dashboard-refresh", triggeredBy: "user" });

    expect(result).toEqual({ runId: "queued-1", status: "queued", created: true });
    expect(mockPrisma.jobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobName: "dashboard-refresh",
        triggeredBy: "user",
        status: "queued",
        maxAttempts: 2,
      }),
      select: { id: true },
    });
  });

  it("creates a queued fetch-market-intel run when no active run exists", async () => {
    const result = await enqueueJob({ jobName: "fetch-market-intel", triggeredBy: "user" });

    expect(result).toEqual({ runId: "queued-1", status: "queued", created: true });
    expect(mockPrisma.jobRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ jobName: "fetch-market-intel" }),
    }));
    expect(mockPrisma.jobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobName: "fetch-market-intel",
        triggeredBy: "user",
        status: "queued",
        maxAttempts: 2,
      }),
      select: { id: true },
    });
  });

  it("creates a queued fetch-keyword-research run when no active run exists", async () => {
    const result = await enqueueJob({ jobName: "fetch-keyword-research", triggeredBy: "user" });

    expect(result).toEqual({ runId: "queued-1", status: "queued", created: true });
    expect(mockPrisma.jobRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ jobName: "fetch-keyword-research" }),
    }));
    expect(mockPrisma.jobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobName: "fetch-keyword-research",
        triggeredBy: "user",
        status: "queued",
        maxAttempts: 2,
      }),
      select: { id: true },
    });
  });

  it("requeues stale claimed runs that still have attempts remaining", async () => {
    mockPrisma.jobRun.findMany.mockResolvedValueOnce([
      { id: "run-1", jobName: "dashboard-refresh", attempts: 1, maxAttempts: 2, errorLog: null },
    ]);

    const result = await recoverStaleQueuedRuns(30);

    expect(result).toEqual({ failed: 0, requeued: 1 });
    expect(mockPrisma.jobRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-1", status: "running" },
      data: expect.objectContaining({
        status: "queued",
        ownerToken: null,
      }),
    }));
  });

  it("fails stale claimed runs when attempts are exhausted", async () => {
    mockPrisma.jobRun.findMany.mockResolvedValueOnce([
      { id: "run-1", jobName: "dashboard-refresh", attempts: 2, maxAttempts: 2, errorLog: null },
    ]);

    const result = await recoverStaleQueuedRuns(30);

    expect(result).toEqual({ failed: 1, requeued: 0 });
    expect(mockPrisma.jobRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-1", status: "running" },
      data: expect.objectContaining({
        status: "failed",
        completedAt: expect.any(Date),
      }),
    }));
  });

  it("requeues stale fetch-market-intel runs when attempts remain", async () => {
    mockPrisma.jobRun.findMany.mockResolvedValueOnce([
      {
        id: "run-market-intel-1",
        jobName: "fetch-market-intel",
        attempts: 1,
        maxAttempts: 3,
        errorLog: "timeout",
      },
    ]);

    const result = await recoverStaleQueuedRuns(45);

    expect(result).toEqual({ failed: 0, requeued: 1 });
    expect(mockPrisma.jobRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-market-intel-1", status: "running" },
      data: expect.objectContaining({
        status: "queued",
        ownerToken: null,
        errorLog: expect.stringContaining("timeout"),
      }),
    }));
  });

  it("fails stale fetch-keyword-research runs when max attempts reached", async () => {
    mockPrisma.jobRun.findMany.mockResolvedValueOnce([
      {
        id: "run-keyword-1",
        jobName: "fetch-keyword-research",
        attempts: 2,
        maxAttempts: 2,
        errorLog: null,
      },
    ]);

    const result = await recoverStaleQueuedRuns(45);

    expect(result).toEqual({ failed: 1, requeued: 0 });
    expect(mockPrisma.jobRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-keyword-1", status: "running" },
      data: expect.objectContaining({
        status: "failed",
        completedAt: expect.any(Date),
      }),
    }));
  });

  it("drains queued fetch-market-intel runs with job lock and executes handler", async () => {
    mockPrisma.jobRun.findMany.mockResolvedValueOnce([]);
    const runOwnerToken = "market-owner-token";
    mockPrisma.jobRun.findFirst.mockResolvedValueOnce({
      id: "run-market-1",
      jobName: "fetch-market-intel",
      input: { profile: "shopping" },
      ownerToken: runOwnerToken,
      status: "queued",
    });

    const result = await drainQueuedJobs({ limit: 1 });

    expect(mockAcquireJobLock).toHaveBeenCalledWith("fetch-market-intel", expect.objectContaining({
      ownerToken: expect.any(String),
      ttlMs: expect.any(Number),
    }));
    expect(mockFetchMarketIntelHandler).toHaveBeenCalledWith({
      profile: "shopping",
      runId: "run-market-1",
    });
    expect(mockReleaseJobLock).toHaveBeenCalledWith("fetch-market-intel", expect.any(String));
    expect(result.drained).toHaveLength(1);
    expect(result.drained[0]).toMatchObject({ runId: "run-1", jobName: "fetch-market-intel", status: "success" });
  });

  it("retries queued fetch-market-intel run when market-intel lock is held", async () => {
    mockAcquireJobLock.mockResolvedValue(false);
    mockPrisma.jobRun.findMany.mockResolvedValueOnce([]);
    mockPrisma.jobRun.findFirst.mockResolvedValueOnce({
      id: "run-market-2",
      jobName: "fetch-market-intel",
      input: { profile: "shopping" },
      ownerToken: "token-2",
      status: "queued",
    });

    const result = await drainQueuedJobs({ limit: 1 });

    expect(mockFetchMarketIntelHandler).not.toHaveBeenCalled();
    expect(result.drained).toHaveLength(1);
    expect(result.drained[0]).toMatchObject({
      runId: "run-market-2",
      jobName: "fetch-market-intel",
      status: "skipped",
    });
    const runOwnershipUpdate = mockPrisma.jobRun.updateMany.mock.calls.find((call) =>
      call[0] && call[0].where && call[0].where.id === "run-market-2"
    );
    expect(runOwnershipUpdate?.[0]).toMatchObject({
      where: { id: "run-market-2", status: "queued" },
      data: expect.objectContaining({
        status: "running",
      }),
    });
    expect(mockPrisma.jobRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "run-market-2", ownerToken: expect.any(String) }),
      data: expect.objectContaining({
        status: "queued",
      }),
    }));
  });

  it("drains queued fetch-keyword-research runs with job lock and executes handler", async () => {
    mockPrisma.jobRun.findMany.mockResolvedValueOnce([]);
    mockPrisma.jobRun.findFirst.mockResolvedValueOnce({
      id: "run-keyword-1",
      jobName: "fetch-keyword-research",
      input: null,
      ownerToken: "keyword-owner-token",
      status: "queued",
    });

    const result = await drainQueuedJobs({ limit: 1 });

    expect(mockAcquireJobLock).toHaveBeenCalledWith("fetch-keyword-research", expect.objectContaining({
      ownerToken: expect.any(String),
      ttlMs: expect.any(Number),
    }));
    expect(mockFetchKeywordResearchHandler).toHaveBeenCalledWith({
      runId: "run-keyword-1",
    });
    expect(mockReleaseJobLock).toHaveBeenCalledWith("fetch-keyword-research", expect.any(String));
    expect(result.drained).toHaveLength(1);
    expect(result.drained[0]).toMatchObject({
      runId: "run-1",
      jobName: "fetch-keyword-research",
      status: "success",
    });
  });

  it("retries queued fetch-keyword-research run when keyword lock is held", async () => {
    mockAcquireJobLock.mockResolvedValueOnce(false);
    mockPrisma.jobRun.findMany.mockResolvedValueOnce([]);
    mockPrisma.jobRun.findFirst.mockResolvedValueOnce({
      id: "run-keyword-2",
      jobName: "fetch-keyword-research",
      input: null,
      ownerToken: "keyword-token-2",
      status: "queued",
    });

    const result = await drainQueuedJobs({ limit: 1 });

    expect(mockFetchKeywordResearchHandler).not.toHaveBeenCalled();
    expect(result.drained).toHaveLength(1);
    expect(result.drained[0]).toMatchObject({
      runId: "run-keyword-2",
      jobName: "fetch-keyword-research",
      status: "skipped",
    });
  });
});
