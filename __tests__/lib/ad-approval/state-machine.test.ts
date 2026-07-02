import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  adApproval: {
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { transition, flagForManualIntervention } from "@/lib/ad-approval/state-machine";
import {
  STATUS,
  isTransitionAllowed,
  ALLOWED_TRANSITIONS,
  TERMINAL_STATUSES,
} from "@/lib/ad-approval/constants";

describe("ad-approval transition table", () => {
  it("allows the documented happy-path edges", () => {
    expect(isTransitionAllowed(STATUS.DRAFT, STATUS.FOR_AI_PRE_REVIEW)).toBe(true);
    expect(isTransitionAllowed(STATUS.IN_AI_PRE_REVIEW, STATUS.FOR_BRAND_REVIEW)).toBe(true);
    expect(isTransitionAllowed(STATUS.IN_CONVERSION_REVIEW, STATUS.FOR_TECHNICAL_REVIEW)).toBe(true);
    expect(isTransitionAllowed(STATUS.IN_TECHNICAL_REVIEW, STATUS.WITH_PENULTIMATE_APPROVER)).toBe(true);
    expect(isTransitionAllowed(STATUS.IN_TECHNICAL_REVIEW, STATUS.WITH_FINAL_APPROVER)).toBe(true); // conflict escalation
    expect(isTransitionAllowed(STATUS.WITH_FINAL_APPROVER, STATUS.APPROVED)).toBe(true);
    expect(isTransitionAllowed(STATUS.NEEDS_REVISION, STATUS.DRAFT)).toBe(true);
  });

  it("rejects illegal edges and skipping stages", () => {
    expect(isTransitionAllowed(STATUS.DRAFT, STATUS.APPROVED)).toBe(false);
    expect(isTransitionAllowed(STATUS.DRAFT, STATUS.WITH_FINAL_APPROVER)).toBe(false);
    expect(isTransitionAllowed(STATUS.FOR_CONVERSION_REVIEW, STATUS.FOR_TECHNICAL_REVIEW)).toBe(false);
  });

  it("permits no transitions out of terminal states", () => {
    for (const terminal of TERMINAL_STATUSES) {
      expect(ALLOWED_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});

describe("transition()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("performs a versioned CAS and writes an audit row on success", async () => {
    mockPrisma.adApproval.updateMany.mockResolvedValue({ count: 1 });

    const result = await transition({
      approvalId: "ap-1",
      from: STATUS.DRAFT,
      to: STATUS.FOR_AI_PRE_REVIEW,
      version: 0,
      actor: "user-1",
      action: "SUBMITTED",
    });

    expect(result).toEqual({ ok: true, version: 1 });
    expect(mockPrisma.adApproval.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ap-1", status: STATUS.DRAFT, version: 0 },
        data: expect.objectContaining({ status: STATUS.FOR_AI_PRE_REVIEW, version: 1 }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("returns invalid_transition without touching the DB for illegal edges", async () => {
    const result = await transition({
      approvalId: "ap-1",
      from: STATUS.DRAFT,
      to: STATUS.APPROVED,
      version: 0,
      actor: "user-1",
      action: "APPROVED",
    });

    expect(result).toEqual({ ok: false, reason: "invalid_transition" });
    expect(mockPrisma.adApproval.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("returns lost_race when the CAS matches no row (stale status or version)", async () => {
    mockPrisma.adApproval.updateMany.mockResolvedValue({ count: 0 });

    const result = await transition({
      approvalId: "ap-1",
      from: STATUS.DRAFT,
      to: STATUS.FOR_AI_PRE_REVIEW,
      version: 5,
      actor: "user-1",
      action: "SUBMITTED",
    });

    expect(result).toEqual({ ok: false, reason: "lost_race" });
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("merges extra column updates into the transition", async () => {
    mockPrisma.adApproval.updateMany.mockResolvedValue({ count: 1 });

    await transition({
      approvalId: "ap-1",
      from: STATUS.WITH_FINAL_APPROVER,
      to: STATUS.APPROVED,
      version: 3,
      actor: "final-1",
      action: "APPROVED",
      data: { approvedAt: new Date("2026-07-15T00:00:00.000Z") },
    });

    const call = mockPrisma.adApproval.updateMany.mock.calls[0]![0];
    expect(call.data.approvedAt).toEqual(new Date("2026-07-15T00:00:00.000Z"));
    expect(call.data.status).toBe(STATUS.APPROVED);
  });
});

describe("flagForManualIntervention()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets the flags blob and writes an audit row", async () => {
    mockPrisma.adApproval.update.mockResolvedValue({});

    await flagForManualIntervention({ approvalId: "ap-1", reason: "AI job timeout after 3 retries" });

    expect(mockPrisma.adApproval.update).toHaveBeenCalledWith({
      where: { id: "ap-1" },
      data: { flags: { requires_manual_intervention: true, reason: "AI job timeout after 3 retries" } },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
