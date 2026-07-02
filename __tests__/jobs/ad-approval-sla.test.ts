import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  jobRun: { create: vi.fn(), update: vi.fn() },
  adApproval: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  reviewerAssignment: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), ADMIN_RECIPIENT: "ADMIN" }));

import { adApprovalSlaHandler } from "@/jobs/ad-approval-sla";
import { STATUS, REVIEWER_ROLE } from "@/lib/ad-approval/constants";

function approval(overrides: Record<string, unknown>) {
  return {
    id: "ap",
    campaignId: "c",
    version: 1,
    assignedConversionReviewerId: "conv-1",
    assignedPenultimateApproverId: "pen-1",
    assignedFinalApproverId: "final-1",
    ...overrides,
  };
}

function findManyForGroup(status: string, rows: unknown[]) {
  mockPrisma.adApproval.findMany.mockImplementation(({ where }: { where: { status: string } }) =>
    Promise.resolve(where.status === status ? rows : []),
  );
}

describe("adApprovalSlaHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.jobRun.create.mockResolvedValue({ id: "run-1" });
    mockPrisma.jobRun.update.mockResolvedValue({});
    mockPrisma.adApproval.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.adApproval.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.reviewerAssignment.findMany.mockResolvedValue([]);
  });

  it("reassigns a stuck Conversion review to the backup when configured", async () => {
    mockPrisma.reviewerAssignment.findMany.mockResolvedValue([
      { role: REVIEWER_ROLE.CONVERSION_REVIEWER, assignedUserId: "conv-1", backupUserId: "conv-backup" },
    ]);
    findManyForGroup(STATUS.IN_CONVERSION_REVIEW, [approval({ status: STATUS.IN_CONVERSION_REVIEW })]);

    const res = await adApprovalSlaHandler();
    expect(res.summary.escalatedToBackup).toBe(1);
    expect(mockPrisma.adApproval.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedConversionReviewerId: "conv-backup" }) }),
    );
  });

  it("flags admin for a stuck Conversion review with no backup", async () => {
    findManyForGroup(STATUS.IN_CONVERSION_REVIEW, [approval({ status: STATUS.IN_CONVERSION_REVIEW })]);

    const res = await adApprovalSlaHandler();
    expect(res.summary.flaggedForAdmin).toBe(1);
    expect(mockPrisma.adApproval.update).toHaveBeenCalled(); // flag blob
  });

  it("escalates a stuck Penultimate to Final (skipping the stage) when no backup", async () => {
    mockPrisma.reviewerAssignment.findMany.mockResolvedValue([
      { role: REVIEWER_ROLE.FINAL_APPROVER, assignedUserId: "final-1", backupUserId: null },
    ]);
    findManyForGroup(STATUS.WITH_PENULTIMATE_APPROVER, [approval({ status: STATUS.WITH_PENULTIMATE_APPROVER })]);

    const res = await adApprovalSlaHandler();
    expect(res.summary.escalatedToFinal).toBe(1);
    const data = mockPrisma.adApproval.updateMany.mock.calls[0]![0].data;
    expect(data.status).toBe(STATUS.WITH_FINAL_APPROVER);
    expect(data.assignedPenultimateApproverId).toBeNull();
  });

  it("critically flags a stuck Final review (no auto-escalation)", async () => {
    findManyForGroup(STATUS.WITH_FINAL_APPROVER, [approval({ status: STATUS.WITH_FINAL_APPROVER })]);

    const res = await adApprovalSlaHandler();
    expect(res.summary.flaggedForAdmin).toBe(1);
    expect(mockPrisma.adApproval.updateMany).not.toHaveBeenCalled(); // no status change
  });
});
