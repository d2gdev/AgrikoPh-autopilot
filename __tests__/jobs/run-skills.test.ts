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
import { buildExtraContext } from "@/lib/skills/extra-context";
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
const mockBuildExtraContext = buildExtraContext as ReturnType<typeof vi.fn>;
const mockCheckSourceStatus = checkSourceStatus as ReturnType<typeof vi.fn>;
const mockRefreshSourcesOnce = refreshSourcesOnce as ReturnType<typeof vi.fn>;
const mockSelectBaseSnapshotForSource = selectBaseSnapshotForSource as ReturnType<typeof vi.fn>;

const metaSnapshot = { id: "snap-meta", source: "meta", payload: { campaigns: [] }, fetchedAt: new Date() };
const gscSnapshot = { id: "snap-gsc", source: "gsc", payload: { topQueries: [] }, fetchedAt: new Date() };
const keywordResearchSnapshot = { id: "snap-keyword", source: "keyword_research", payload: { keywords: [] }, fetchedAt: new Date() };

function makeSkill(
  id: string,
  platform: "meta" | "both" | "linkedin" | "reddit" | "seo" = "meta",
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    name: `Skill ${id}`,
    description: "",
    platform,
    pilotGroup: "root",
    enabled: true,
    fullPrompt: `Prompt for ${id}`,
    ...overrides,
  };
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function expectedSkillHash(
  skill: ReturnType<typeof makeSkill>,
  payload: Record<string, unknown>,
  extraContext?: Record<string, unknown>
) {
  const assembledDataPayload = JSON.stringify({
    skillId: skill.id,
    platform: skill.platform,
    extraSources: (skill as Record<string, unknown>).extraSources ?? [],
    payload,
    extraContext: extraContext ?? null,
  });
  return hashPayload({
    version: 2,
    skillId: skill.id,
    skillName: skill.name,
    skillPromptHash: hashPayload(skill.fullPrompt),
    platform: skill.platform,
    insightBlock: (skill as Record<string, unknown>).insightBlock ?? null,
    extraSources: (skill as Record<string, unknown>).extraSources ?? [],
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
  mockBuildExtraContext.mockResolvedValue({});
  mockCheckSourceStatus.mockImplementation(async (source) => ({
    source,
    state: "fresh",
    latestAt: new Date(),
    evidenceId: `${source}-evidence`,
  }));
  mockRefreshSourcesOnce.mockResolvedValue({});
  mockSelectBaseSnapshotForSource.mockImplementation(async (source) => {
    if (source === "gsc") return gscSnapshot;
    if (source === "keyword_research") return keywordResearchSnapshot;
    return metaSnapshot;
  });
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

      const computedHash = expectedSkillHash(skill, staticPayload);

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

    it("reruns a skill when its declared extra source changes while meta stays unchanged", async () => {
      const metaOnlySkill = makeSkill("meta-only", "meta");
      const gscSkill = makeSkill("gsc-backed", "meta", { extraSources: ["gsc"] });
      const staticPayload = { campaigns: [], stable: true };
      const staticSnap = { ...metaSnapshot, payload: staticPayload };
      const oldGscContext = { gsc: { topQueries: [{ query: "old", clicks: 1 }] } };
      const newGscContext = { gsc: { topQueries: [{ query: "new", clicks: 9 }] } };

      mockLoadAllSkillsSync.mockReturnValue([metaOnlySkill, gscSkill]);
      mockPrisma.rawSnapshot.findFirst.mockResolvedValue(staticSnap);
      mockBuildExtraContext.mockResolvedValue(newGscContext);

      const metaOnlyHash = expectedSkillHash(metaOnlySkill, staticPayload);
      const oldGscHash = expectedSkillHash(gscSkill, staticPayload, oldGscContext);
      const newGscHash = expectedSkillHash(gscSkill, staticPayload, newGscContext);
      expect(oldGscHash).not.toBe(newGscHash);

      mockPrisma.jobRun.findFirst.mockResolvedValue({
        id: "run-0",
        summary: {
          skillHashes: {
            "meta-only": metaOnlyHash,
            "gsc-backed": oldGscHash,
          },
        },
      });

      await runSkillsHandler();

      expect(mockRunSkill).toHaveBeenCalledTimes(1);
      expect(mockRunSkill).toHaveBeenCalledWith(gscSkill, staticSnap, newGscContext);
      expect(mockPrisma.jobRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            summary: expect.objectContaining({
              skillHashes: expect.objectContaining({
                "meta-only": metaOnlyHash,
                "gsc-backed": newGscHash,
              }),
            }),
          }),
        })
      );
    });

    it("reruns a multi-source skill when keyword research changes", async () => {
      const skill = makeSkill("keyword-gap", "seo", {
        extraSources: ["keyword_research", "gsc"],
        primarySource: "keyword_research",
      });
      const staticPayload = { keywords: [{ keyword: "turmeric", avgMonthlySearches: 100 }], stable: true };
      const staticSnap = { id: "snap-keyword", source: "keyword_research", payload: staticPayload };
      const oldContext = {
        keyword_research: [{ keyword: "turmeric", avgMonthlySearches: 100 }],
        gsc: { topQueries: [{ query: "organic rice", clicks: 3 }] },
      };
      const newContext = {
        keyword_research: [{ keyword: "turmeric", avgMonthlySearches: 900 }],
        gsc: oldContext.gsc,
      };

      mockLoadAllSkillsSync.mockReturnValue([skill]);
      mockPrisma.rawSnapshot.findFirst.mockResolvedValue(staticSnap);
      mockBuildExtraContext.mockResolvedValue(newContext);
      mockSelectBaseSnapshotForSource.mockResolvedValue(staticSnap);
      mockPrisma.jobRun.findFirst.mockResolvedValue({
        id: "run-0",
        summary: { skillHashes: { "keyword-gap": expectedSkillHash(skill, staticPayload, oldContext) } },
      });

      await runSkillsHandler();

      expect(mockRunSkill).toHaveBeenCalledTimes(1);
      expect(mockRunSkill).toHaveBeenCalledWith(skill, staticSnap, newContext);
    });

    it("reruns a multi-source skill when GSC changes", async () => {
      const skill = makeSkill("keyword-gap", "seo", {
        extraSources: ["keyword_research", "gsc"],
        primarySource: "keyword_research",
      });
      const staticPayload = { keywords: [{ keyword: "turmeric", avgMonthlySearches: 100 }], stable: true };
      const staticSnap = { id: "snap-keyword", source: "keyword_research", payload: staticPayload };
      const oldContext = {
        keyword_research: [{ keyword: "turmeric", avgMonthlySearches: 100 }],
        gsc: { topQueries: [{ query: "old query", clicks: 1 }] },
      };
      const newContext = {
        keyword_research: oldContext.keyword_research,
        gsc: { topQueries: [{ query: "new query", clicks: 8 }] },
      };

      mockLoadAllSkillsSync.mockReturnValue([skill]);
      mockPrisma.rawSnapshot.findFirst.mockResolvedValue(staticSnap);
      mockBuildExtraContext.mockResolvedValue(newContext);
      mockSelectBaseSnapshotForSource.mockResolvedValue(staticSnap);
      mockPrisma.jobRun.findFirst.mockResolvedValue({
        id: "run-0",
        summary: { skillHashes: { "keyword-gap": expectedSkillHash(skill, staticPayload, oldContext) } },
      });

      await runSkillsHandler();

      expect(mockRunSkill).toHaveBeenCalledTimes(1);
      expect(mockRunSkill).toHaveBeenCalledWith(skill, staticSnap, newContext);
    });

    it("skips a multi-source skill when meta and all declared extra sources are unchanged", async () => {
      const skill = makeSkill("keyword-gap", "seo", {
        extraSources: ["keyword_research", "gsc"],
        primarySource: "keyword_research",
      });
      const staticPayload = { keywords: [{ keyword: "turmeric", avgMonthlySearches: 100 }], stable: true };
      const staticSnap = { id: "snap-keyword", source: "keyword_research", payload: staticPayload };
      const context = {
        keyword_research: [{ keyword: "turmeric", avgMonthlySearches: 100 }],
        gsc: { topQueries: [{ query: "organic rice", clicks: 3 }] },
      };

      mockLoadAllSkillsSync.mockReturnValue([skill]);
      mockPrisma.rawSnapshot.findFirst.mockResolvedValue(staticSnap);
      mockBuildExtraContext.mockResolvedValue(context);
      mockSelectBaseSnapshotForSource.mockResolvedValue(staticSnap);
      mockPrisma.jobRun.findFirst.mockResolvedValue({
        id: "run-0",
        summary: { skillHashes: { "keyword-gap": expectedSkillHash(skill, staticPayload, context) } },
      });

      await runSkillsHandler();

      expect(mockRunSkill).not.toHaveBeenCalled();
    });

    it("reruns a market-intel skill without forcing unrelated skills to rerun", async () => {
      const marketSkill = makeSkill("market-skill", "meta", { extraSources: ["market_intel"] });
      const ga4Skill = makeSkill("ga4-skill", "meta", { extraSources: ["ga4"] });
      const staticPayload = { campaigns: [], stable: true };
      const staticSnap = { ...metaSnapshot, payload: staticPayload };
      const oldMarketContext = { market_intel: { competitorAds: [{ headline: "Old" }] } };
      const currentContext = {
        market_intel: { competitorAds: [{ headline: "New" }] },
        ga4: { topLandingPages: [{ pagePath: "/products", sessions: 10 }] },
      };
      const ga4OnlyContext = { ga4: currentContext.ga4 };

      mockLoadAllSkillsSync.mockReturnValue([marketSkill, ga4Skill]);
      mockPrisma.rawSnapshot.findFirst.mockResolvedValue(staticSnap);
      mockBuildExtraContext.mockResolvedValue(currentContext);
      mockPrisma.jobRun.findFirst.mockResolvedValue({
        id: "run-0",
        summary: {
          skillHashes: {
            "market-skill": expectedSkillHash(marketSkill, staticPayload, oldMarketContext),
            "ga4-skill": expectedSkillHash(ga4Skill, staticPayload, ga4OnlyContext),
          },
        },
      });

      await runSkillsHandler();

      expect(mockRunSkill).toHaveBeenCalledTimes(1);
      expect(mockRunSkill).toHaveBeenCalledWith(marketSkill, staticSnap, { market_intel: currentContext.market_intel });
    });

    it("reruns a skill when its prompt changes even if data is unchanged", async () => {
      const oldSkill = makeSkill("prompt-sensitive", "meta", { fullPrompt: "Old prompt" });
      const newSkill = makeSkill("prompt-sensitive", "meta", { fullPrompt: "New prompt" });
      const staticPayload = { campaigns: [], stable: true };
      const staticSnap = { ...metaSnapshot, payload: staticPayload };

      mockLoadAllSkillsSync.mockReturnValue([newSkill]);
      mockPrisma.rawSnapshot.findFirst.mockResolvedValue(staticSnap);
      mockPrisma.jobRun.findFirst.mockResolvedValue({
        id: "run-0",
        summary: { skillHashes: { "prompt-sensitive": expectedSkillHash(oldSkill, staticPayload) } },
      });

      await runSkillsHandler();

      expect(mockRunSkill).toHaveBeenCalledTimes(1);
      expect(mockRunSkill).toHaveBeenCalledWith(newSkill, staticSnap, undefined);
    });

    it("does not persist a skill hash when the LLM response is truncated", async () => {
      const skill = makeSkill("truncated-skill", "meta");
      mockLoadAllSkillsSync.mockReturnValue([skill]);
      mockRunSkill.mockResolvedValue({ recs: [], insights: [], truncated: true });

      await runSkillsHandler();

      const updateCall = mockPrisma.jobRun.update.mock.calls[0]?.[0];
      expect(updateCall.data.summary.skillHashes).not.toHaveProperty("truncated-skill");
    });

    it("removes a stale hash when a previously hashed skill response is truncated", async () => {
      const skill = makeSkill("truncated-skill", "meta");
      mockLoadAllSkillsSync.mockReturnValue([skill]);
      const oldTimestamp = "2024-01-01T00:00:00.000Z";
      mockPrisma.jobRun.findFirst.mockResolvedValue({
        id: "run-0",
        summary: {
          skillHashes: { "truncated-skill": "stale-hash" },
          skillLastRun: { "truncated-skill": oldTimestamp },
        },
      });
      mockRunSkill.mockResolvedValue({ recs: [], insights: [], truncated: true });

      await runSkillsHandler();

      const updateCall = mockPrisma.jobRun.update.mock.calls[0]?.[0];
      expect(updateCall.data.summary.skillHashes).not.toHaveProperty("truncated-skill");
      expect(updateCall.data.summary.skillLastRun["truncated-skill"]).toBe(oldTimestamp);
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

  it("does not recreate a recommendation already finished for the same target/action", async () => {
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
    mockPrisma.recommendation.findFirst.mockResolvedValue({ id: "old-rec", status: "rejected" });

    const result = await runSkillsHandler();

    expect(result.newRecs).toBe(0);
    expect(mockPrisma.recommendation.create).not.toHaveBeenCalled();
    expect(mockPrisma.recommendation.findFirst).toHaveBeenCalledWith({
      where: {
        platform: "meta",
        actionType: "pause_ad",
        targetEntityId: "ad-1",
        status: { in: ["pending", "approved", "override_approved", "executing", "executed", "rejected"] },
      },
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
