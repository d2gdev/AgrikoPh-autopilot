import { createHash } from "crypto";
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

vi.mock("@/lib/skills/runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/runner")>();
  return {
    ...actual,
    runSkill: vi.fn().mockResolvedValue({ recs: [], insights: [], truncated: false }),
  };
});

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
import type { SkillDefinition } from "@/lib/skills/loader";
import { assembleDataPayload, runSkill } from "@/lib/skills/runner";
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

const metaSnapshot = {
  id: "snap-meta",
  source: "meta",
  payload: { campaigns: [{ id: "campaign-1", name: "Campaign One" }] },
  fetchedAt: new Date(),
};
const gscSnapshot = {
  id: "snap-gsc",
  source: "gsc",
  payload: { topQueries: [{ query: "same query", clicks: 4 }] },
  fetchedAt: new Date(),
};

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: "gsc-backed",
    name: "GSC Backed",
    description: "",
    platform: "meta",
    pilotGroup: "root",
    enabled: true,
    fullPrompt: "Review paid performance with search context.",
    extraSources: ["gsc"],
    ...overrides,
  };
}

function expectedSkillHash(
  skill: ReturnType<typeof makeSkill>,
  payload: Record<string, unknown>,
  extraContext?: Record<string, unknown>
): string {
  return hashPayload({
    version: 2,
    skillId: skill.id,
    skillName: skill.name,
    skillPromptHash: hashPayload(skill.fullPrompt),
    platform: skill.platform,
    insightBlock: skill.insightBlock ?? null,
    extraSources: skill.extraSources ?? [],
    assembledDataPayload: assembleDataPayload(skill, payload, extraContext),
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  mockPrisma.jobRun.create.mockResolvedValue({ id: "run-1" });
  mockPrisma.jobRun.findFirst.mockResolvedValue(null);
  mockPrisma.jobRun.update.mockResolvedValue({});
  mockPrisma.rawSnapshot.findFirst.mockResolvedValue(metaSnapshot);
  mockPrisma.recommendation.create.mockResolvedValue({});
  mockPrisma.recommendation.findFirst.mockResolvedValue(null);
  mockRunSkill.mockResolvedValue({ recs: [], insights: [], truncated: false });
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
    return metaSnapshot;
  });
  mockLoadAllSkillsSync.mockReturnValue([]);
});

describe("runSkillsHandler skill input fingerprint with real payload assembly", () => {
  it("reruns a meta skill when a real assembled ad-account field changes", async () => {
    const skill = makeSkill({ extraSources: [] });
    const oldPayload = { campaigns: [{ id: "campaign-1", name: "Old Campaign" }] };
    const newSnapshot = {
      ...metaSnapshot,
      payload: { campaigns: [{ id: "campaign-1", name: "New Campaign" }] },
    };

    mockLoadAllSkillsSync.mockReturnValue([skill]);
    mockPrisma.rawSnapshot.findFirst.mockResolvedValue(newSnapshot);
    mockPrisma.jobRun.findFirst.mockResolvedValue({
      id: "run-0",
      summary: {
        skillHashes: {
          [skill.id]: expectedSkillHash(skill, oldPayload),
        },
      },
    });

    await runSkillsHandler();

    expect(mockRunSkill).toHaveBeenCalledTimes(1);
    expect(mockRunSkill).toHaveBeenCalledWith(skill, newSnapshot, undefined);
  });

  it("skips a seo skill when only ad-account fields omitted by real assembly change", async () => {
    const skill = makeSkill({ platform: "seo", extraSources: ["gsc"], primarySource: "gsc" });
    const context = { gsc: { topQueries: [{ query: "same query", clicks: 4 }] } };
    const oldPayload = gscSnapshot.payload;
    const newSnapshot = {
      ...metaSnapshot,
      payload: { campaigns: [{ id: "campaign-1", name: "New Campaign" }] },
    };

    mockLoadAllSkillsSync.mockReturnValue([skill]);
    mockPrisma.rawSnapshot.findFirst.mockResolvedValue(newSnapshot);
    mockBuildExtraContext.mockResolvedValue(context);
    mockSelectBaseSnapshotForSource.mockResolvedValue(gscSnapshot);
    mockPrisma.jobRun.findFirst.mockResolvedValue({
      id: "run-0",
      summary: {
        skillHashes: {
          [skill.id]: expectedSkillHash(skill, oldPayload, context),
        },
      },
    });

    await runSkillsHandler();

    expect(mockRunSkill).not.toHaveBeenCalled();
  });

  it("reruns when real assembled extra-source payload changes", async () => {
    const skill = makeSkill();
    const oldContext = { gsc: { topQueries: [{ query: "old query", clicks: 1 }] } };
    const newContext = { gsc: { topQueries: [{ query: "new query", clicks: 7 }] } };

    mockLoadAllSkillsSync.mockReturnValue([skill]);
    mockBuildExtraContext.mockResolvedValue(newContext);
    mockPrisma.jobRun.findFirst.mockResolvedValue({
      id: "run-0",
      summary: {
        skillHashes: {
          [skill.id]: expectedSkillHash(skill, metaSnapshot.payload, oldContext),
        },
      },
    });

    await runSkillsHandler();

    expect(mockRunSkill).toHaveBeenCalledTimes(1);
    expect(mockRunSkill).toHaveBeenCalledWith(skill, metaSnapshot, newContext);

    const updateCall = mockPrisma.jobRun.update.mock.calls[0]?.[0];
    expect(updateCall.data.summary.skillHashes[skill.id]).toBe(
      expectedSkillHash(skill, metaSnapshot.payload, newContext)
    );
  });

  it("skips when the real assembled payload is unchanged", async () => {
    const skill = makeSkill();
    const context = { gsc: { topQueries: [{ query: "same query", clicks: 4 }] } };

    mockLoadAllSkillsSync.mockReturnValue([skill]);
    mockBuildExtraContext.mockResolvedValue(context);
    mockPrisma.jobRun.findFirst.mockResolvedValue({
      id: "run-0",
      summary: {
        skillHashes: {
          [skill.id]: expectedSkillHash(skill, metaSnapshot.payload, context),
        },
      },
    });

    await runSkillsHandler();

    expect(mockRunSkill).not.toHaveBeenCalled();
  });
});
