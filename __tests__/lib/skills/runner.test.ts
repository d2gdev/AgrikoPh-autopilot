import { describe, it, expect, vi } from "vitest";

vi.mock("openai", () => ({ default: vi.fn() }));

import { parseRecommendations, assembleDataPayload } from "@/lib/skills/runner";
import type { SkillDefinition } from "@/lib/skills/loader";

const VALID_REC = {
  actionType: "pause_campaign",
  targetEntityType: "campaign",
  targetEntityId: "123456789",
  targetEntityName: "Agriko — Moringa",
  currentValue: null,
  proposedValue: null,
  changePercent: null,
  rationale: "ROAS below 0.7 for 14 consecutive days with 500+ impressions.",
  estimatedImpact: "Save ~₱3,200/month",
  confidenceScore: 0.85,
};

function wrapRecs(recs: unknown[]): string {
  return `Some preamble text.\n\`\`\`recommendations\n${JSON.stringify(recs, null, 2)}\n\`\`\``;
}

describe("parseRecommendations", () => {
  it("parses a valid recommendation", () => {
    const result = parseRecommendations(wrapRecs([VALID_REC]));
    expect(result).toHaveLength(1);
    expect(result[0]!.actionType).toBe("pause_campaign");
    expect(result[0]!.confidenceScore).toBe(0.85);
  });

  it("returns empty array when no recommendations block present", () => {
    expect(parseRecommendations("Here is my analysis but no fenced block.")).toHaveLength(0);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseRecommendations("```recommendations\nnot json\n```")).toHaveLength(0);
  });

  it("drops items failing schema validation", () => {
    const invalid = { ...VALID_REC, confidenceScore: 1.5 }; // > 1.0 is invalid
    const result = parseRecommendations(wrapRecs([VALID_REC, invalid]));
    expect(result).toHaveLength(1);
    expect(result[0]!.actionType).toBe("pause_campaign");
  });

  it("parses empty array recommendations block", () => {
    expect(parseRecommendations("```recommendations\n[]\n```")).toHaveLength(0);
  });

  it("parses multiple valid recommendations", () => {
    const second = { ...VALID_REC, targetEntityId: "987", targetEntityName: "Agriko — Guyabano", confidenceScore: 0.7 };
    const result = parseRecommendations(wrapRecs([VALID_REC, second]));
    expect(result).toHaveLength(2);
  });

  it("returns empty array when fenced block contains non-array JSON", () => {
    expect(parseRecommendations("```recommendations\n{}\n```")).toHaveLength(0);
  });

  it("filters out non-object items mixed with valid recommendations", () => {
    const mixed = [null, "string", 42, VALID_REC];
    const result = parseRecommendations(wrapRecs(mixed));
    expect(result).toHaveLength(1);
    expect(result[0]!.actionType).toBe("pause_campaign");
  });

  it("parses only the first recommendations block when multiple are present", () => {
    const twoBlocks =
      "```recommendations\n" +
      JSON.stringify([VALID_REC]) +
      "\n```\n\nSome text.\n\n```recommendations\n[]\n```";
    const result = parseRecommendations(twoBlocks);
    expect(result).toHaveLength(1);
  });
});

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: "test-skill",
    name: "Test Skill",
    description: "",
    platform: "meta",
    pilotGroup: "root",
    enabled: true,
    fullPrompt: "",
    ...overrides,
  };
}

describe("assembleDataPayload", () => {
  it("omits extra-source sections when no extraSources are declared", () => {
    const skill = makeSkill();
    const result = assembleDataPayload(skill, { campaigns: [{ id: "1" }] }, { gsc: { topQueries: [] } });

    expect(result).toContain("## Campaigns");
    expect(result).not.toContain("Organic Search (GSC)");
  });

  it("includes only the requested extra-source sections, in declared order", () => {
    const skill = makeSkill({ extraSources: ["market_intel", "keyword_research"] });
    const extraContext = {
      gsc: { topQueries: [{ query: "x", clicks: 1 }] },
      market_intel: { competitorAds: [], priceChanges: [], marketInsights: [] },
      keyword_research: [{ keyword: "moringa" }],
    };

    const result = assembleDataPayload(skill, {}, extraContext);

    expect(result).toContain("## Market Intelligence");
    expect(result).toContain("## Keyword Research");
    expect(result).not.toContain("Organic Search (GSC)");
    expect(result.indexOf("## Market Intelligence")).toBeLessThan(result.indexOf("## Keyword Research"));
  });

  it("skips a declared extra source when its context is null (data absent)", () => {
    const skill = makeSkill({ extraSources: ["ga4"] });
    const result = assembleDataPayload(skill, {}, { ga4: null });

    expect(result).not.toContain("Site Analytics (GA4)");
  });

  it("still works with no extraContext argument at all", () => {
    const skill = makeSkill({ extraSources: ["gsc"] });
    const result = assembleDataPayload(skill, { campaigns: [] });

    expect(result).not.toContain("Organic Search (GSC)");
  });

  it("truncates an oversized extra-source array and notes the truncation", () => {
    const skill = makeSkill({ extraSources: ["keyword_research"] });
    const bigArray = Array.from({ length: 2000 }, (_, i) => ({
      keyword: `keyword-number-${i}`,
      avgMonthlySearches: 1000 + i,
      competition: "MEDIUM",
      lowTopOfPageBidMicros: "100000",
      highTopOfPageBidMicros: "300000",
    }));

    const result = assembleDataPayload(skill, {}, { keyword_research: bigArray });

    const section = result.slice(result.indexOf("## Keyword Research"));
    expect(section).toContain("truncated");
    // A capped section's JSON body should not balloon past the cap plus the truncation note.
    expect(section.length).toBeLessThan(9000);
    expect(section).not.toContain("keyword-number-1999");
  });
});
