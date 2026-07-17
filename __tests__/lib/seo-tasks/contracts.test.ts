import { describe, expect, it } from "vitest";
import {
  CreateSeoTaskSchema,
  SeoTaskMutationSchema,
} from "@/lib/seo-tasks/contracts";

const baseTask = {
  taskType: "technical_review",
  title: "Review index coverage",
  description: "Review the current index coverage evidence.",
  priority: "P1",
  earliestReviewAt: "2026-07-18T00:00:00.000Z",
  requiresEvidence: true,
  evidenceRequirement: { checks: ["coverage"] },
  evidenceStatus: "waiting",
  evidenceSnapshot: null,
  sourceType: "operator",
  sourceKey: "index-coverage-2026-07",
  sourceData: {},
};

describe("SEO task evidence contracts", () => {
  it("rejects contradictory create-time evidence states", () => {
    expect(CreateSeoTaskSchema.safeParse({
      ...baseTask,
      evidenceStatus: "not_required",
    }).success).toBe(false);

    expect(CreateSeoTaskSchema.safeParse({
      ...baseTask,
      requiresEvidence: false,
      evidenceStatus: "sufficient",
      evidenceSnapshot: { coverage: 10 },
    }).success).toBe(false);

    expect(CreateSeoTaskSchema.safeParse({
      ...baseTask,
      requiresEvidence: false,
      evidenceStatus: "not_required",
      evidenceSnapshot: { coverage: 10 },
    }).success).toBe(false);
  });

  it("requires a snapshot whenever evidence is marked sufficient", () => {
    expect(CreateSeoTaskSchema.safeParse({
      ...baseTask,
      evidenceStatus: "sufficient",
      evidenceSnapshot: null,
    }).success).toBe(false);

    expect(SeoTaskMutationSchema.safeParse({
      action: "update_evidence",
      expectedVersion: 1,
      evidenceStatus: "sufficient",
      evidenceSnapshot: null,
    }).success).toBe(false);
  });
});
