import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      create: vi.fn().mockResolvedValue({ id: "run-1" }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    rawSnapshot: {
      findFirst: vi.fn(),
    },
    recommendation: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("@/lib/skills/loader", () => ({
  loadAllSkillsSync: vi.fn(),
}));

vi.mock("@/lib/skills/runner", () => ({
  runSkill: vi.fn().mockResolvedValue({ recs: [], truncated: false }),
}));

vi.mock("@/lib/guardrails", () => ({
  checkGuardrails: vi.fn().mockResolvedValue({ status: "allow" }),
}));

import { prisma } from "@/lib/db";
import { loadAllSkillsSync } from "@/lib/skills/loader";
import { runSkill } from "@/lib/skills/runner";
import { runSkillsHandler } from "@/jobs/run-skills";
import { isSupportedAction } from "@/lib/executor";

const mockPrisma = prisma as unknown as {
  jobRun: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  rawSnapshot: { findFirst: ReturnType<typeof vi.fn> };
  recommendation: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
};

const mockLoadAllSkillsSync = loadAllSkillsSync as ReturnType<typeof vi.fn>;
const mockRunSkill = runSkill as ReturnType<typeof vi.fn>;

const metaSnapshot = { id: "snap-meta", source: "meta", payload: { campaigns: [] }, fetchedAt: new Date() };

function makeSkill(id: string, platform: "meta" | "both" | "linkedin" | "reddit" | "seo" = "meta") {
  return { id, name: `Skill ${id}`, platform, enabled: true };
}

function makeRec(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    actionType: "pause_ad",
    targetEntityType: "ad",
    targetEntityId: "ad-1",
    targetEntityName: "Test Ad",
    currentValue: "active",
    proposedValue: "paused",
    changePercent: null,
    rationale: "Low performance",
    estimatedImpact: "Save budget",
    confidenceScore: 0.9,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockPrisma.jobRun.create.mockResolvedValue({ id: "run-1" });
  mockPrisma.jobRun.findFirst.mockResolvedValue(null);
  mockPrisma.jobRun.update.mockResolvedValue({});
  mockPrisma.rawSnapshot.findFirst.mockResolvedValue(metaSnapshot);
  mockPrisma.recommendation.create.mockResolvedValue({});
  mockPrisma.recommendation.findFirst.mockResolvedValue(null);
  mockRunSkill.mockResolvedValue({ recs: [], truncated: false });
  mockLoadAllSkillsSync.mockReturnValue([]);
});

describe("runSkillsHandler generation-time action filtering (Fix B)", () => {
  it("does not persist unsupported actions but persists supported ones, and reports unsupportedSkipped", async () => {
    const skill = makeSkill("mixed-skill", "meta");
    mockLoadAllSkillsSync.mockReturnValue([skill]);

    mockRunSkill.mockResolvedValue({
      recs: [
        makeRec({ actionType: "change_bid", targetEntityId: "ad-unsupported" }), // not in SUPPORTED_ACTIONS.meta
        makeRec({ actionType: "pause_ad", targetEntityId: "ad-supported" }), // supported on meta
      ],
      truncated: false,
    });

    const result = await runSkillsHandler();

    // Only the supported rec should be persisted
    expect(mockPrisma.recommendation.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.recommendation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actionType: "pause_ad", targetEntityId: "ad-supported" }),
      })
    );

    expect(result.newRecs).toBe(1);

    const updateCall = mockPrisma.jobRun.update.mock.calls[0]?.[0];
    const summary = updateCall.data.summary as { unsupportedSkipped: number };
    expect(summary.unsupportedSkipped).toBe(1);
  });

  it("emits exactly one aggregated console.warn per skill for unsupported recs, not one per rec", async () => {
    const skill = makeSkill("noisy-skill", "meta");
    mockLoadAllSkillsSync.mockReturnValue([skill]);

    mockRunSkill.mockResolvedValue({
      recs: [
        makeRec({ actionType: "change_bid", targetEntityId: "ad-1" }),
        makeRec({ actionType: "add_negative_keyword", targetEntityId: "ad-2" }),
        makeRec({ actionType: "change_bid", targetEntityId: "ad-3" }),
      ],
      truncated: false,
    });

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runSkillsHandler();

    const unsupportedWarnings = consoleSpy.mock.calls.filter((call) =>
      String(call[0]).includes("noisy-skill") && String(call[0]).toLowerCase().includes("unsupported")
    );
    expect(unsupportedWarnings).toHaveLength(1);
    expect(unsupportedWarnings[0]?.[0]).toContain("3");

    consoleSpy.mockRestore();
  });

  it("google_ads is not a dispatchable platform — the skill never runs", async () => {
    const skill = { id: "google-skill", name: "Skill google-skill", platform: "google_ads" as unknown as "meta", enabled: true };
    mockLoadAllSkillsSync.mockReturnValue([skill]);

    mockRunSkill.mockResolvedValue({
      recs: [makeRec({ actionType: "pause_ad", targetEntityId: "gads-1" })],
      truncated: false,
    });

    const result = await runSkillsHandler();

    expect(mockRunSkill).not.toHaveBeenCalled();
    expect(mockPrisma.recommendation.create).not.toHaveBeenCalled();
    expect(result.newRecs).toBe(0);
  });

  it("seo platform skill IS dispatched when a meta snapshot exists", async () => {
    const skill = { ...makeSkill("seo-skill", "seo"), extraSources: ["keyword_research", "gsc"] };
    mockLoadAllSkillsSync.mockReturnValue([skill]);

    mockRunSkill.mockResolvedValue({
      recs: [],
      truncated: false,
    });

    await runSkillsHandler();

    expect(mockRunSkill).toHaveBeenCalledTimes(1);
  });

  it("does not affect skill insight/narrative output when recs are filtered out", async () => {
    const skill = { ...makeSkill("insight-skill", "meta"), insightBlock: "fatigue-report" };
    mockLoadAllSkillsSync.mockReturnValue([skill]);

    mockRunSkill.mockResolvedValue({
      recs: [makeRec({ actionType: "change_bid", targetEntityId: "ad-1" })], // unsupported, filtered
      insights: [{ some: "insight" }],
      truncated: false,
    });

    // add skillInsight.createMany mock
    (mockPrisma as unknown as { skillInsight?: { createMany: ReturnType<typeof vi.fn> } }).skillInsight = {
      createMany: vi.fn().mockResolvedValue({}),
    };

    await runSkillsHandler();

    expect(
      (mockPrisma as unknown as { skillInsight: { createMany: ReturnType<typeof vi.fn> } }).skillInsight.createMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ skillId: "insight-skill", items: [{ some: "insight" }] }),
        ]),
      })
    );
  });
});

describe("isSupportedAction / pause_ad on meta (Fix B, requirement c)", () => {
  it("pause_ad on meta always passes the filter", () => {
    expect(isSupportedAction("meta", "pause_ad")).toBe(true);
  });

  it("a pause_ad/meta recommendation is not skipped in the run-skills flow", async () => {
    const skill = makeSkill("pause-skill", "meta");
    mockLoadAllSkillsSync.mockReturnValue([skill]);

    mockRunSkill.mockResolvedValue({
      recs: [makeRec({ actionType: "pause_ad", targetEntityId: "ad-1" })],
      truncated: false,
    });

    const result = await runSkillsHandler();

    expect(mockPrisma.recommendation.create).toHaveBeenCalledTimes(1);
    expect(result.newRecs).toBe(1);
  });
});
