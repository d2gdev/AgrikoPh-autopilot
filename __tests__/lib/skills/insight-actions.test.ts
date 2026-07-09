import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  recommendation: { findFirst: vi.fn(), create: vi.fn().mockResolvedValue({ id: "rec_1" }) },
  storeTask: { upsert: vi.fn().mockResolvedValue({ id: "task_1" }) },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/guardrails", () => ({ checkGuardrails: vi.fn().mockResolvedValue({ status: "clear" }) }));

import { createFatigueActions } from "@/lib/skills/insight-actions";

const row = (items: unknown[]) => ({
  skillId: "04-meta-creative-fatigue-detection",
  skillName: "Creative Fatigue Detection",
  insightType: "fatigue-report",
  items,
  snapshotId: "snap_1",
});

describe("createFatigueActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.recommendation.findFirst.mockResolvedValue(null);
    prismaMock.recommendation.create.mockResolvedValue({ id: "rec_1" });
    prismaMock.storeTask.upsert.mockResolvedValue({ id: "task_1" });
  });

  it("dead ad → pause_ad rec only; urgent ad → rec AND refresh task; healthy → nothing", async () => {
    const result = await createFatigueActions({
      runId: "run_1",
      rows: [row([
        { adId: "ad_dead", adName: "Dead Ad", status: "dead", rationale: "CTR collapsed" },
        { adId: "ad_urgent", adName: "Tired Ad", status: "urgent", rationale: "Frequency 6+" },
        { adId: "ad_ok", adName: "Fine Ad", status: "healthy" },
      ])],
    });
    expect(result).toEqual({ pauseRecs: 2, refreshTasks: 1 });
    expect(prismaMock.recommendation.create).toHaveBeenCalledTimes(2);
    const first = prismaMock.recommendation.create.mock.calls[0]![0].data;
    expect(first).toMatchObject({
      platform: "meta",
      actionType: "pause_ad",
      targetEntityType: "ad",
      targetEntityId: "ad_dead",
      confidenceScore: 0.9,
      snapshotId: "snap_1",
    });
    expect(prismaMock.storeTask.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.storeTask.upsert.mock.calls[0]![0].where).toEqual({
      dedupeKey: "store-task:refresh-creative:ad_urgent",
    });
  });

  it("skips the rec when a pending/approved rec already targets the same ad+action", async () => {
    prismaMock.recommendation.findFirst.mockResolvedValue({ id: "existing" });
    const result = await createFatigueActions({
      runId: "run_1",
      rows: [row([{ adId: "ad_1", adName: "A", status: "dead", rationale: "r" }])],
    });
    expect(result.pauseRecs).toBe(0);
    expect(prismaMock.recommendation.create).not.toHaveBeenCalled();
  });

  it("skips the rec when a rejected or executed rec already finished the same ad+action", async () => {
    prismaMock.recommendation.findFirst.mockResolvedValue({ id: "existing", status: "executed" });
    const result = await createFatigueActions({
      runId: "run_1",
      rows: [row([{ adId: "ad_1", adName: "A", status: "dead", rationale: "r" }])],
    });

    expect(result.pauseRecs).toBe(0);
    expect(prismaMock.recommendation.create).not.toHaveBeenCalled();
    expect(prismaMock.recommendation.findFirst).toHaveBeenCalledWith({
      where: {
        platform: "meta",
        actionType: "pause_ad",
        targetEntityId: "ad_1",
        status: { in: ["pending", "approved", "override_approved", "executing", "executed", "rejected"] },
      },
    });
  });

  it("ignores malformed items and non-fatigue rows without throwing", async () => {
    const result = await createFatigueActions({
      runId: "run_1",
      rows: [
        row([{ adName: "no id", status: "dead" }, null, "junk"]),
        { ...row([]), insightType: "competitor-analysis", items: [{ competitor: "X" }] },
      ],
    });
    expect(result).toEqual({ pauseRecs: 0, refreshTasks: 0 });
  });
});
