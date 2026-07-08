import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

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
  assembleDataPayload: vi.fn((skill, payload, extraContext) =>
    JSON.stringify({
      skillId: skill.id,
      platform: skill.platform,
      extraSources: skill.extraSources ?? [],
      payload,
      extraContext: extraContext ?? null,
    })
  ),
}));

vi.mock("@/lib/skills/extra-context", () => ({
  buildExtraContext: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/skills/source-registry", () => ({
  checkSourceStatus: vi.fn(),
  refreshSourcesOnce: vi.fn(),
  selectBaseSnapshotForSource: vi.fn(),
}));

vi.mock("@/lib/guardrails", () => ({
  checkGuardrails: vi.fn().mockResolvedValue({ status: "allow" }),
}));

import { prisma } from "@/lib/db";
import { loadAllSkillsSync } from "@/lib/skills/loader";
import { runSkill } from "@/lib/skills/runner";
import {
  checkSourceStatus,
  refreshSourcesOnce,
  selectBaseSnapshotForSource,
} from "@/lib/skills/source-registry";
import { runSkillsHandler } from "@/jobs/run-skills";

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
const mockCheckSourceStatus = checkSourceStatus as ReturnType<typeof vi.fn>;
const mockRefreshSourcesOnce = refreshSourcesOnce as ReturnType<typeof vi.fn>;
const mockSelectBaseSnapshotForSource = selectBaseSnapshotForSource as ReturnType<typeof vi.fn>;

const metaSnapshot = { id: "snap-meta", source: "meta", payload: { campaigns: [] }, fetchedAt: new Date() };

function makeSkill(id: string, platform: "meta" | "both" | "linkedin" | "reddit" = "meta") {
  return {
    id,
    name: `Skill ${id}`,
    description: "",
    platform,
    pilotGroup: "root",
    enabled: true,
    fullPrompt: `Prompt for ${id}`,
  };
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function expectedSkillHash(skill: ReturnType<typeof makeSkill>, payload: Record<string, unknown>) {
  const assembledDataPayload = JSON.stringify({
    skillId: skill.id,
    platform: skill.platform,
    extraSources: [],
    payload,
    extraContext: null,
  });
  return hashPayload({
    version: 2,
    skillId: skill.id,
    skillName: skill.name,
    skillPromptHash: hashPayload(skill.fullPrompt),
    platform: skill.platform,
    insightBlock: null,
    extraSources: [],
    assembledDataPayload,
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  mockPrisma.jobRun.create.mockResolvedValue({ id: "run-1" });
  mockPrisma.jobRun.findFirst.mockResolvedValue(null); // no last run
  mockPrisma.jobRun.update.mockResolvedValue({});
  mockPrisma.rawSnapshot.findFirst.mockResolvedValue(metaSnapshot);
  mockPrisma.recommendation.create.mockResolvedValue({});
  mockPrisma.recommendation.findFirst.mockResolvedValue(null); // no existing pending rec
  mockRunSkill.mockResolvedValue({ recs: [], truncated: false });
  mockCheckSourceStatus.mockImplementation(async (source) => ({
    source,
    state: "fresh",
    latestAt: new Date(),
    evidenceId: `${source}-evidence`,
  }));
  mockRefreshSourcesOnce.mockResolvedValue({});
  mockSelectBaseSnapshotForSource.mockResolvedValue(metaSnapshot);
  mockLoadAllSkillsSync.mockReturnValue([]);
});

describe("runSkillsHandler rotation (Fix A)", () => {
  it("prioritizes never-run and least-recently-run skills over the same 30 every time", async () => {
    // 32 eligible skills, cap is 30 — 12 have no entry in skillLastRun (never run, should sort first),
    // 20 have ascending timestamps (skill-assigned-0 = oldest / least-recently-run, skill-assigned-19 = newest).
    const neverRunSkills = Array.from({ length: 12 }, (_, i) => makeSkill(`never-${i}`, "meta"));
    const timedSkills = Array.from({ length: 20 }, (_, i) => makeSkill(`assigned-${i}`, "meta"));
    mockLoadAllSkillsSync.mockReturnValue([...neverRunSkills, ...timedSkills]);

    const skillLastRun: Record<string, string> = {};
    timedSkills.forEach((s, i) => {
      // ascending timestamps: assigned-0 is oldest (least-recently-run), assigned-19 is newest (most-recently-run)
      skillLastRun[s.id] = new Date(1000 * (i + 1)).toISOString();
    });

    mockPrisma.jobRun.findFirst.mockResolvedValue({
      id: "run-0",
      summary: { skillHashes: {}, skillLastRun },
    });

    await runSkillsHandler();

    const dispatchedIds = mockRunSkill.mock.calls.map((call) => call[0].id as string);

    expect(dispatchedIds).toHaveLength(30);

    // All 12 never-run skills must be included (they sort as epoch 0, first)
    for (const s of neverRunSkills) {
      expect(dispatchedIds).toContain(s.id);
    }

    // Of the 20 timed skills, only the 18 least-recently-run (assigned-0..assigned-17) should be included
    for (let i = 0; i < 18; i++) {
      expect(dispatchedIds).toContain(`assigned-${i}`);
    }
    // The 2 most-recently-run timed skills should be deferred
    expect(dispatchedIds).not.toContain("assigned-18");
    expect(dispatchedIds).not.toContain("assigned-19");
  });

  it("persists skillLastRun for every dispatched skill (executed or hash-skipped), merged over the previous map", async () => {
    const executedSkill = makeSkill("executed-1", "meta");
    const skippedSkill = makeSkill("skipped-1", "meta");
    mockLoadAllSkillsSync.mockReturnValue([executedSkill, skippedSkill]);

    const staticPayload = { campaigns: [], stable: true };
    const staticSnap = { ...metaSnapshot, payload: staticPayload };
    mockPrisma.rawSnapshot.findFirst.mockReset();
    mockPrisma.rawSnapshot.findFirst.mockResolvedValue(staticSnap);

    const computedHash = expectedSkillHash(skippedSkill, staticPayload);

    const untouchedOldTimestamp = "2020-01-01T00:00:00.000Z";
    mockPrisma.jobRun.findFirst.mockResolvedValue({
      id: "run-0",
      summary: {
        skillHashes: { "skipped-1": computedHash },
        skillLastRun: {
          "skipped-1": untouchedOldTimestamp,
          "unrelated-skill": untouchedOldTimestamp,
        },
      },
    });

    await runSkillsHandler();

    const updateCall = mockPrisma.jobRun.update.mock.calls[0]?.[0];
    const persistedSkillLastRun = updateCall.data.summary.skillLastRun as Record<string, string>;

    // Both dispatched skills get a fresh timestamp
    expect(persistedSkillLastRun["executed-1"]).toBeDefined();
    expect(persistedSkillLastRun["skipped-1"]).toBeDefined();
    expect(persistedSkillLastRun["skipped-1"]).not.toBe(untouchedOldTimestamp);

    // Skills not dispatched this run keep their previous timestamp (merge semantics)
    expect(persistedSkillLastRun["unrelated-skill"]).toBe(untouchedOldTimestamp);
  });

  it("preserves hashes for skills deferred by the round-robin cap", async () => {
    const skills = Array.from({ length: 32 }, (_, i) => makeSkill(`skill-${i}`, "meta"));
    mockLoadAllSkillsSync.mockReturnValue(skills);

    const skillLastRun: Record<string, string> = {};
    const skillHashes: Record<string, string> = {};
    skills.forEach((skill, i) => {
      skillLastRun[skill.id] = new Date(1000 * (i + 1)).toISOString();
      skillHashes[skill.id] = `previous-hash-${i}`;
    });

    mockPrisma.jobRun.findFirst.mockResolvedValue({
      id: "run-0",
      summary: { skillHashes, skillLastRun },
    });

    await runSkillsHandler();

    const updateCall = mockPrisma.jobRun.update.mock.calls[0]?.[0];
    const persistedSkillHashes = updateCall.data.summary.skillHashes as Record<string, string>;

    expect(mockRunSkill).toHaveBeenCalledTimes(30);
    expect(persistedSkillHashes["skill-30"]).toBe("previous-hash-30");
    expect(persistedSkillHashes["skill-31"]).toBe("previous-hash-31");
  });

  it("removes the stale hash for a dispatched skill that fails", async () => {
    const failedSkill = makeSkill("failed-1", "meta");
    mockLoadAllSkillsSync.mockReturnValue([failedSkill]);
    mockRunSkill.mockRejectedValueOnce(new Error("model failed"));
    mockPrisma.jobRun.findFirst.mockResolvedValue({
      id: "run-0",
      summary: {
        skillHashes: {
          "failed-1": "stale-failed-hash",
          "unrelated-1": "stale-unrelated-hash",
        },
      },
    });

    await runSkillsHandler();

    const updateCall = mockPrisma.jobRun.update.mock.calls[0]?.[0];
    const persistedSkillHashes = updateCall.data.summary.skillHashes as Record<string, string>;

    expect(persistedSkillHashes).not.toHaveProperty("failed-1");
    expect(persistedSkillHashes["unrelated-1"]).toBe("stale-unrelated-hash");
  });
});
