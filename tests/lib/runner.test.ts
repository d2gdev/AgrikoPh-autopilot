import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock function — must be defined before vi.mock factory runs (vi.mock is hoisted
// but closures over variables defined in the same scope work when using vi.hoisted)
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/client", () => {
  return {
    getAiClient: vi.fn(async () => ({
      provider: "deepseek",
      model: "test-model",
      client: {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      },
    })),
  };
});

// Mock Prisma (runner imports RawSnapshot type from @prisma/client — no runtime call needed,
// but the db module is imported transitively via other lib files in some setups)
vi.mock("@/lib/db", () => ({
  prisma: {},
}));

import { runSkill } from "@/lib/skills/runner";

const VALID_SKILL = {
  id: "test-skill",
  name: "Test Skill",
  description: "Test skill",
  platform: "meta" as const,
  pilotGroup: "test",
  fullPrompt: "Analyze the data.",
  enabled: true,
};

const VALID_SNAPSHOT = {
  id: "snap-1",
  source: "meta",
  payload: { campaigns: [{ id: "c1", name: "Test Campaign" }] },
  fetchedAt: new Date(),
  dateRangeStart: new Date("2026-06-01T00:00:00.000Z"),
  dateRangeEnd: new Date("2026-06-24T00:00:00.000Z"),
  jobRunId: "job-1",
} as Parameters<typeof runSkill>[1];

function makeValidRec(overrides = {}) {
  return {
    actionType: "pause_campaign",
    targetEntityType: "campaign",
    targetEntityId: "c1",
    targetEntityName: "Test Campaign",
    currentValue: null,
    proposedValue: null,
    changePercent: null,
    rationale: "ROAS is below 0.7 for 7+ days with sufficient data.",
    estimatedImpact: "Save ~₱4,200/month",
    confidenceScore: 0.85,
    ...overrides,
  };
}

function buildResponse(content: string, finish_reason = "stop") {
  return {
    choices: [
      {
        message: { content },
        finish_reason,
      },
    ],
  };
}

describe("runSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns valid recs and truncated: false for a normal response", async () => {
    const rec = makeValidRec();
    const responseText = `Here are my recommendations:\n\`\`\`recommendations\n${JSON.stringify([rec])}\n\`\`\``;

    mockCreate.mockResolvedValue(buildResponse(responseText));

    const result = await runSkill(VALID_SKILL, VALID_SNAPSHOT);

    expect(result.truncated).toBe(false);
    expect(result.recs).toHaveLength(1);
    expect(result.recs[0]?.actionType).toBe("pause_campaign");
    expect(result.recs[0]?.confidenceScore).toBe(0.85);
  });

  it("returns { recs: [], truncated: true } when finish_reason is 'length'", async () => {
    const rec = makeValidRec();
    const responseText = `\`\`\`recommendations\n${JSON.stringify([rec])}\n\`\`\``;

    mockCreate.mockResolvedValue(buildResponse(responseText, "length"));

    const result = await runSkill(VALID_SKILL, VALID_SNAPSHOT);

    expect(result.truncated).toBe(true);
    expect(result.recs).toEqual([]);
  });

  it("returns { recs: [], truncated: false } and warns when choices[] is empty", async () => {
    mockCreate.mockResolvedValue({ choices: [] });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runSkill(VALID_SKILL, VALID_SNAPSHOT);

    expect(result.recs).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[runner]"),
      expect.stringContaining(VALID_SKILL.id)
    );

    warnSpy.mockRestore();
  });

  it("returns empty recs gracefully when response contains invalid JSON", async () => {
    const responseText = "Here are my recommendations:\n```recommendations\n{ not valid json }\n```";

    mockCreate.mockResolvedValue(buildResponse(responseText));

    const result = await runSkill(VALID_SKILL, VALID_SNAPSHOT);

    expect(result.recs).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("filters out recommendation objects that fail RecommendationSchema validation", async () => {
    const validRec = makeValidRec();
    const invalidRec = { actionType: "change_bid" }; // missing required fields
    const responseText = `\`\`\`recommendations\n${JSON.stringify([validRec, invalidRec])}\n\`\`\``;

    mockCreate.mockResolvedValue(buildResponse(responseText));

    const result = await runSkill(VALID_SKILL, VALID_SNAPSHOT);

    expect(result.recs).toHaveLength(1);
    expect(result.recs[0]?.actionType).toBe("pause_campaign");
  });

  it("returns empty recs when recommendations block is missing entirely", async () => {
    mockCreate.mockResolvedValue(buildResponse("I have analyzed the data but produced no output block."));

    const result = await runSkill(VALID_SKILL, VALID_SNAPSHOT);

    expect(result.recs).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe("RecommendationSchema (via runSkill parsing)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("correctly parses a fully valid recommendation object", async () => {
    const rec = makeValidRec({
      actionType: "adjust_budget",
      proposedValue: "1500",
      changePercent: 25,
    });
    const responseText = `\`\`\`recommendations\n${JSON.stringify([rec])}\n\`\`\``;

    mockCreate.mockResolvedValue(buildResponse(responseText));

    const result = await runSkill(VALID_SKILL, VALID_SNAPSHOT);

    expect(result.recs).toHaveLength(1);
    const parsed = result.recs[0];
    expect(parsed).toBeDefined();
    expect(parsed?.actionType).toBe("adjust_budget");
    expect(parsed?.proposedValue).toBe("1500");
    expect(parsed?.changePercent).toBe(25);
    expect(parsed?.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(parsed?.confidenceScore).toBeLessThanOrEqual(1);
  });

  it("rejects recommendations with confidenceScore out of [0,1] range", async () => {
    const rec = makeValidRec({ confidenceScore: 1.5 });
    const responseText = `\`\`\`recommendations\n${JSON.stringify([rec])}\n\`\`\``;

    mockCreate.mockResolvedValue(buildResponse(responseText));

    const result = await runSkill(VALID_SKILL, VALID_SNAPSHOT);

    expect(result.recs).toEqual([]);
  });
});
