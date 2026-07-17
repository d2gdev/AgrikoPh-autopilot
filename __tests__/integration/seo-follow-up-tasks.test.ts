import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

const url = process.env.DATABASE_URL_TEST;
const parsed = url ? new URL(url) : null;
const safe = Boolean(parsed
  && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
  && parsed.pathname.slice(1) === "autopilot_test");

if (url && !safe) {
  throw new Error("DATABASE_URL_TEST must point to the guarded local autopilot_test database");
}

const prefix = `seo-follow-up-integration-${Date.now()}`;

describe.skipIf(!url)("PostgreSQL SEO follow-up task persistence", () => {
  beforeEach(async () => {
    await prisma.seoFollowUpTask.deleteMany({ where: { sourceKey: { startsWith: prefix } } });
  });

  afterAll(async () => {
    await prisma.seoFollowUpTask.deleteMany({ where: { sourceKey: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  it("persists the complete task contract", async () => {
    const task = await prisma.seoFollowUpTask.create({
      data: {
        taskType: "ctr_experiment_review",
        title: "PostgreSQL SEO follow-up",
        description: "Proves the complete persistence contract.",
        targetUrl: "/blogs/news/rice-nutrition-breakdown",
        topicalCluster: "rice-nutrition",
        pageRole: "nutrition-pillar",
        ownerSurface: "seo",
        destinationPath: "/seo-pillar",
        priority: "P1",
        earliestReviewAt: new Date("2026-07-29T00:00:00.000Z"),
        dueAt: null,
        requiresEvidence: true,
        evidenceRequirement: { metrics: ["clicks", "impressions", "ctr"] },
        evidenceStatus: "waiting",
        lastEvaluatedAt: null,
        sourceType: "operator",
        sourceKey: `${prefix}-complete`,
        sourceData: { test: true },
        status: "open",
        createdBy: "integration-test",
        updatedBy: "integration-test",
        dedupeKey: `${prefix}-dedupe`,
      },
    });

    await expect(prisma.seoFollowUpTask.findUnique({ where: { id: task.id } })).resolves.toMatchObject({
      version: 1,
      taskType: "ctr_experiment_review",
      targetUrl: "/blogs/news/rice-nutrition-breakdown",
      status: "open",
    });
  });

  it("enforces dedupeKey uniqueness", async () => {
    const data = {
      taskType: "other",
      title: "Duplicate guard",
      description: "Duplicate guard",
      priority: "P2",
      earliestReviewAt: new Date("2026-08-01T00:00:00.000Z"),
      evidenceRequirement: {},
      sourceType: "operator",
      sourceKey: `${prefix}-duplicate`,
      sourceData: {},
      createdBy: "integration-test",
      updatedBy: "integration-test",
      dedupeKey: `${prefix}-same-key`,
    };

    await prisma.seoFollowUpTask.create({ data });
    await expect(prisma.seoFollowUpTask.create({
      data: { ...data, sourceKey: `${prefix}-duplicate-second` },
    })).rejects.toMatchObject({ code: "P2002" });
  });
});
