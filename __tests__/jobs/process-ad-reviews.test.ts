import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  jobRun: { create: vi.fn(), update: vi.fn() },
  adAIJobQueue: { findMany: vi.fn(), update: vi.fn() },
  adApproval: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  adRevision: { findFirst: vi.fn() },
  adAIReport: { create: vi.fn() },
  adReview: { create: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), ADMIN_RECIPIENT: "ADMIN" }));
vi.mock("@/lib/ad-approval/jobs", () => ({ enqueueAiJob: vi.fn() }));
vi.mock("@/lib/ad-approval/conflict", () => ({
  assignConversionReviewer: vi.fn().mockResolvedValue({ ok: true }),
  transitionToPenultimate: vi.fn().mockResolvedValue({ ok: true, escalated: false }),
}));
vi.mock("@/lib/ad-approval/ai-agents/pre-review", () => ({ runPreReview: vi.fn() }));
vi.mock("@/lib/ad-approval/ai-agents/brand-review", () => ({ runBrandReview: vi.fn() }));
vi.mock("@/lib/ad-approval/ai-agents/technical-review", () => ({ runTechnicalReview: vi.fn() }));

import { processAdReviewsHandler } from "@/jobs/process-ad-reviews";
import { runPreReview } from "@/lib/ad-approval/ai-agents/pre-review";
import { enqueueAiJob } from "@/lib/ad-approval/jobs";
import { STATUS } from "@/lib/ad-approval/constants";

const mockRunPreReview = runPreReview as unknown as ReturnType<typeof vi.fn>;

function baseSetup(job: Record<string, unknown>) {
  mockPrisma.jobRun.create.mockResolvedValue({ id: "run-1" });
  mockPrisma.jobRun.update.mockResolvedValue({});
  mockPrisma.adAIJobQueue.findMany.mockResolvedValue([job]);
  mockPrisma.adAIJobQueue.update.mockResolvedValue({});
  mockPrisma.adApproval.findUnique.mockResolvedValue({
    id: "ap-1",
    campaignId: "2026-08-01-Rice-Health",
    submitterId: "user-1",
    status: STATUS.FOR_AI_PRE_REVIEW,
    version: 0,
  });
  mockPrisma.adApproval.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.adApproval.update.mockResolvedValue({});
  mockPrisma.adRevision.findFirst.mockResolvedValue({ revisionNumber: 1, copy: {}, creative: {} });
  mockPrisma.adAIReport.create.mockResolvedValue({ id: "rep-1" });
  mockPrisma.adReview.create.mockResolvedValue({});
  mockPrisma.auditLog.create.mockResolvedValue({});
}

function preReviewJob(attemptNumber: number) {
  return { id: "job-1", approvalId: "ap-1", stage: "PRE_REVIEW", attemptNumber, timeoutSeconds: 90 };
}

describe("processAdReviewsHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("advances to Brand Review and enqueues the next job on PASS", async () => {
    baseSetup(preReviewJob(1));
    mockRunPreReview.mockResolvedValue({
      agentName: "AI Pre-Review Agent",
      overallResult: "PASS",
      executiveSummary: "ok",
      validationChecks: [],
      warnings: null,
      errors: null,
      recommendations: null,
      confidenceScore: 0.95,
    });

    const result = await processAdReviewsHandler();

    expect(result.status).toBe("success");
    expect(mockPrisma.adAIReport.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.adReview.create).toHaveBeenCalledTimes(1);
    // Two transitions: for->in (start) then in->for_brand (advance).
    const statuses = mockPrisma.adApproval.updateMany.mock.calls.map((c) => c[0].data.status);
    expect(statuses).toContain(STATUS.IN_AI_PRE_REVIEW);
    expect(statuses).toContain(STATUS.FOR_BRAND_REVIEW);
    expect(enqueueAiJob).toHaveBeenCalledWith("ap-1", "BRAND_REVIEW");
  });

  it("schedules a RETRY with backoff when the agent throws (attempt 1)", async () => {
    baseSetup(preReviewJob(1));
    mockRunPreReview.mockRejectedValue(new Error("AI job timed out after 90s"));

    await processAdReviewsHandler();

    const retryUpdate = mockPrisma.adAIJobQueue.update.mock.calls
      .map((c) => c[0])
      .find((u) => u.data.status === "RETRY");
    expect(retryUpdate).toBeTruthy();
    expect(retryUpdate.data.attemptNumber).toBe(2);
    expect(retryUpdate.data.nextRetryAt).toBeInstanceOf(Date);
    // Not flagged for manual intervention yet.
    expect(mockPrisma.adApproval.update).not.toHaveBeenCalled();
  });

  it("marks FAILED and flags for manual intervention once retries are exhausted", async () => {
    baseSetup(preReviewJob(4)); // retryIndex 3 >= backoff length 3
    mockRunPreReview.mockRejectedValue(new Error("still failing"));

    await processAdReviewsHandler();

    const failedUpdate = mockPrisma.adAIJobQueue.update.mock.calls
      .map((c) => c[0])
      .find((u) => u.data.status === "FAILED");
    expect(failedUpdate).toBeTruthy();
    // flagForManualIntervention writes the flags blob.
    expect(mockPrisma.adApproval.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          flags: expect.objectContaining({ requires_manual_intervention: true }),
        }),
      }),
    );
  });
});
