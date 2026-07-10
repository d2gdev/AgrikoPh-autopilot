import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ContentProposalConflictError,
  approveProposal,
  editProposalDraft,
  reopenProposal,
  rejectProposal,
  scheduleProposal,
} from "@/lib/content-pilot/proposal-transitions";

const mockTx = vi.hoisted(() => ({
  contentProposal: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  opportunity: {
    updateMany: vi.fn(),
  },
  contentProposalDraftHistory: {
    create: vi.fn(),
  },
}));

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    status: "approved",
    draftStatus: "ready",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    draftContent: { title: "before" },
    draftGeneratedAt: null,
    draftError: null,
    scheduledPublishAt: null,
    draftGenerationToken: null,
    draftGenerationStartedAt: null,
    publishOperationId: null,
    publishStartedAt: null,
    publishFinalizedAt: null,
    publishWarning: null,
    citations: { references: [] },
    sourceData: { source: "test" },
    proposalType: "seo-fix",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("approveProposal", () => {
  it("approves only when proposal is still pending and writes audit in-tx", async () => {
    mockTx.contentProposal.findUnique
      .mockResolvedValueOnce(proposal({ status: "pending" }))
      .mockResolvedValueOnce({ ...proposal({ status: "approved" }), reviewedBy: "operator" });
    mockTx.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockTx.auditLog.create.mockResolvedValue({ id: "audit-1" });

    const { proposal: updated } = await approveProposal(mockTx, {
      id: "proposal-1",
      reviewedBy: "operator",
      reviewNote: "Looks good",
    });

    expect(updated.status).toBe("approved");
    expect(mockTx.contentProposal.updateMany).toHaveBeenCalledWith({
      where: { id: "proposal-1", status: "pending" },
      data: expect.objectContaining({
        status: "approved",
        reviewedBy: "operator",
        reviewNote: "Looks good",
      }),
    });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "approved",
        actor: "operator",
        before: { status: "pending" },
      }),
    });
  });

  it("throws conflict when approval was preempted", async () => {
    mockTx.contentProposal.findUnique.mockResolvedValueOnce(proposal({ status: "approved" }));
    mockTx.contentProposal.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      approveProposal(mockTx, {
        id: "proposal-1",
        reviewedBy: "operator",
        reviewNote: null,
      }),
    ).rejects.toBeInstanceOf(ContentProposalConflictError);
  });
});

describe("rejectProposal", () => {
  it("keeps the transition in one unit and clears publish lifecycle state", async () => {
    mockTx.contentProposal.findUnique
      .mockResolvedValueOnce(proposal({ draftStatus: "ready", status: "approved" }))
      .mockResolvedValueOnce(proposal({ status: "rejected", draftStatus: "rejected" }));
    mockTx.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockTx.opportunity.updateMany.mockResolvedValue({ count: 1 });
    mockTx.auditLog.create.mockResolvedValue({ id: "audit-1" });

    const { proposal: updated } = await rejectProposal(mockTx, {
      id: "proposal-1",
      reviewedBy: "operator",
      reviewNote: "Not needed",
    });

    expect(updated.status).toBe("rejected");
    expect(mockTx.opportunity.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.any(Object),
        data: expect.objectContaining({ status: "dismissed" }),
      }),
    );
    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "rejected",
        actor: "operator",
      }),
    });
  });

  it("rolls back when Opportunity terminaling fails", async () => {
    mockTx.contentProposal.findUnique.mockResolvedValueOnce(proposal({ draftStatus: "ready" }));
    mockTx.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockTx.opportunity.updateMany.mockRejectedValue(new Error("opportunity unavailable"));

    await expect(
      rejectProposal(mockTx, {
        id: "proposal-1",
        reviewedBy: "operator",
        reviewNote: "nope",
      }),
    ).rejects.toThrow("opportunity unavailable");

    expect(mockTx.opportunity.updateMany).toHaveBeenCalled();
    expect(mockTx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("reopenProposal", () => {
  it("throws when reopening a non-rejected proposal", async () => {
    mockTx.contentProposal.findUnique.mockResolvedValueOnce(proposal({ status: "approved" }));

    await expect(
      reopenProposal(mockTx, {
        id: "proposal-1",
        actor: "operator",
      }),
    ).rejects.toThrow("Only rejected proposals can be re-opened");
  });

  it("restores draft lifecycle fields and reroutes opportunities", async () => {
    mockTx.contentProposal.findUnique
      .mockResolvedValueOnce(proposal({ status: "rejected" }))
      .mockResolvedValueOnce(proposal({ status: "pending", draftStatus: null }));
    mockTx.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockTx.opportunity.updateMany.mockResolvedValue({ count: 1 });
    mockTx.auditLog.create.mockResolvedValue({ id: "audit-1" });

    const { proposal: reopened } = await reopenProposal(mockTx, {
      id: "proposal-1",
      actor: "operator",
    });

    expect(reopened.status).toBe("pending");
    expect(mockTx.contentProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "proposal-1", status: "rejected" },
        data: expect.objectContaining({
          status: "pending",
          draftStatus: null,
        }),
      }),
    );
    expect(mockTx.opportunity.updateMany).toHaveBeenCalled();
  });
});

describe("editProposalDraft", () => {
  it("updates the draft and appends draft history in the same tx", async () => {
    mockTx.contentProposal.findUnique
      .mockResolvedValueOnce(proposal({ draftStatus: "ready" }))
      .mockResolvedValueOnce({ ...proposal({ draftStatus: "ready" }), draftContent: { title: "updated" } });
    mockTx.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockTx.contentProposalDraftHistory.create.mockResolvedValue({ id: "hist-1" });
    mockTx.auditLog.create.mockResolvedValue({ id: "audit-1" });

    const { proposal: updated } = await editProposalDraft(mockTx, {
      id: "proposal-1",
      actor: "operator",
      draftContent: { title: "updated" },
    });

    expect(updated.draftContent).toEqual({ title: "updated" });
    expect(mockTx.contentProposalDraftHistory.create).toHaveBeenCalledWith({
      data: {
        proposalId: "proposal-1",
        savedBy: "operator",
        draftContent: { title: "updated" },
        reason: "edited",
      },
    });
    expect(mockTx.auditLog.create).toHaveBeenCalled();
  });

  it("rolls back when draft history fails", async () => {
    mockTx.contentProposal.findUnique
      .mockResolvedValueOnce(proposal({ draftStatus: "ready" }))
      .mockResolvedValueOnce({ ...proposal({ draftStatus: "ready" }), draftContent: { title: "updated" } });
    mockTx.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockTx.contentProposalDraftHistory.create.mockRejectedValue(new Error("history failed"));

    await expect(
      editProposalDraft(mockTx, {
        id: "proposal-1",
        actor: "operator",
        draftContent: { title: "updated" },
      }),
    ).rejects.toThrow("history failed");

    expect(mockTx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("scheduleProposal", () => {
  it("schedules ready approved proposals and records audit", async () => {
    const scheduled = new Date("2026-09-01T12:00:00.000Z");
    mockTx.contentProposal.findUnique
      .mockResolvedValueOnce(proposal({ status: "approved", draftStatus: "ready", scheduledPublishAt: null }))
      .mockResolvedValueOnce({ ...proposal({ status: "approved", draftStatus: "ready", scheduledPublishAt: scheduled }) });
    mockTx.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockTx.auditLog.create.mockResolvedValue({ id: "audit-1" });

    const { proposal: updated } = await scheduleProposal(mockTx, {
      id: "proposal-1",
      actor: "operator",
      scheduledPublishAt: scheduled,
    });

    expect(updated.scheduledPublishAt).toEqual(scheduled);
    expect(mockTx.contentProposal.updateMany).toHaveBeenCalledWith({
      where: {
        id: "proposal-1",
        status: { in: ["approved", "override_approved"] },
        draftStatus: "ready",
      },
      data: { scheduledPublishAt: scheduled },
    });
  });

  it("throws a typed conflict when stale publish state is detected", async () => {
    mockTx.contentProposal.findUnique.mockResolvedValueOnce(proposal({ status: "pending", draftStatus: "ready" }));
    mockTx.contentProposal.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      scheduleProposal(mockTx, {
        id: "proposal-1",
        actor: "operator",
        scheduledPublishAt: null,
      }),
    ).rejects.toBeInstanceOf(ContentProposalConflictError);
  });
});
