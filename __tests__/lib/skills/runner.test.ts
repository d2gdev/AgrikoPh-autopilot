import { describe, it, expect, vi } from "vitest";

vi.mock("openai", () => ({ default: vi.fn() }));

import { parseRecommendations } from "@/lib/skills/runner";

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
