import { describe, expect, it } from "vitest";
import {
  buildSeoTaskDedupeKey,
  deriveSeoTaskBucket,
  isSeoTaskOverdue,
} from "@/lib/seo-tasks/readiness";

const now = new Date("2026-07-18T00:00:00.000Z");

function task(
  overrides: Partial<{
    status: "open" | "completed" | "cancelled";
    earliestReviewAt: Date;
    requiresEvidence: boolean;
    evidenceStatus: "waiting" | "insufficient" | "sufficient" | "not_required";
    evidenceSnapshot: unknown | null;
    dueAt: Date | null;
  }> = {},
) {
  return {
    status: "open" as const,
    earliestReviewAt: new Date("2026-07-18T00:00:00.000Z"),
    requiresEvidence: true,
    evidenceStatus: "waiting" as const,
    evidenceSnapshot: null,
    dueAt: null,
    ...overrides,
  };
}

describe("deriveSeoTaskBucket", () => {
  it("places completed and cancelled tasks in closed", () => {
    expect(deriveSeoTaskBucket(task({ status: "completed" }), now)).toBe("closed");
    expect(deriveSeoTaskBucket(task({ status: "cancelled" }), now)).toBe("closed");
  });

  it("places future open tasks in scheduled regardless of evidence", () => {
    expect(deriveSeoTaskBucket(task({
      earliestReviewAt: new Date("2026-07-19T00:00:00.000Z"),
      evidenceStatus: "sufficient",
    }), now)).toBe("scheduled");
  });

  it("places arrived tasks with sufficient evidence in ready", () => {
    expect(deriveSeoTaskBucket(task({
      evidenceStatus: "sufficient",
      evidenceSnapshot: { clicks: 4 },
    }), now)).toBe("ready");
  });

  it("keeps sufficient evidence without a snapshot out of ready", () => {
    expect(deriveSeoTaskBucket(task({
      evidenceStatus: "sufficient",
      evidenceSnapshot: null,
    }), now)).toBe("waiting");
  });

  it("places arrived tasks that require no evidence in ready only when marked not required", () => {
    expect(deriveSeoTaskBucket(task({
      requiresEvidence: false,
      evidenceStatus: "not_required",
    }), now)).toBe("ready");
    expect(deriveSeoTaskBucket(task({
      requiresEvidence: false,
      evidenceStatus: "waiting",
    }), now)).toBe("waiting");
  });

  it("places every other arrived open task in waiting", () => {
    expect(deriveSeoTaskBucket(task({ evidenceStatus: "waiting" }), now)).toBe("waiting");
    expect(deriveSeoTaskBucket(task({ evidenceStatus: "insufficient" }), now)).toBe("waiting");
  });
});

describe("isSeoTaskOverdue", () => {
  it("labels only open tasks whose due date is before now", () => {
    expect(isSeoTaskOverdue(task({ dueAt: new Date("2026-07-17T23:59:59.000Z") }), now)).toBe(true);
    expect(isSeoTaskOverdue(task({ dueAt: now }), now)).toBe(false);
    expect(isSeoTaskOverdue(task({ status: "completed", dueAt: new Date("2026-07-17T00:00:00.000Z") }), now)).toBe(false);
    expect(isSeoTaskOverdue(task(), now)).toBe(false);
  });
});

describe("buildSeoTaskDedupeKey", () => {
  it("uses immutable source identity instead of editable display fields", () => {
    const first = buildSeoTaskDedupeKey({
      taskType: "ctr_experiment_review",
      sourceType: "operator",
      sourceKey: " CTR-2026-07 ",
      title: "Old title",
      targetUrl: "/old-path",
    } as Parameters<typeof buildSeoTaskDedupeKey>[0] & { title: string; targetUrl: string });
    const second = buildSeoTaskDedupeKey({
      taskType: "ctr_experiment_review",
      sourceType: "operator",
      sourceKey: "ctr-2026-07",
      title: "New title",
      targetUrl: "/new-path",
    } as Parameters<typeof buildSeoTaskDedupeKey>[0] & { title: string; targetUrl: string });

    expect(first).toBe(second);
    expect(first).toMatch(/^seo-follow-up:[a-f0-9]{64}$/);
  });
});
