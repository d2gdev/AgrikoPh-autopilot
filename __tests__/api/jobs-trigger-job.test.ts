import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthorizePermission = vi.hoisted(() => vi.fn());
const mockEnqueueJob = vi.hoisted(() => vi.fn());
const mockMaterializeJobsStatusSnapshot = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  auditLog: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAppAuth: vi.fn().mockResolvedValue(null),
  PERMISSIONS: {
    JOBS_RUN: "jobs:run",
  },
  authorizePermission: (...args: Parameters<typeof mockAuthorizePermission>) =>
    mockAuthorizePermission(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/jobs/orchestrator", () => ({
  enqueueJob: (...args: Parameters<typeof mockEnqueueJob>) => mockEnqueueJob(...args),
}));

vi.mock("@/lib/dashboard/jobs-status", () => ({
  materializeJobsStatusSnapshot: (...args: Parameters<typeof mockMaterializeJobsStatusSnapshot>) =>
    mockMaterializeJobsStatusSnapshot(...args),
}));

import { POST } from "@/app/api/jobs/trigger-job/route";

function request(body: unknown) {
  return new Request("http://test.local/api/jobs/trigger-job", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("/api/jobs/trigger-job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorizePermission.mockResolvedValue({
      allowed: true,
      actor: "operator-1",
      permission: "jobs:run",
    });
    mockEnqueueJob.mockResolvedValue({ runId: "run-1", status: "queued", created: true });
    mockMaterializeJobsStatusSnapshot.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn());
    process.env.CRON_SECRET = "cron-secret";
  });

  it("returns a structured error for unknown jobs", async () => {
    const res = await POST(request({ jobName: "not-a-job" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({ code: "unknown_job", error: "Unknown job: not-a-job" });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "manual_job_trigger_failed_validation",
        entityId: "not-a-job",
      }),
    });
  });

  it("rejects manual job triggers without jobs:run", async () => {
    mockAuthorizePermission.mockResolvedValueOnce({
      allowed: false,
      actor: "staff-1",
      permission: "jobs:run",
      response: Response.json({ error: "Forbidden", permission: "jobs:run" }, { status: 403 }),
    });

    const res = await POST(request({ jobName: "fetch-seo-data" }));

    expect(res.status).toBe(403);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: "staff-1",
        action: "manual_job_trigger_denied",
        entityType: "job",
        entityId: "manual-trigger",
        after: expect.objectContaining({ permission: "jobs:run" }),
      }),
    });
  });

  it("returns a structured error for visible but non-triggerable jobs", async () => {
    const res = await POST(request({ jobName: "fetch-blog-content" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      code: "job_not_triggerable",
      jobName: "fetch-blog-content",
      label: "Fetch Blog Content",
    });
  });

  it("queues triggerable queued jobs", async () => {
    const res = await POST(request({ jobName: "fetch-market-intel" }));
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toMatchObject({
      queued: true,
      jobName: "fetch-market-intel",
      label: "Fetch Market Intelligence",
      runId: "run-1",
      status: "queued",
    });
    expect(mockEnqueueJob).toHaveBeenCalledWith({
      jobName: "fetch-market-intel",
      triggeredBy: "operator-1",
      input: { profile: "smoke" },
    });
  });

  it("returns already-active when queued job is already queued or running", async () => {
    mockEnqueueJob.mockResolvedValueOnce({ runId: "run-existing", status: "running", created: false });

    const res = await POST(request({ jobName: "fetch-keyword-research" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      code: "job_already_active",
      jobName: "fetch-keyword-research",
      runId: "run-existing",
      status: "running",
    });
  });

  it("awaits direct cron triggers and returns downstream run status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ ok: true, jobName: "run-skills", runId: "direct-1", status: "success" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(request({ jobName: "run-skills" }));
    const body = await res.json();

    expect(fetchMock).toHaveBeenCalledWith("http://test.local/api/cron/run-skills", {
      headers: { Authorization: "Bearer cron-secret" },
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      queued: false,
      jobName: "run-skills",
      label: "Run Skills",
      runId: "direct-1",
      status: "success",
    });
  });

  it("surfaces direct cron lock failures as already-active", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ skipped: true, reason: "job already running" }, { status: 409 }),
    ));

    const res = await POST(request({ jobName: "fetch-ads-data" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      code: "job_already_active",
      jobName: "fetch-ads-data",
      label: "Fetch Ads Data",
    });
  });
});
