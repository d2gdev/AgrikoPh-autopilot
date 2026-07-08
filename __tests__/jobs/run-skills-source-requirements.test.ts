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
    skillInsight: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock("@/lib/skills/loader", () => ({
  loadAllSkillsSync: vi.fn(),
}));

vi.mock("@/lib/skills/runner", () => ({
  runSkill: vi.fn().mockResolvedValue({ recs: [], insights: [], truncated: false }),
  assembleDataPayload: vi.fn((skill, payload, extraContext) =>
    JSON.stringify({
      skillId: skill.id,
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
import { buildExtraContext } from "@/lib/skills/extra-context";
import { runSkill } from "@/lib/skills/runner";
import {
  checkSourceStatus,
  refreshSourcesOnce,
  selectBaseSnapshotForSource,
} from "@/lib/skills/source-registry";
import { runSkillsHandler } from "@/jobs/run-skills";

const mockRawSnapshotFindFirst = (prisma as unknown as {
  rawSnapshot: { findFirst: ReturnType<typeof vi.fn> };
}).rawSnapshot.findFirst;
const mockLoadAllSkillsSync = loadAllSkillsSync as ReturnType<typeof vi.fn>;
const mockBuildExtraContext = buildExtraContext as ReturnType<typeof vi.fn>;
const mockRunSkill = runSkill as ReturnType<typeof vi.fn>;
const mockCheckSourceStatus = checkSourceStatus as ReturnType<typeof vi.fn>;
const mockRefreshSourcesOnce = refreshSourcesOnce as ReturnType<typeof vi.fn>;
const mockSelectBaseSnapshotForSource = selectBaseSnapshotForSource as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();

  mockRawSnapshotFindFirst.mockResolvedValue(null);
  mockLoadAllSkillsSync.mockReturnValue([]);
  mockBuildExtraContext.mockResolvedValue({ gsc: { topQueries: [] } });
  mockRunSkill.mockResolvedValue({ recs: [], insights: [], truncated: false });
  mockCheckSourceStatus.mockResolvedValue({
    source: "gsc",
    state: "fresh",
    latestAt: new Date(),
    evidenceId: "gsc-snap",
  });
  mockRefreshSourcesOnce.mockResolvedValue({});
  mockSelectBaseSnapshotForSource.mockResolvedValue(null);
});

describe("runSkillsHandler source-aware eligibility", () => {
  it("does not run a seo skill without an organic source contract", async () => {
    const metaSnapshot = {
      id: "meta-snap",
      source: "meta",
      payload: { campaigns: [{ id: "cmp-1" }] },
      fetchedAt: new Date(),
      dateRangeStart: new Date(),
      dateRangeEnd: new Date(),
    };
    mockRawSnapshotFindFirst.mockImplementation(async (args) => {
      if (args.where?.source === "meta") return metaSnapshot;
      return null;
    });
    mockLoadAllSkillsSync.mockReturnValue([
      {
        id: "seo-without-contract",
        name: "SEO Without Contract",
        description: "",
        platform: "seo",
        pilotGroup: "seo",
        enabled: true,
        fullPrompt: "Find SEO gaps",
        extraSources: [],
      },
    ]);

    const result = await runSkillsHandler();

    expect(result.status).toBe("success");
    expect(mockCheckSourceStatus).not.toHaveBeenCalled();
    expect(mockSelectBaseSnapshotForSource).not.toHaveBeenCalled();
    expect(mockBuildExtraContext).not.toHaveBeenCalled();
    expect(mockRunSkill).not.toHaveBeenCalled();
    expect(result.summary.skillsUnavailable).toEqual([
      {
        skillId: "seo-without-contract",
        missingRequiredSources: [],
        staleRequiredSources: [],
        reason: "seo skill has no organic source contract",
      },
    ]);
  });

  it("runs a seo skill from gsc without requiring a meta snapshot", async () => {
    mockRawSnapshotFindFirst.mockImplementation(async (args) => {
      if (args.where?.source === "meta") return null;
      if (args.where?.source === "gsc") {
        return {
          id: "gsc-snap",
          source: "gsc",
          payload: { topQueries: [{ query: "organic rice", impressions: 100 }] },
          fetchedAt: new Date(),
          dateRangeStart: new Date(),
          dateRangeEnd: new Date(),
        };
      }
      return null;
    });
    mockLoadAllSkillsSync.mockReturnValue([
      {
        id: "organic-gap",
        name: "Organic Gap",
        description: "",
        platform: "seo",
        pilotGroup: "seo",
        enabled: true,
        fullPrompt: "Find organic gaps",
        extraSources: ["gsc"],
        requiredSources: ["gsc"],
        primarySource: "gsc",
      },
    ]);
    mockCheckSourceStatus.mockResolvedValue({
      source: "gsc",
      state: "fresh",
      latestAt: new Date(),
      evidenceId: "gsc-snap",
    });
    mockBuildExtraContext.mockResolvedValue({ gsc: { topQueries: [] } });
    mockSelectBaseSnapshotForSource.mockResolvedValue({
      id: "gsc-snap",
      source: "gsc",
      payload: { topQueries: [] },
    });

    const result = await runSkillsHandler();

    expect(result.status).toBe("success");
    expect(mockRunSkill).toHaveBeenCalledWith(
      expect.objectContaining({ id: "organic-gap" }),
      expect.objectContaining({ id: "gsc-snap" }),
      expect.any(Object)
    );
  });
});
