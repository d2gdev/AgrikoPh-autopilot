import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  adApproval: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  reviewerAssignment: { findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), ADMIN_RECIPIENT: "ADMIN" }));

import { transitionToPenultimate, transitionToFinal } from "@/lib/ad-approval/conflict";
import { STATUS, REVIEWER_ROLE } from "@/lib/ad-approval/constants";

function roleRow(role: string, assignedUserId: string, backupUserId: string | null = null) {
  return { role, assignedUserId, backupUserId };
}

describe("transitionToPenultimate (Transition A, worker)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.adApproval.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.adApproval.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  it("advances to Penultimate when there is no conflict", async () => {
    mockPrisma.adApproval.findUnique.mockResolvedValue({ id: "ap", campaignId: "c", submitterId: "user-1", version: 3 });
    mockPrisma.reviewerAssignment.findUnique.mockImplementation(({ where }: { where: { role: string } }) =>
      Promise.resolve(where.role === REVIEWER_ROLE.PENULTIMATE_APPROVER ? roleRow(where.role, "pen-1") : null),
    );

    const res = await transitionToPenultimate("ap");
    expect(res).toEqual({ ok: true, escalated: false });
    const to = mockPrisma.adApproval.updateMany.mock.calls[0]![0].data.status;
    expect(to).toBe(STATUS.WITH_PENULTIMATE_APPROVER);
  });

  it("escalates to Final when the submitter IS the Penultimate Approver", async () => {
    mockPrisma.adApproval.findUnique.mockResolvedValue({ id: "ap", campaignId: "c", submitterId: "pen-1", version: 3 });
    mockPrisma.reviewerAssignment.findUnique.mockImplementation(({ where }: { where: { role: string } }) =>
      Promise.resolve(
        where.role === REVIEWER_ROLE.PENULTIMATE_APPROVER
          ? roleRow(where.role, "pen-1")
          : where.role === REVIEWER_ROLE.FINAL_APPROVER
            ? roleRow(where.role, "final-1")
            : null,
      ),
    );

    const res = await transitionToPenultimate("ap");
    expect(res).toEqual({ ok: true, escalated: true });
    expect(mockPrisma.adApproval.updateMany.mock.calls[0]![0].data.status).toBe(STATUS.WITH_FINAL_APPROVER);
  });

  it("blocks when the Penultimate role is unassigned", async () => {
    mockPrisma.adApproval.findUnique.mockResolvedValue({ id: "ap", campaignId: "c", submitterId: "user-1", version: 3 });
    mockPrisma.reviewerAssignment.findUnique.mockResolvedValue(null);

    const res = await transitionToPenultimate("ap");
    expect(res.ok).toBe(false);
    expect(mockPrisma.adApproval.update).toHaveBeenCalled(); // flagged
  });

  it("blocks (never self-assigns) when the submitter is BOTH Penultimate and Final Approver", async () => {
    mockPrisma.adApproval.findUnique.mockResolvedValue({ id: "ap", campaignId: "c", submitterId: "both-1", version: 3 });
    mockPrisma.reviewerAssignment.findUnique.mockImplementation(({ where }: { where: { role: string } }) =>
      Promise.resolve(
        where.role === REVIEWER_ROLE.PENULTIMATE_APPROVER
          ? roleRow(where.role, "both-1")
          : where.role === REVIEWER_ROLE.FINAL_APPROVER
            ? roleRow(where.role, "both-1")
            : null,
      ),
    );

    const res = await transitionToPenultimate("ap");
    expect(res).toEqual({ ok: false, blocked: expect.stringContaining("CONFLICT_UNRESOLVABLE") });
    // No status transition happened — the ad must not land with its own submitter.
    expect(mockPrisma.adApproval.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.adApproval.update).toHaveBeenCalled(); // flagged for manual intervention
  });
});

describe("transitionToFinal (Transition B, HTTP)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.adApproval.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.adApproval.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  const approval = { id: "ap", campaignId: "c", submitterId: "user-1", version: 4 };

  it("advances to Final when there is no conflict", async () => {
    mockPrisma.reviewerAssignment.findUnique.mockResolvedValue(roleRow(REVIEWER_ROLE.FINAL_APPROVER, "final-1"));
    const res = await transitionToFinal(approval);
    expect(res).toEqual({ ok: true });
  });

  it("returns 503 when the Final role is unassigned", async () => {
    mockPrisma.reviewerAssignment.findUnique.mockResolvedValue(null);
    const res = await transitionToFinal(approval);
    expect(res).toEqual(expect.objectContaining({ ok: false, httpStatus: 503 }));
  });

  it("returns 409 when the submitter IS the Final Approver (unresolvable)", async () => {
    mockPrisma.reviewerAssignment.findUnique.mockResolvedValue(roleRow(REVIEWER_ROLE.FINAL_APPROVER, "user-1"));
    const res = await transitionToFinal(approval);
    expect(res).toEqual(expect.objectContaining({ ok: false, httpStatus: 409 }));
    expect(mockPrisma.adApproval.update).toHaveBeenCalled(); // flagged for manual intervention
  });
});
