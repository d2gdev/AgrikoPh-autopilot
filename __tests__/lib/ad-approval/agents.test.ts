import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/client", () => ({ chatCompletionWithFailover: vi.fn() }));

import { chatCompletionWithFailover } from "@/lib/ai/client";
import { deriveDecision, averageConfidence, type ValidationCheck } from "@/lib/ad-approval/ai-agents/shared";
import { checkUtmParams, checkCampaignName } from "@/lib/ad-approval/ai-agents/http-checks";
import { runPreReview } from "@/lib/ad-approval/ai-agents/pre-review";
import { DECISION } from "@/lib/ad-approval/constants";

const signal = new AbortController().signal;
const mockLlm = chatCompletionWithFailover as unknown as ReturnType<typeof vi.fn>;

function check(result: ValidationCheck["result"]): ValidationCheck {
  return { check_name: "x", result, confidence: 0.9 };
}

describe("deriveDecision", () => {
  it("PASS when no fails", () => {
    expect(deriveDecision([check("PASS"), check("WARN"), check("SKIPPED")])).toBe(DECISION.PASS);
  });
  it("NEEDS_REVISION on 1-2 fails", () => {
    expect(deriveDecision([check("FAIL"), check("PASS")])).toBe(DECISION.NEEDS_REVISION);
    expect(deriveDecision([check("FAIL"), check("FAIL")])).toBe(DECISION.NEEDS_REVISION);
  });
  it("REJECTED on 3+ fails or hard reject", () => {
    expect(deriveDecision([check("FAIL"), check("FAIL"), check("FAIL")])).toBe(DECISION.REJECTED);
    expect(deriveDecision([check("PASS")], true)).toBe(DECISION.REJECTED);
  });
});

describe("averageConfidence", () => {
  it("ignores SKIPPED and averages the rest", () => {
    expect(
      averageConfidence([
        { check_name: "a", result: "PASS", confidence: 1 },
        { check_name: "b", result: "FAIL", confidence: 0.5 },
        { check_name: "c", result: "SKIPPED", confidence: 0 },
      ]),
    ).toBe(0.75);
  });
});

describe("checkUtmParams", () => {
  it("passes with all required params and no spaces", () => {
    expect(checkUtmParams({ utm_source: "fb", utm_medium: "cpc", utm_campaign: "launch" }).ok).toBe(true);
  });
  it("fails when a required param is missing", () => {
    expect(checkUtmParams({ utm_source: "fb", utm_medium: "cpc" }).ok).toBe(false);
  });
  it("fails when a value contains spaces", () => {
    expect(checkUtmParams({ utm_source: "fb", utm_medium: "cpc", utm_campaign: "big launch" }).ok).toBe(false);
  });
});

describe("checkCampaignName", () => {
  it("accepts [YYYY-MM-DD]-Product-Audience", () => {
    expect(checkCampaignName("2026-08-01-Rice-Health").ok).toBe(true);
  });
  it("rejects free-form names", () => {
    expect(checkCampaignName("summer sale").ok).toBe(false);
  });
});

describe("runPreReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLlm.mockResolvedValue({
      content: JSON.stringify({
        executive_summary: "Looks good.",
        checks: [
          { check_name: "Grammar", result: "PASS", confidence: 0.95 },
          { check_name: "Readability", result: "PASS", confidence: 0.9 },
          { check_name: "CTA Clarity", result: "PASS", confidence: 0.9 },
          { check_name: "Health Claims", result: "PASS", confidence: 0.9 },
          { check_name: "Personal Attributes", result: "PASS", confidence: 0.9 },
          { check_name: "Misleading Claims", result: "PASS", confidence: 0.9 },
        ],
      }),
      provider: "deepseek",
      model: "deepseek-chat",
    });
  });

  it("PASSes clean copy and marks the vision check SKIPPED", async () => {
    const report = await runPreReview(
      { campaignId: "c1", revisionNumber: 1, copy: { primary_text: "Fresh organic rice from local farms." }, creative: {} },
      signal,
    );
    expect(report.overallResult).toBe(DECISION.PASS);
    expect(report.validationChecks.find((c) => c.check_name === "Before/After Imagery")?.result).toBe("SKIPPED");
    expect(report.validationChecks.find((c) => c.check_name === "Prohibited Wording")?.result).toBe("PASS");
  });

  it("REJECTs on prohibited wording regardless of LLM checks", async () => {
    const report = await runPreReview(
      { campaignId: "c1", revisionNumber: 1, copy: { primary_text: "Guaranteed miracle cure for everything!" }, creative: {} },
      signal,
    );
    expect(report.overallResult).toBe(DECISION.REJECTED);
    expect(report.errors).toMatch(/Prohibited Wording/);
  });
});
