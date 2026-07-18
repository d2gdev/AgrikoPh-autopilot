import { beforeEach, describe, expect, it, vi } from "vitest";

const taskRow = {
  id: "task-1",
  createdAt: new Date("2026-07-10T00:00:00.000Z"),
  updatedAt: new Date("2026-07-10T00:00:00.000Z"),
  version: 1,
  taskType: "ctr_experiment_review",
  title: "Rice nutrition CTR",
  description: "Review the finalized experiment.",
  targetUrl: "/blogs/news/rice-nutrition-breakdown",
  topicalCluster: "rice-nutrition",
  pageRole: "nutrition-pillar",
  ownerSurface: "seo",
  destinationPath: "/seo-pillar",
  priority: "P1",
  earliestReviewAt: new Date("2026-07-17T00:00:00.000Z"),
  dueAt: null,
  requiresEvidence: true,
  evidenceRequirement: { metrics: ["clicks"] },
  evidenceStatus: "sufficient",
  evidenceSnapshot: { clicks: 4 },
  lastEvaluatedAt: new Date("2026-07-18T00:00:00.000Z"),
  sourceType: "operator",
  sourceKey: "rice-ctr-july",
  sourceData: { test: true },
  status: "open",
  createdBy: "operator",
  updatedBy: "operator",
  completedAt: null,
  completionNote: null,
  decisionData: null,
  dedupeKey: "seo-follow-up:key",
};

const tx = {
  seoFollowUpTask: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  contentProposal: { findMany: vi.fn() },
  auditLog: { create: vi.fn(), findFirst: vi.fn() },
};

const mockPrisma = {
  seoFollowUpTask: {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  contentProposal: { findMany: vi.fn() },
  auditLog: { findMany: vi.fn() },
  $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const {
  createSeoTask,
  getSeoTaskDetail,
  listSeoTasks,
  mutateSeoTask,
} = await import("@/lib/seo-tasks/service");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.seoFollowUpTask.findMany.mockReset();
  mockPrisma.auditLog.findMany.mockReset();
  tx.seoFollowUpTask.findUnique.mockReset();
  tx.seoFollowUpTask.findFirst.mockReset();
  tx.seoFollowUpTask.updateMany.mockReset();
  tx.auditLog.findFirst.mockReset();
  mockPrisma.seoFollowUpTask.count
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce(3)
    .mockResolvedValueOnce(7);
  mockPrisma.seoFollowUpTask.findMany.mockImplementation(async (args) =>
    args?.where?.status?.in ? [] : [taskRow]);
  mockPrisma.seoFollowUpTask.findFirst.mockResolvedValue(null);
  mockPrisma.seoFollowUpTask.findUnique.mockResolvedValue(null);
  mockPrisma.auditLog.findMany.mockResolvedValue([]);
  mockPrisma.contentProposal.findMany.mockResolvedValue([]);
  tx.seoFollowUpTask.create.mockResolvedValue(taskRow);
  tx.seoFollowUpTask.findUnique.mockResolvedValue(null);
  tx.seoFollowUpTask.findFirst.mockResolvedValue(null);
  tx.auditLog.findFirst.mockResolvedValue(null);
  tx.contentProposal.findMany.mockResolvedValue([]);
  tx.auditLog.create.mockResolvedValue({ id: "audit-1" });
});

describe("listSeoTasks", () => {
  it("returns bounded rows and database-backed bucket counts", async () => {
    const result = await listSeoTasks({
      bucket: "ready",
      priority: "all",
      taskType: "all",
      q: "",
      page: 1,
      pageSize: 25,
    }, new Date("2026-07-18T00:00:00.000Z"));

    expect(result).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 25,
      hasMore: false,
      counts: { ready: 1, waiting: 2, scheduled: 3, closed: 7 },
      tasks: [{
        id: "task-1",
        bucket: "ready",
        overdue: false,
        completionPreflight: {
          status: "clear",
          basis: "task_and_audit_history",
          checkedAt: "2026-07-18T00:00:00.000Z",
        },
      }],
    });
    expect(result.tasks[0]).not.toHaveProperty("dedupeKey");
    expect(result.tasks[0]).not.toHaveProperty("sourceData");
    expect(result.tasks[0]).not.toHaveProperty("evidenceRequirement");
    expect(result.tasks[0]).not.toHaveProperty("evidenceSnapshot");
    expect(mockPrisma.seoFollowUpTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 25,
      skip: 0,
      orderBy: [{ priority: "asc" }, { earliestReviewAt: "asc" }, { id: "asc" }],
    }));
  });

  it("flags an open row when a terminal task already has the same immutable source identity", async () => {
    mockPrisma.seoFollowUpTask.findMany
      .mockResolvedValueOnce([taskRow])
      .mockResolvedValueOnce([{
        id: "completed-task",
        taskType: taskRow.taskType,
        sourceType: taskRow.sourceType,
        sourceKey: taskRow.sourceKey,
        status: "completed",
      }]);

    const result = await listSeoTasks({
      bucket: "ready",
      priority: "all",
      taskType: "all",
      q: "",
      page: 1,
      pageSize: 25,
    }, new Date("2026-07-18T00:00:00.000Z"));

    expect(result.tasks[0]).toMatchObject({
      id: "task-1",
      completionPreflight: {
        status: "already_handled",
        basis: "task_and_audit_history",
      },
    });
  });

  it("flags an inconsistent open row with its own terminal audit receipt", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([{
      entityId: "task-1",
      action: "seo_follow_up_task_completed",
    }]);

    const result = await listSeoTasks({
      bucket: "ready",
      priority: "all",
      taskType: "all",
      q: "",
      page: 1,
      pageSize: 25,
    }, new Date("2026-07-18T00:00:00.000Z"));

    expect(result.tasks[0]?.completionPreflight.status).toBe("already_handled");
  });

  it("rechecks Content Proposal history for mapped content rows", async () => {
    const mappedTask = {
      ...taskRow,
      taskType: "content_quality_review",
      sourceType: "topical_map",
      sourceKey: `topical-map-content:strategy-1:${"b".repeat(64)}`,
      sourceData: {
        candidateId: "b".repeat(64),
        action: "refresh",
        mapTitle: "Rice nutrition",
      },
    };
    mockPrisma.seoFollowUpTask.findMany.mockImplementation(async (args) =>
      args?.where?.status?.in ? [] : [mappedTask]);
    mockPrisma.contentProposal.findMany.mockResolvedValue([{
      id: "proposal-1",
      dedupeKey: "content-refresh:article:rice-nutrition-breakdown",
    }]);

    const result = await listSeoTasks({
      bucket: "ready",
      priority: "all",
      taskType: "all",
      q: "",
      page: 1,
      pageSize: 25,
    }, new Date("2026-07-18T00:00:00.000Z"));

    expect(result.tasks[0]?.completionPreflight.status).toBe("already_handled");
  });
});

describe("getSeoTaskDetail", () => {
  it("bounds the audit timeline to the newest 100 entries", async () => {
    mockPrisma.seoFollowUpTask.findUnique.mockResolvedValue(taskRow);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);

    await expect(getSeoTaskDetail("task-1")).resolves.toMatchObject({ task: { id: "task-1" }, history: [] });
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 100,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        action: true,
        actor: true,
        createdAt: true,
      },
    }));
  });
});

describe("createSeoTask", () => {
  it("creates the task and audit record in one transaction", async () => {
    const result = await createSeoTask({
      taskType: "ctr_experiment_review",
      title: "Rice nutrition CTR",
      description: "Review the finalized experiment.",
      targetUrl: "https://agrikoph.com/blogs/news/rice-nutrition-breakdown",
      topicalCluster: "rice-nutrition",
      pageRole: "nutrition-pillar",
      ownerSurface: "seo",
      destinationPath: "/seo-pillar",
      priority: "P1",
      earliestReviewAt: new Date("2026-07-17T00:00:00.000Z"),
      dueAt: null,
      requiresEvidence: true,
      evidenceRequirement: { metrics: ["clicks"] },
      evidenceStatus: "waiting",
      evidenceSnapshot: null,
      lastEvaluatedAt: null,
      sourceType: "operator",
      sourceKey: "rice-ctr-july",
      sourceData: { test: true },
    }, "operator");

    expect(result).toMatchObject({ outcome: "created", task: { id: "task-1" } });
    expect(tx.seoFollowUpTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetUrl: "/blogs/news/rice-nutrition-breakdown",
        createdBy: "operator",
        updatedBy: "operator",
        dedupeKey: expect.stringMatching(/^seo-follow-up:/),
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: "operator",
        action: "seo_follow_up_task_created",
        entityType: "seo_follow_up_task",
        entityId: "task-1",
      }),
    });
  });

  it("returns the existing task ID after a unique-key race", async () => {
    tx.seoFollowUpTask.create.mockRejectedValueOnce({ code: "P2002" });
    mockPrisma.seoFollowUpTask.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing-1" });

    const result = await createSeoTask({
      taskType: "other",
      title: "Existing",
      description: "Existing",
      targetUrl: null,
      topicalCluster: null,
      pageRole: null,
      ownerSurface: "seo",
      destinationPath: null,
      priority: "P2",
      earliestReviewAt: new Date("2026-08-01T00:00:00.000Z"),
      dueAt: null,
      requiresEvidence: false,
      evidenceRequirement: {},
      evidenceStatus: "not_required",
      evidenceSnapshot: null,
      lastEvaluatedAt: null,
      sourceType: "operator",
      sourceKey: "existing",
      sourceData: {},
    }, "operator");

    expect(result).toEqual({ outcome: "duplicate", existingId: "existing-1" });
  });

  it("returns a known duplicate without attempting a noisy insert", async () => {
    mockPrisma.seoFollowUpTask.findFirst.mockResolvedValueOnce({ id: "existing-1" });

    const result = await createSeoTask({
      taskType: "other",
      title: "Existing",
      description: "Existing",
      targetUrl: null,
      topicalCluster: null,
      pageRole: null,
      ownerSurface: "seo",
      destinationPath: null,
      priority: "P2",
      earliestReviewAt: new Date("2026-08-01T00:00:00.000Z"),
      dueAt: null,
      requiresEvidence: false,
      evidenceRequirement: {},
      evidenceStatus: "not_required",
      evidenceSnapshot: null,
      lastEvaluatedAt: null,
      sourceType: "operator",
      sourceKey: "existing",
      sourceData: {},
    }, "operator");

    expect(result).toEqual({ outcome: "duplicate", existingId: "existing-1" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(tx.seoFollowUpTask.create).not.toHaveBeenCalled();
  });

  it("recognizes an existing task by immutable source identity", async () => {
    mockPrisma.seoFollowUpTask.findFirst.mockResolvedValueOnce({ id: "existing-1" });

    const result = await createSeoTask({
      taskType: "other",
      title: "A renamed display title",
      description: "Existing",
      targetUrl: "/blogs/news/a-new-target",
      topicalCluster: null,
      pageRole: null,
      ownerSurface: "seo",
      destinationPath: null,
      priority: "P2",
      earliestReviewAt: new Date("2026-08-01T00:00:00.000Z"),
      dueAt: null,
      requiresEvidence: false,
      evidenceRequirement: {},
      evidenceStatus: "not_required",
      evidenceSnapshot: null,
      lastEvaluatedAt: null,
      sourceType: "operator",
      sourceKey: "existing",
      sourceData: {},
    }, "operator");

    expect(result).toEqual({ outcome: "duplicate", existingId: "existing-1" });
    expect(mockPrisma.seoFollowUpTask.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { dedupeKey: expect.stringMatching(/^seo-follow-up:/) },
          {
            taskType: "other",
            sourceType: "operator",
            sourceKey: "existing",
          },
        ],
      },
      select: { id: true },
    });
  });
});

describe("mutateSeoTask", () => {
  it("completes an evidence-ready task with a version guard and atomic audit", async () => {
    tx.seoFollowUpTask.findUnique
      .mockResolvedValueOnce(taskRow)
      .mockResolvedValueOnce({ ...taskRow, version: 2, status: "completed", completionNote: "CTR improved." });
    tx.seoFollowUpTask.updateMany.mockResolvedValue({ count: 1 });

    const result = await mutateSeoTask("task-1", {
      action: "complete",
      expectedVersion: 1,
      note: "CTR improved.",
      decisionData: { decision: "retain" },
    }, "operator", new Date("2026-07-18T00:00:00.000Z"));

    expect(result).toMatchObject({ outcome: "updated", task: { version: 2, status: "completed" } });
    expect(tx.seoFollowUpTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-1", version: 1 },
      data: expect.objectContaining({ version: { increment: 1 }, status: "completed" }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "seo_follow_up_task_completed",
        entityId: "task-1",
      }),
    });
  });

  it("rejects missing completion evidence, terminal changes, and stale versions", async () => {
    tx.seoFollowUpTask.findUnique.mockResolvedValueOnce({
      ...taskRow,
      evidenceStatus: "waiting",
      evidenceSnapshot: null,
    });
    await expect(mutateSeoTask("task-1", {
      action: "complete",
      expectedVersion: 1,
      note: "Done.",
    }, "operator", new Date())).resolves.toMatchObject({ outcome: "invalid_transition" });

    tx.seoFollowUpTask.findUnique.mockResolvedValueOnce({ ...taskRow, status: "cancelled" });
    await expect(mutateSeoTask("task-1", {
      action: "edit",
      expectedVersion: 1,
      fields: { title: "Changed" },
    }, "operator", new Date())).resolves.toMatchObject({ outcome: "invalid_transition" });

    tx.seoFollowUpTask.findUnique.mockResolvedValueOnce(taskRow);
    tx.seoFollowUpTask.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(mutateSeoTask("task-1", {
      action: "cancel",
      expectedVersion: 1,
      note: "Superseded.",
    }, "operator", new Date())).resolves.toEqual({ outcome: "conflict" });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects completion before the earliest review date", async () => {
    tx.seoFollowUpTask.findUnique.mockResolvedValueOnce({
      ...taskRow,
      earliestReviewAt: new Date("2026-07-20T00:00:00.000Z"),
    });

    await expect(mutateSeoTask("task-1", {
      action: "complete",
      expectedVersion: 1,
      note: "Reviewed early.",
    }, "operator", new Date("2026-07-18T00:00:00.000Z"))).resolves.toMatchObject({
      outcome: "invalid_transition",
      message: expect.stringContaining("review date"),
    });
    expect(tx.seoFollowUpTask.updateMany).not.toHaveBeenCalled();
  });

  it("does not erase evidence when an edit repeats the current evidence mode", async () => {
    tx.seoFollowUpTask.findUnique
      .mockResolvedValueOnce(taskRow)
      .mockResolvedValueOnce({ ...taskRow, title: "Updated title", version: 2 });
    tx.seoFollowUpTask.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(mutateSeoTask("task-1", {
      action: "edit",
      expectedVersion: 1,
      fields: {
        title: "Updated title",
        requiresEvidence: true,
      },
    }, "operator", new Date("2026-07-18T00:00:00.000Z"))).resolves.toMatchObject({
      outcome: "updated",
    });

    const update = tx.seoFollowUpTask.updateMany.mock.calls[0]?.[0];
    expect(update.data).not.toHaveProperty("evidenceStatus");
    expect(update.data).not.toHaveProperty("evidenceSnapshot");
  });

  it("blocks mutations when a terminal task already has the same immutable source identity", async () => {
    tx.seoFollowUpTask.findUnique.mockResolvedValueOnce(taskRow);
    tx.seoFollowUpTask.findFirst.mockResolvedValueOnce({ id: "completed-task" });

    await expect(mutateSeoTask("task-1", {
      action: "complete",
      expectedVersion: 1,
      note: "Done.",
    }, "operator", new Date("2026-07-18T00:00:00.000Z"))).resolves.toMatchObject({
      outcome: "invalid_transition",
      message: expect.stringContaining("prior completion"),
    });
    expect(tx.seoFollowUpTask.updateMany).not.toHaveBeenCalled();
  });

  it("rechecks Content Proposal history inside mapped task mutations", async () => {
    tx.seoFollowUpTask.findUnique.mockResolvedValueOnce({
      ...taskRow,
      taskType: "content_quality_review",
      sourceType: "topical_map",
      sourceKey: `topical-map-content:strategy-1:${"b".repeat(64)}`,
      sourceData: {
        candidateId: "b".repeat(64),
        action: "refresh",
        mapTitle: "Rice nutrition",
      },
    });
    tx.contentProposal.findMany.mockResolvedValueOnce([{
      id: "proposal-1",
      dedupeKey: "content-refresh:article:rice-nutrition-breakdown",
    }]);

    await expect(mutateSeoTask("task-1", {
      action: "complete",
      expectedVersion: 1,
      note: "Done.",
    }, "operator", new Date("2026-07-18T00:00:00.000Z"))).resolves.toMatchObject({
      outcome: "invalid_transition",
      message: expect.stringContaining("already queued or completed"),
    });
    expect(tx.seoFollowUpTask.updateMany).not.toHaveBeenCalled();
  });
});
