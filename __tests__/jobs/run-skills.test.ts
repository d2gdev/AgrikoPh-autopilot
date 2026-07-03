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

function makeSkill(id: string, platform: "meta" | "both" | "linkedin" | "reddit" = "meta") {
  return { id, name: `Skill ${id}`, platform, enabled: true };
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
  mockLoadAllSkillsSync.mockReturnValue([]);
});

describe("runSkillsHandler", () => {
  describe("hash skip", () => {
    it("skips a skill when existingHash === currentHash and returns the actual hash (not empty string)", async () => {
      const skill = makeSkill("skill-1", "meta");
      mockLoadAllSkillsSync.mockReturnValue([skill]);

      // Last run stored a hash for this skill
      const storedHash = "abc123definitelyrealsha256hash0000000000000000000000000000000";
      mockPrisma.jobRun.findFirst.mockResolvedValue({
        id: "run-0",
        summary: { skillHashes: { "skill-1": storedHash } },
      });

      // The meta snapshot payload must produce the same hash when JSON-stringified
      // We control this by making the stored hash match what hashPayload(metaSnapshot.payload) would produce
      // Instead, we make the snapshot payload static so hash is deterministic
      const staticPayload = { campaigns: [], stable: true };
      const staticSnap = { ...metaSnapshot, payload: staticPayload };
      mockPrisma.rawSnapshot.findFirst.mockReset();
      mockPrisma.rawSnapshot.findFirst.mockResolvedValue(staticSnap);

      // Pre-compute what the handler will compute for the hash
      const crypto = await import("crypto");
      const computedHash = crypto.createHash("sha256").update(JSON.stringify(staticPayload)).digest("hex");

      // Override stored hash to match computed hash
      mockPrisma.jobRun.findFirst.mockResolvedValue({
        id: "run-0",
        summary: { skillHashes: { "skill-1": computedHash } },
      });

      const result = await runSkillsHandler();

      // runSkill should NOT be called for a skipped skill
      expect(mockRunSkill).not.toHaveBeenCalled();
      expect(result.newRecs).toBe(0);

      // The hash stored in jobRun.update should be the real computed hash, not ""
      expect(mockPrisma.jobRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            summary: expect.objectContaining({
              skillHashes: expect.objectContaining({
                "skill-1": computedHash,
              }),
            }),
          }),
        })
      );
    });
  });

  describe("P2002 unique constraint", () => {
    it("swallows P2002 errors and does not count them as skill errors", async () => {
      const skill = makeSkill("skill-1", "meta");
      mockLoadAllSkillsSync.mockReturnValue([skill]);
      mockRunSkill.mockResolvedValue({
        recs: [
          {
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
          },
        ],
        truncated: false,
      });

      const p2002Error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      mockPrisma.recommendation.create.mockRejectedValue(p2002Error);

      const result = await runSkillsHandler();

      // Should complete without error (P2002 swallowed)
      expect(mockPrisma.jobRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "success", // not "partial" — P2002 not counted as error
          }),
        })
      );
      expect(result.newRecs).toBe(0); // not counted since create was rejected
    });
  });

  describe("skills cap with round-robin rotation", () => {
    it("defers skills beyond MAX_SKILLS_PER_RUN and logs a warning", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Create 32 meta skills (> MAX_SKILLS_PER_RUN = 30)
      const skills = Array.from({ length: 32 }, (_, i) => makeSkill(`skill-${i}`, "meta"));
      mockLoadAllSkillsSync.mockReturnValue(skills);

      await runSkillsHandler();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("deferred to next run")
      );
      // Only 30 skills should have been run
      expect(mockRunSkill).toHaveBeenCalledTimes(30);

      consoleSpy.mockRestore();
    });
  });

  describe("non-dispatchable platform filter", () => {
    it("filters out linkedin and reddit skills BEFORE the cap is applied", async () => {
      // 28 meta skills + 2 linkedin + 2 reddit = 32 total, but only 28 eligible
      const metaSkills = Array.from({ length: 28 }, (_, i) => makeSkill(`meta-${i}`, "meta"));
      const linkedinSkills = [makeSkill("li-1", "linkedin"), makeSkill("li-2", "linkedin")];
      const redditSkills = [makeSkill("rd-1", "reddit"), makeSkill("rd-2", "reddit")];

      mockLoadAllSkillsSync.mockReturnValue([...metaSkills, ...linkedinSkills, ...redditSkills]);

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await runSkillsHandler();

      // 28 eligible skills — no cap warning needed
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("deferred to next run")
      );
      // Only meta skills run — not linkedin/reddit
      expect(mockRunSkill).toHaveBeenCalledTimes(28);

      consoleSpy.mockRestore();
    });
  });

  describe("concurrency limit", () => {
    it("runs at most 4 skills concurrently (p-limit(4))", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const skills = Array.from({ length: 8 }, (_, i) => makeSkill(`skill-${i}`, "meta"));
      mockLoadAllSkillsSync.mockReturnValue(skills);

      mockRunSkill.mockImplementation(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        // Simulate async work
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        return { recs: [], truncated: false };
      });

      await runSkillsHandler();

      expect(maxConcurrent).toBeLessThanOrEqual(4);
      expect(mockRunSkill).toHaveBeenCalledTimes(8);
    });
  });

  describe("no snapshots", () => {
    it("returns early with newRecs: 0 when no snapshots are available", async () => {
      mockPrisma.rawSnapshot.findFirst.mockReset();
      mockPrisma.rawSnapshot.findFirst.mockResolvedValue(null);

      const result = await runSkillsHandler();

      expect(result.newRecs).toBe(0);
      expect(mockRunSkill).not.toHaveBeenCalled();
      expect(mockPrisma.jobRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "failed" }),
        })
      );
    });
  });
});
