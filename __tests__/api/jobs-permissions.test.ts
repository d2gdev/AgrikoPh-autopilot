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
  authorizePermission: (...args: Parameters<typeof mockAuthorizePermission>) => mockAuthorizePermission(...args),
  PERMISSIONS: {
    JOBS_RUN: "jobs:run",
  },
}));

vi.mock("@/lib/jobs/orchestrator", () => ({
  enqueueJob: (...args: Parameters<typeof mockEnqueueJob>) => mockEnqueueJob(...args),
}));

vi.mock("@/lib/dashboard/jobs-status", () => ({
  materializeJobsStatusSnapshot: (...args: Parameters<typeof mockMaterializeJobsStatusSnapshot>) =>
    mockMaterializeJobsStatusSnapshot(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

import { POST as triggerPOST } from "@/app/api/jobs/trigger/route";

function forbiddenDecision() {
  return {
    allowed: false,
    actor: "staff-1",
    permission: "jobs:run",
    response: Response.json({ error: "Forbidden", permission: "jobs:run" }, { status: 403 }),
  };
}

describe("job trigger permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockAuthorizePermission.mockResolvedValue(forbiddenDecision());
    mockEnqueueJob.mockResolvedValue({ created: true, runId: "run-1", status: "queued" });
    mockMaterializeJobsStatusSnapshot.mockResolvedValue({});
  });

  it("rejects dashboard refresh triggers without jobs:run", async () => {
    const res = await triggerPOST(new Request("http://test.local/api/jobs/trigger", { method: "POST" }));

    expect(res.status).toBe(403);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: "staff-1",
        action: "manual_job_trigger_denied",
        entityType: "job",
        entityId: "dashboard-refresh",
        after: expect.objectContaining({ permission: "jobs:run" }),
      }),
    });
  });

});
