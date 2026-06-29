import { describe, it, expect } from "vitest";
import {
  scoreFinding,
  classifyPriority,
  findingToImpact,
  changeTypeToEffort,
  type ContentFinding,
} from "@/lib/content-pilot/priority-score";

const baseFinding: ContentFinding = {
  type: "gsc-quick-win",
  articleHandle: "test-article",
  articleTitle: "Test Article",
  trafficScore: 24,
  businessValue: 15,
  severity: "medium",
  confidence: 0.75,
  risk: "low",
  evidence: {},
  proposedState: {},
  title: "Fix title",
  description: "Do the thing",
  changeType: "metadata",
};

describe("scoreFinding", () => {
  it("scores a medium-confidence metadata fix correctly", () => {
    // trafficScore(24) + businessValue(15) + severity_medium(8) + Math.round(0.75*10=7.5→8) - risk_low(0) = 55
    expect(scoreFinding(baseFinding)).toBe(55);
  });

  it("penalises high-risk findings", () => {
    const highRisk = { ...baseFinding, risk: "high" as const };
    // 55 base - risk_high(4) = 51
    expect(scoreFinding(highRisk)).toBe(51);
  });

  it("boosts critical severity", () => {
    const critical = { ...baseFinding, severity: "critical" as const };
    // 24 + 15 + severity_critical(20) + 8 - 0 = 67
    expect(scoreFinding(critical)).toBe(67);
  });
});

describe("classifyPriority", () => {
  it("returns P1 for score >= 75", () => {
    expect(classifyPriority(75)).toBe("P1");
    expect(classifyPriority(100)).toBe("P1");
  });

  it("returns P2 for score 50-74", () => {
    expect(classifyPriority(50)).toBe("P2");
    expect(classifyPriority(74)).toBe("P2");
  });

  it("returns P3 for score < 50", () => {
    expect(classifyPriority(49)).toBe("P3");
    expect(classifyPriority(0)).toBe("P3");
  });
});

describe("findingToImpact", () => {
  it("maps P1 → High", () => expect(findingToImpact(80)).toBe("High"));
  it("maps P2 → Medium", () => expect(findingToImpact(60)).toBe("Medium"));
  it("maps P3 → Low", () => expect(findingToImpact(30)).toBe("Low"));
});

describe("changeTypeToEffort", () => {
  it("metadata is Low effort", () => expect(changeTypeToEffort("metadata")).toBe("Low"));
  it("internal_link is Low effort", () => expect(changeTypeToEffort("internal_link")).toBe("Low"));
  it("content is Medium effort", () => expect(changeTypeToEffort("content")).toBe("Medium"));
  it("new_article is High effort", () => expect(changeTypeToEffort("new_article")).toBe("High"));
});
