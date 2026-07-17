import { describe, expect, it, vi } from "vitest";
import {
  INITIAL_SEO_FOLLOW_UP_TASKS,
  parseSeedArguments,
  runSeoTaskSeed,
} from "@/scripts/seed-seo-follow-up-tasks";

describe("SEO follow-up seed", () => {
  it("contains exactly the three agreed dated follow-ups", () => {
    expect(INITIAL_SEO_FOLLOW_UP_TASKS).toHaveLength(3);
    expect(INITIAL_SEO_FOLLOW_UP_TASKS.map((task) => ({
      taskType: task.taskType,
      targetUrl: task.targetUrl,
      earliestReviewAt: task.earliestReviewAt.toISOString(),
    }))).toEqual([
      {
        taskType: "canonical_transfer_review",
        targetUrl: "/blogs/news/black-rice-vs-red-rice-which-philippine-organic-rice-is-right-for-you",
        earliestReviewAt: "2026-07-24T16:00:00.000Z",
      },
      {
        taskType: "ctr_experiment_review",
        targetUrl: "/blogs/news/rice-nutrition-breakdown",
        earliestReviewAt: "2026-07-28T16:00:00.000Z",
      },
      {
        taskType: "cohort_review",
        targetUrl: "/blogs/recipes",
        earliestReviewAt: "2026-09-21T16:00:00.000Z",
      },
    ]);
  });

  it("defaults to dry-run and performs zero writes", async () => {
    const createTask = vi.fn();

    const result = await runSeoTaskSeed({
      apply: false,
      production: false,
      databaseUrl: "postgresql://test:test@127.0.0.1:5432/autopilot_test",
      createTask,
    });

    expect(result).toEqual({ planned: 3, created: 0, existing: 0, writeCount: 0, dryRun: true });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("applies idempotently through the service", async () => {
    const seen = new Set<string>();
    const createTask = vi.fn(async (task: { sourceKey: string }) => {
      if (seen.has(task.sourceKey)) return { outcome: "duplicate" as const, existingId: task.sourceKey };
      seen.add(task.sourceKey);
      return { outcome: "created" as const, task: { id: task.sourceKey } as never };
    });
    const input = {
      apply: true,
      production: false,
      databaseUrl: "postgresql://test:test@127.0.0.1:5432/autopilot_test",
      createTask,
    };

    await expect(runSeoTaskSeed(input)).resolves.toMatchObject({
      planned: 3,
      created: 3,
      existing: 0,
      writeCount: 3,
      dryRun: false,
    });
    await expect(runSeoTaskSeed(input)).resolves.toMatchObject({
      planned: 3,
      created: 0,
      existing: 3,
      writeCount: 0,
      dryRun: false,
    });
  });

  it("rejects unknown flags and requires explicit production acknowledgement", async () => {
    expect(() => parseSeedArguments(["--unknown"])).toThrow("Unknown flag: --unknown");
    await expect(runSeoTaskSeed({
      apply: true,
      production: false,
      databaseUrl: "postgresql://user:pass@db.internal:5432/autopilot",
      createTask: vi.fn(),
    })).rejects.toThrow("Production seeding requires --production");
  });
});
