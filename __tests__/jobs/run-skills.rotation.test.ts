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
const googleSnapshot = { id: "snap-google", source: "google_ads", payload: { campaigns: [] }, fetchedAt: new Date() };

function makeSkill(id: string, platform: "meta" | "google_ads" | "both" | "linkedin" | "reddit" = "meta") {
  return { id, name: `Skill ${id}`, platform, enabled: true };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockPrisma.jobRun.create.mockResolvedValue({ id: "run-1" });
  mockPrisma.jobRun.findFirst.mockResolvedValue(null); // no last run
  mockPrisma.jobRun.update.mockResolvedValue({});
  mockPrisma.rawSnapshot.findFirst
    .mockResolvedValueOnce(metaSnapshot) // meta
    .mockResolvedValueOnce(googleSnapshot); // google
  mockPrisma.recommendation.create.mockResolvedValue({});
  mockPrisma.recommendation.findFirst.mockResolvedValue(null); // no existing pending rec
  mockRunSkill.mockResolvedValue({ recs: [], truncated: false });
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
    mockPrisma.rawSnapshot.findFirst
      .mockResolvedValueOnce(staticSnap)
      .mockResolvedValueOnce(googleSnapshot);

    const crypto = await import("crypto");
    const computedHash = crypto.createHash("sha256").update(JSON.stringify(staticPayload)).digest("hex");

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
});
