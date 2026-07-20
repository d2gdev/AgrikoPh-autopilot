import { beforeEach, describe, expect, it, vi } from "vitest";

const openItem = {
  id: "backlog-1",
  createdAt: new Date("2026-07-20T00:00:00.000Z"),
  updatedAt: new Date("2026-07-20T00:00:00.000Z"),
  version: 1,
  title: "Recheck Shopify cache",
  description: "Check the canonical article response.",
  dueAt: new Date("2026-07-22T15:59:59.999Z"),
  status: "open",
  createdBy: "operator-1",
  updatedBy: "operator-1",
  completedAt: null,
};

const tx = {
  backlogItem: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  auditLog: { create: vi.fn() },
};
const prisma = {
  backlogItem: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
    callback(tx)),
};

vi.mock("@/lib/db", () => ({ prisma }));

const {
  createBacklogItem,
  deleteBacklogItem,
  listBacklogItems,
  mutateBacklogItem,
} = await import("@/lib/backlog/service");

beforeEach(() => {
  vi.clearAllMocks();
  prisma.backlogItem.count
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(0);
  prisma.backlogItem.findMany.mockResolvedValue([openItem]);
  tx.backlogItem.create.mockResolvedValue(openItem);
  tx.backlogItem.findUnique.mockResolvedValue(openItem);
  tx.backlogItem.updateMany.mockResolvedValue({ count: 1 });
  tx.backlogItem.deleteMany.mockResolvedValue({ count: 1 });
  tx.auditLog.create.mockResolvedValue({ id: "audit-1" });
});

describe("backlog service", () => {
  it("lists open work by due date with truthful counts", async () => {
    const result = await listBacklogItems({ status: "open" },
      new Date("2026-07-20T00:00:00.000Z"));

    expect(result).toMatchObject({
      items: [{ id: "backlog-1", overdue: false }],
      counts: { open: 1, completed: 0 },
      asOf: "2026-07-20T00:00:00.000Z",
    });
    expect(prisma.backlogItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "open" },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: 100,
    }));
  });

  it("creates an item and its audit record atomically", async () => {
    await expect(createBacklogItem({
      title: openItem.title,
      description: openItem.description,
      dueAt: openItem.dueAt,
    }, "operator-1")).resolves.toMatchObject({
      id: openItem.id,
      createdAt: openItem.createdAt.toISOString(),
      updatedAt: openItem.updatedAt.toISOString(),
      dueAt: openItem.dueAt.toISOString(),
      overdue: false,
    });

    expect(tx.backlogItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: openItem.title,
        dueAt: openItem.dueAt,
        createdBy: "operator-1",
        updatedBy: "operator-1",
      }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "backlog_item_created",
        entityType: "BacklogItem",
        entityId: "backlog-1",
      }),
    });
  });

  it("completes only the expected open version", async () => {
    await expect(mutateBacklogItem("backlog-1", {
      action: "complete",
      expectedVersion: 1,
    }, "operator-1", new Date("2026-07-21T00:00:00.000Z")))
      .resolves.toMatchObject({ outcome: "updated" });

    expect(tx.backlogItem.updateMany).toHaveBeenCalledWith({
      where: { id: "backlog-1", version: 1, status: "open" },
      data: expect.objectContaining({
        status: "completed",
        completedAt: new Date("2026-07-21T00:00:00.000Z"),
        version: { increment: 1 },
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "backlog_item_completed" }),
    });
  });

  it("deletes only the expected version and retains an audit receipt", async () => {
    await expect(deleteBacklogItem(
      "backlog-1",
      1,
      "operator-1",
    )).resolves.toEqual({ outcome: "deleted" });

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "backlog_item_deleted",
        before: expect.objectContaining({ title: openItem.title }),
      }),
    });
    expect(tx.backlogItem.deleteMany).toHaveBeenCalledWith({
      where: { id: "backlog-1", version: 1 },
    });
  });
});
