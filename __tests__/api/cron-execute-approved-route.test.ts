import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAcquireJobLock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const mockReleaseJobLock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockExecuteApprovedHandler = vi.hoisted(() => vi.fn().mockResolvedValue({
  jobName: "execute-approved",
  runId: "run-1",
  status: "success",
  summary: { dryRun: true },
  errors: [],
}));

vi.mock("@/lib/auth", () => ({
  requireCronAuth: vi.fn(() => null),
}));

vi.mock("@/lib/job-lock", () => ({
  acquireJobLock: mockAcquireJobLock,
  releaseJobLock: mockReleaseJobLock,
}));

vi.mock("@/jobs/execute-approved", () => ({
  executeApprovedHandler: mockExecuteApprovedHandler,
}));

import { GET } from "@/app/api/cron/execute-approved/route";

function request(path: string) {
  return new Request(`http://test.local${path}`, {
    headers: { authorization: "Bearer secret" },
  });
}

describe("execute-approved cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.EXECUTE_APPROVED_LIVE_ENABLED;
    mockAcquireJobLock.mockResolvedValue(true);
    mockExecuteApprovedHandler.mockResolvedValue({
      jobName: "execute-approved",
      runId: "run-1",
      status: "success",
      summary: { dryRun: true },
      errors: [],
    });
  });

  it("defaults to dry-run", async () => {
    const res = await GET(request("/api/cron/execute-approved"));

    expect(res.status).toBe(200);
    expect(mockExecuteApprovedHandler).toHaveBeenCalledWith({
      dryRun: true,
      triggeredBy: "cron-dry-run",
    });
    expect(res.headers.get("X-Execute-Approved-Mode")).toBe("dry-run");
  });

  it("keeps dry-run when live is requested but not enabled", async () => {
    const res = await GET(request("/api/cron/execute-approved?live=true"));

    expect(mockExecuteApprovedHandler).toHaveBeenCalledWith({
      dryRun: true,
      triggeredBy: "cron-dry-run",
    });
    expect(res.headers.get("X-Execute-Approved-Live-Blocked")).toContain("EXECUTE_APPROVED_LIVE_ENABLED");
  });

  it("runs live only when live is requested and env allows it", async () => {
    process.env.EXECUTE_APPROVED_LIVE_ENABLED = "true";

    const res = await GET(request("/api/cron/execute-approved?live=true"));

    expect(mockExecuteApprovedHandler).toHaveBeenCalledWith({
      dryRun: false,
      triggeredBy: "cron-live",
    });
    expect(res.headers.get("X-Execute-Approved-Mode")).toBe("live");
  });

  it("returns conflict when another execution run owns the lock", async () => {
    mockAcquireJobLock.mockResolvedValue(false);

    const res = await GET(request("/api/cron/execute-approved"));

    expect(res.status).toBe(409);
    expect(mockExecuteApprovedHandler).not.toHaveBeenCalled();
  });
});
