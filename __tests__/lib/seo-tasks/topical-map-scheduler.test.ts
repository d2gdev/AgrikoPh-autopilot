import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  projectTopicalMapContentTasks,
  projectTopicalMapPhaseTasks,
  syncTopicalMapSeoTasks,
} from "@/lib/seo-tasks/topical-map-scheduler";

const SCHEDULE_BOUNDARY = {
  operationMode: "proposal_only",
  executionProhibited: true,
  elapsedTimeAuthorizesAction: false,
  satisfactionCanTriggerMutation: false,
  independentSafeguardsRequired: true,
  absentEvidenceNonExecutable: true,
} as const;

function scheduleRule(
  ruleId: string,
  heading: string,
  literalText: string,
  boundary: Record<string, unknown> = SCHEDULE_BOUNDARY,
) {
  return {
    ruleId,
    compiledPayload: {
      type: "literal_schedule_obligation",
      resolutionStatus: "resolved",
      sourceReferences: [{
        locator: {
          headingPath: ["90-Day Operating Plan", heading],
        },
      }],
      payload: {
        name: "schedule-obligation",
        literalText,
      },
      scheduleAuthorityBoundary: boundary,
    },
  };
}

const ACTIVATED_AT = new Date("2026-07-12T21:14:53.778Z");

describe("projectTopicalMapPhaseTasks", () => {
  it("groups safe literal obligations into phase tasks anchored to the Manila activation date", () => {
    const tasks = projectTopicalMapPhaseTasks({
      strategyVersionId: "strategy-a",
      strategyVersion: "2026-07-12",
      packageSha256: "a".repeat(64),
      activatedAt: ACTIVATED_AT,
      now: new Date("2026-07-18T00:00:00.000Z"),
      horizonDays: 90,
      rules: [
        scheduleRule(
          "schedule:measurement:1",
          "Days 1-5: Establish the Measurement Contract",
          "Record the baseline.",
        ),
        scheduleRule(
          "schedule:measurement:2",
          "Days 1-5: Establish the Measurement Contract",
          "Confirm the query set.",
        ),
        scheduleRule(
          "schedule:p0:1",
          "Days 6-14: Remove Proven P0 Defects",
          "Review proven P0 defects.",
        ),
      ],
    });

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      title: "Review topical-map phase: Establish the Measurement Contract",
      priority: "P2",
      earliestReviewAt: new Date("2026-07-12T16:00:00.000Z"),
      dueAt: new Date("2026-07-17T15:59:59.999Z"),
      sourceKey: "topical-map-phase:strategy-a:1-5",
      requiresEvidence: false,
      evidenceStatus: "not_required",
      sourceType: "topical_map",
      destinationPath: "/seo-pillar",
    });
    expect(tasks[0]?.description).toContain("1. Record the baseline.");
    expect(tasks[0]?.description).toContain("2. Confirm the query set.");
    expect(tasks[1]).toMatchObject({
      priority: "P0",
      earliestReviewAt: new Date("2026-07-17T16:00:00.000Z"),
      dueAt: new Date("2026-07-26T15:59:59.999Z"),
      sourceKey: "topical-map-phase:strategy-a:6-14",
    });
    expect(tasks[1]?.sourceData).toMatchObject({
      strategyVersionId: "strategy-a",
      strategyVersion: "2026-07-12",
      packageSha256: "a".repeat(64),
      phase: { startDay: 6, endDay: 14, label: "Remove Proven P0 Defects" },
      ruleIds: ["schedule:p0:1"],
      proposalOnly: true,
      executionProhibited: true,
    });
  });

  it("uses a strict on-or-after ISO date as the review-date override", () => {
    const tasks = projectTopicalMapPhaseTasks({
      strategyVersionId: "strategy-a",
      strategyVersion: "2026-07-12",
      packageSha256: "a".repeat(64),
      activatedAt: ACTIVATED_AT,
      now: new Date("2026-07-18T00:00:00.000Z"),
      horizonDays: 90,
      rules: [
        scheduleRule(
          "schedule:recipe:1",
          "Days 76-90: Recipe Decisions and Next-Quarter Backlog",
          "On or after 2026-09-22, export GSC and review the recipe cohort.",
        ),
      ],
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.earliestReviewAt).toEqual(new Date("2026-09-21T16:00:00.000Z"));
    expect(tasks[0]?.dueAt).toEqual(new Date("2026-10-10T15:59:59.999Z"));
  });

  it("excludes unsafe, unresolved, malformed, and out-of-window schedule rules", () => {
    const tasks = projectTopicalMapPhaseTasks({
      strategyVersionId: "strategy-a",
      strategyVersion: "2026-07-12",
      packageSha256: "a".repeat(64),
      activatedAt: ACTIVATED_AT,
      now: new Date("2026-07-18T00:00:00.000Z"),
      horizonDays: 10,
      rules: [
        scheduleRule(
          "schedule:safe",
          "Days 6-14: Remove Proven P0 Defects",
          "Review proven P0 defects.",
        ),
        scheduleRule(
          "schedule:future",
          "Days 31-45: Organic-Rice Commercial Architecture",
          "Review the commercial architecture.",
        ),
        scheduleRule(
          "schedule:unsafe",
          "Days 1-5: Establish the Measurement Contract",
          "Execute immediately.",
          { ...SCHEDULE_BOUNDARY, executionProhibited: false },
        ),
        {
          ...scheduleRule(
            "schedule:unresolved",
            "Days 1-5: Establish the Measurement Contract",
            "Review unresolved work.",
          ),
          compiledPayload: {
            ...scheduleRule(
              "unused",
              "Days 1-5: Establish the Measurement Contract",
              "unused",
            ).compiledPayload,
            resolutionStatus: "unresolved",
          },
        },
        scheduleRule("schedule:malformed", "Week 2: Loose prose", "Do something."),
      ],
    });

    expect(tasks.map((task) => task.sourceKey)).toEqual([
      "topical-map-phase:strategy-a:6-14",
    ]);
  });
});

describe("projectTopicalMapContentTasks", () => {
  const page = {
    url: "/blogs/news/rice-nutrition-breakdown",
    title: "Rice Nutrition Philippines: Black vs Red Rice Calories",
    cluster: "Rice nutrition and comparisons",
    role: "nutrition pillar",
    decision: "keep; CTR and conversion-path refresh",
    priority: "P1",
    ruleIds: ["content:rice", "intent:rice", "role:rice"],
    ruleDomains: { content_decisions: ["content:rice"] },
    contentDecisionPolicy: {
      resolutionStatus: "resolved" as const,
      conditions: [],
      evidenceRequirements: [],
      reviewRequirements: [],
    },
  };

  it("projects an exact current content candidate as Ready now with complete map identity", () => {
    const tasks = projectTopicalMapContentTasks({
      strategyVersionId: "strategy-a",
      strategyVersion: "2026-07-18",
      packageSha256: "a".repeat(64),
      activatedAt: ACTIVATED_AT,
      now: new Date("2026-07-18T04:00:00.000Z"),
      horizonDays: 90,
      pages: [page],
      analysis: {
        gaps: [{
          candidateId: "b".repeat(64),
          kind: "content",
          strategyVersionId: "strategy-a",
          packageSha256: "a".repeat(64),
          ruleIds: [...page.ruleIds],
          state: "candidate",
          action: "refresh",
          query: "rice nutrition Philippines",
          suggestedTitle: page.title,
          currentArticleTitle: page.title,
          page: page.url,
          priority: "P1",
          mapEvidence: "ADMIN; SITEMAP",
          observedEvidence: [],
          observation: {
            source: "store",
            capturedAt: "2026-07-18T03:00:00.000Z",
            provenance: "ArticleRecord:news/rice-nutrition-breakdown",
          },
        }],
        observations: [],
        suppressed: [],
      },
      rules: [
        scheduleRule(
          "schedule:rice",
          "Days 22-30: Rice-Nutrition CTR Pilot",
          "Refresh `/blogs/news/rice-nutrition-breakdown` for comparison intent.",
        ),
      ],
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      taskType: "content_quality_review",
      title: page.title,
      targetUrl: page.url,
      topicalCluster: page.cluster,
      pageRole: page.role,
      ownerSurface: "content",
      destinationPath: "/content-pilot",
      priority: "P1",
      earliestReviewAt: new Date("2026-07-18T04:00:00.000Z"),
      requiresEvidence: false,
      evidenceStatus: "not_required",
      sourceKey: `topical-map-content:strategy-a:${"b".repeat(64)}`,
    });
    expect(tasks[0]?.sourceData).toMatchObject({
      candidateId: "b".repeat(64),
      targetUrl: page.url,
      mapTitle: page.title,
      action: "refresh",
      strategyVersionId: "strategy-a",
      strategyVersion: "2026-07-18",
      packageSha256: "a".repeat(64),
      ruleIds: page.ruleIds,
      phase: {
        startDay: 22,
        endDay: 30,
        label: "Rice-Nutrition CTR Pilot",
      },
      phaseRuleIds: ["schedule:rice"],
    });
  });

  it("schedules only exact, unconditional future content actions and deduplicates URLs", () => {
    const futurePage = {
      ...page,
      url: "/blogs/news/sustainable-rice-farming",
      title: "Sustainable Rice Farming",
      cluster: "Organic farming",
      role: "farming spoke",
      decision: "keep; refresh and strengthen",
      ruleIds: ["content:farming", "intent:farming", "role:farming"],
      ruleDomains: { content_decisions: ["content:farming"] },
    };
    const conditionalPage = {
      ...page,
      url: "/blogs/news/conditional-guide",
      title: "Conditional Guide",
      decision: "create only if evidence exists",
      ruleIds: ["content:conditional"],
      ruleDomains: { content_decisions: ["content:conditional"] },
    };
    const tasks = projectTopicalMapContentTasks({
      strategyVersionId: "strategy-a",
      strategyVersion: "2026-07-18",
      packageSha256: "a".repeat(64),
      activatedAt: ACTIVATED_AT,
      now: new Date("2026-07-18T04:00:00.000Z"),
      horizonDays: 90,
      pages: [futurePage, conditionalPage],
      analysis: { gaps: [], observations: [], suppressed: [] },
      rules: [
        scheduleRule(
          "schedule:farming:first",
          "Days 15-21: Resolve Indexation",
          "Strengthen `/blogs/news/sustainable-rice-farming` with unique Philippine evidence.",
        ),
        scheduleRule(
          "schedule:farming:later",
          "Days 61-75: Herbal and Farming Authority",
          "Refresh `/blogs/news/sustainable-rice-farming` with authority sources.",
        ),
        scheduleRule(
          "schedule:conditional",
          "Days 31-45: Conditional Work",
          "Create `/blogs/news/conditional-guide` only if fresh evidence supports it.",
        ),
        scheduleRule(
          "schedule:research",
          "Days 31-45: Research",
          "Review `/blogs/news/research-only` for a future decision.",
        ),
      ],
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: futurePage.title,
      targetUrl: futurePage.url,
      earliestReviewAt: new Date("2026-07-26T16:00:00.000Z"),
      dueAt: new Date("2026-08-02T15:59:59.999Z"),
    });
    expect(tasks[0]?.sourceData).toMatchObject({
      action: "refresh",
      phaseRuleIds: ["schedule:farming:first"],
    });
  });
});

describe("syncTopicalMapSeoTasks", () => {
  it("creates missing phase tasks, recognizes duplicates, and cancels stale open strategy tasks", async () => {
    const db = {
      topicalMapActivation: {
        findUnique: vi.fn().mockResolvedValue({
          strategyVersion: {
            id: "strategy-current",
            strategyVersion: "2026-07-12",
            packageSha256: "a".repeat(64),
            activatedAt: ACTIVATED_AT,
            compiledRules: [
              scheduleRule(
                "schedule:measurement",
                "Days 1-5: Establish the Measurement Contract",
                "Record the baseline.",
              ),
              scheduleRule(
                "schedule:p0",
                "Days 6-14: Remove Proven P0 Defects",
                "Review proven P0 defects.",
              ),
            ],
          },
        }),
      },
      seoFollowUpTask: {
        findMany: vi.fn().mockResolvedValue([
          { id: "stale-1", version: 3 },
        ]),
      },
    };
    const createTask = vi.fn()
      .mockResolvedValueOnce({ outcome: "created", task: { id: "new-1" } })
      .mockResolvedValueOnce({ outcome: "duplicate", existingId: "existing-1" });
    const mutateTask = vi.fn().mockResolvedValue({
      outcome: "updated",
      task: { id: "stale-1" },
    });

    const result = await syncTopicalMapSeoTasks({
      db,
      now: new Date("2026-07-18T00:00:00.000Z"),
      createTask,
      mutateTask,
    });

    expect(result).toEqual({
      status: "synced",
      strategyVersionId: "strategy-current",
      projected: 2,
      created: 1,
      existing: 1,
      superseded: 1,
    });
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(createTask.mock.calls[0]?.[0]).toMatchObject({
      sourceKey: "topical-map-phase:strategy-current:1-5",
    });
    expect(createTask.mock.calls[0]?.[1]).toBe("system:topical-map-task-scheduler");
    expect(mutateTask).toHaveBeenCalledWith(
      "stale-1",
      {
        action: "cancel",
        expectedVersion: 3,
        note: "Superseded by active topical-map strategy strategy-current.",
        decisionData: {
          supersededByStrategyVersionId: "strategy-current",
        },
      },
      "system:topical-map-task-scheduler",
      new Date("2026-07-18T00:00:00.000Z"),
      { skipMappedProposalPreflight: true },
    );
  });

  it("does nothing when no topical-map strategy is active", async () => {
    const db = {
      topicalMapActivation: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      seoFollowUpTask: {
        findMany: vi.fn(),
      },
    };
    const createTask = vi.fn();
    const mutateTask = vi.fn();

    const result = await syncTopicalMapSeoTasks({
      db,
      now: new Date("2026-07-18T00:00:00.000Z"),
      createTask,
      mutateTask,
    });

    expect(result).toEqual({
      status: "no_active_strategy",
      strategyVersionId: null,
      projected: 0,
      created: 0,
      existing: 0,
      superseded: 0,
    });
    expect(db.seoFollowUpTask.findMany).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    expect(mutateTask).not.toHaveBeenCalled();
  });

  it("materializes exact content once and creates zero duplicates on a repeated sync", async () => {
    const currentPage = {
      url: "/blogs/news/rice-guide",
      title: "Mapped Rice Guide",
      cluster: "Rice",
      role: "guide",
      decision: "keep; refresh",
      priority: "P1",
      ruleIds: ["content:rice"],
      ruleDomains: { content_decisions: ["content:rice"] },
      contentDecisionPolicy: {
        resolutionStatus: "resolved" as const,
        conditions: [],
        evidenceRequirements: [],
        reviewRequirements: [],
      },
    };
    const contentState = {
      pages: [currentPage],
      analysis: {
        gaps: [{
          candidateId: "b".repeat(64),
          kind: "content" as const,
          strategyVersionId: "strategy-current",
          packageSha256: "a".repeat(64),
          ruleIds: ["content:rice"],
          state: "candidate" as const,
          action: "refresh" as const,
          query: "rice guide",
          suggestedTitle: "Mapped Rice Guide",
          page: "/blogs/news/rice-guide",
          priority: "P1",
          mapEvidence: null,
          observedEvidence: [],
          observation: {
            source: "store" as const,
            capturedAt: "2026-07-18T03:00:00.000Z",
            provenance: "ArticleRecord:news/rice-guide",
          },
        }],
        observations: [],
        suppressed: [],
      },
    };
    const db = {
      topicalMapActivation: {
        findUnique: vi.fn().mockResolvedValue({
          strategyVersion: {
            id: "strategy-current",
            strategyVersion: "2026-07-18",
            packageSha256: "a".repeat(64),
            activatedAt: ACTIVATED_AT,
            compiledRules: [],
          },
        }),
      },
      seoFollowUpTask: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const createTask = vi.fn()
      .mockResolvedValueOnce({ outcome: "created", task: { id: "content-1" } })
      .mockResolvedValueOnce({ outcome: "duplicate", existingId: "content-1" });
    const options = {
      db,
      now: new Date("2026-07-18T04:00:00.000Z"),
      createTask,
      mutateTask: vi.fn(),
      loadContentState: vi.fn().mockResolvedValue(contentState),
      getBlockingProposals: vi.fn().mockResolvedValue(new Map()),
    };

    await expect(syncTopicalMapSeoTasks(options)).resolves.toMatchObject({
      projected: 1,
      created: 1,
      existing: 0,
    });
    await expect(syncTopicalMapSeoTasks(options)).resolves.toMatchObject({
      projected: 1,
      created: 0,
      existing: 1,
    });
  });
});

describe("topical-map task sync scheduling", () => {
  it("runs the rolling-window reconciliation from the existing locked daily route", () => {
    const source = readFileSync("app/api/cron/daily/route.ts", "utf8");

    expect(source).toContain(
      'import { syncTopicalMapSeoTasks } from "@/lib/seo-tasks/topical-map-scheduler";',
    );
    expect(source).toContain("results.topicalMapTasks = await syncTopicalMapSeoTasks();");
    expect(source).toContain('jobName: "sync-topical-map-seo-tasks"');
  });
});
