import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { CreateSeoTaskSchema } from "@/lib/seo-tasks/contracts";
import {
  createSeoTask,
  getSeoTaskDetail,
  getSeoTaskSummary,
  listSeoTasks,
  mutateSeoTask,
} from "@/lib/seo-tasks/service";

const url = process.env.DATABASE_URL_TEST;
const parsed = url ? new URL(url) : null;
const safe = Boolean(parsed
  && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
  && parsed.pathname.slice(1) === "autopilot_test");

if (url && !safe) {
  throw new Error("DATABASE_URL_TEST must point to the guarded local autopilot_test database");
}

const stamp = `seo-lifecycle-${Date.now()}`;

describe.skipIf(!url)("PostgreSQL SEO task lifecycle", () => {
  afterAll(async () => {
    const tasks = await prisma.seoFollowUpTask.findMany({
      where: { sourceKey: { startsWith: stamp } },
      select: { id: true },
    });
    const ids = tasks.map((task) => task.id);
    if (ids.length) {
      await prisma.auditLog.deleteMany({
        where: { entityType: "seo_follow_up_task", entityId: { in: ids } },
      });
      await prisma.seoFollowUpTask.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  });

  it("creates, records evidence, completes, audits, and keeps terminal state closed", async () => {
    const now = new Date("2026-07-18T00:00:00.000Z");
    const input = CreateSeoTaskSchema.parse({
      taskType: "technical_review",
      title: `${stamp} canonical check`,
      description: "Exercise the complete local lifecycle.",
      targetUrl: "/blogs/news/rice-nutrition-breakdown",
      topicalCluster: "rice-nutrition",
      pageRole: "nutrition-pillar",
      ownerSurface: "seo",
      destinationPath: "/seo-pillar",
      priority: "P1",
      earliestReviewAt: "2026-07-17T00:00:00.000Z",
      dueAt: null,
      requiresEvidence: true,
      evidenceRequirement: { checks: ["selected canonical"] },
      evidenceStatus: "waiting",
      evidenceSnapshot: null,
      sourceType: "operator",
      sourceKey: `${stamp}:canonical`,
      sourceData: { test: true },
    });

    const created = await createSeoTask(input, "integration-operator");
    expect(created.outcome).toBe("created");
    if (created.outcome !== "created") throw new Error("Expected task creation");

    const before = await listSeoTasks({
      bucket: "waiting",
      priority: "all",
      taskType: "all",
      q: "",
      page: 1,
      pageSize: 100,
    }, now);
    const summary = await getSeoTaskSummary(now);
    expect(summary.ready).toBe(before.counts.ready);
    expect(summary.waiting).toBe(before.counts.waiting);

    const evidence = await mutateSeoTask(created.task.id, {
      action: "update_evidence",
      expectedVersion: 1,
      evidenceStatus: "sufficient",
      evidenceSnapshot: { selectedCanonical: input.targetUrl, checkedAt: now.toISOString() },
    }, "integration-operator", now);
    expect(evidence).toMatchObject({ outcome: "updated", task: { version: 2, evidenceStatus: "sufficient" } });

    const completed = await mutateSeoTask(created.task.id, {
      action: "complete",
      expectedVersion: 2,
      note: "Canonical selection verified.",
      decisionData: { decision: "close" },
    }, "integration-operator", now);
    expect(completed).toMatchObject({ outcome: "updated", task: { version: 3, status: "completed" } });

    const detail = await getSeoTaskDetail(created.task.id);
    expect(detail?.history.map((entry) => entry.action)).toEqual([
      "seo_follow_up_task_completed",
      "seo_follow_up_task_evidence_updated",
      "seo_follow_up_task_created",
    ]);

    await expect(mutateSeoTask(created.task.id, {
      action: "edit",
      expectedVersion: 3,
      fields: { title: "Reopened title" },
    }, "integration-operator", now)).resolves.toMatchObject({
      outcome: "invalid_transition",
    });
  });
});
