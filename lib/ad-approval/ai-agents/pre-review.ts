// AI Pre-Review Agent (spec §AI Pre-Review Agent). Validates copy quality,
// grammar, readability, CTA, and Facebook policy compliance. Prohibited-wording
// is a deterministic 100% pattern match in code; the rest is LLM-judged.

import { REVIEW_STAGE } from "@/lib/ad-approval/constants";
import {
  type AgentInput,
  type AgentReport,
  type ValidationCheck,
  averageConfidence,
  deriveDecision,
  runLlmReview,
  skipped,
} from "./shared";

export const PRE_REVIEW_AGENT_NAME = "Pre-Review Agent";

// Facebook-style banned/high-risk phrases (spec example list, extensible).
const PROHIBITED_PATTERNS: RegExp[] = [
  /\bmiracle cure\b/i,
  /\bguarantee(d)?\b/i,
  /\bsecret\b/i,
  /\b100%\s+(safe|effective|guaranteed)\b/i,
  /\bcures?\b/i,
  /\bno risk\b/i,
];

function detectProhibitedWording(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of PROHIBITED_PATTERNS) {
    const m = text.match(pattern);
    if (m) hits.push(m[0]);
  }
  return hits;
}

const SYSTEM_PROMPT = `You are the Facebook Ad Pre-Review Agent for Agriko, a Philippine agricultural products brand.
Evaluate the ad copy for the following checks and return STRICT JSON only:
{
  "executive_summary": "1-2 sentence summary",
  "checks": [
    { "check_name": "Grammar", "result": "PASS|WARN|FAIL", "confidence": 0.0-1.0, "note": "..." },
    { "check_name": "Readability", "result": "...", "confidence": ..., "note": "Flesch-Kincaid grade 6-8 target" },
    { "check_name": "CTA Clarity", "result": "...", "confidence": ..., "note": "CTA present, clear, actionable" },
    { "check_name": "Health Claims", "result": "...", "confidence": ..., "note": "unsubstantiated health/medical claims" },
    { "check_name": "Personal Attributes", "result": "...", "confidence": ..., "note": "targeting by protected attributes" },
    { "check_name": "Misleading Claims", "result": "...", "confidence": ..., "note": "false/exaggerated/unsupported claims" }
  ],
  "recommendations": "specific fixes if any"
}
Use FAIL for clear violations, WARN for low-confidence (0.6-0.8) findings, PASS otherwise.`;

export async function runPreReview(input: AgentInput, signal: AbortSignal): Promise<AgentReport> {
  const { copy } = input;
  const text = [copy.primary_text, copy.headline, copy.description, copy.cta].filter(Boolean).join("\n");

  const prohibited = detectProhibitedWording(text);
  const checks: ValidationCheck[] = [];

  checks.push({
    check_name: "Prohibited Wording",
    result: prohibited.length ? "FAIL" : "PASS",
    confidence: 1,
    note: prohibited.length ? `Detected: ${prohibited.join(", ")}` : undefined,
  });

  const llm = await runLlmReview(
    SYSTEM_PROMPT,
    { primary_text: copy.primary_text, headline: copy.headline, description: copy.description, cta: copy.cta },
    signal,
  );
  for (const c of llm.checks) checks.push({ ...c });

  // Vision-dependent check — not available in v1.
  checks.push(skipped("Before/After Imagery"));

  // Prohibited wording OR unsupported health claims => hard reject (spec).
  const healthClaimFailed = checks.some((c) => c.check_name === "Health Claims" && c.result === "FAIL");
  const hardReject = prohibited.length > 0 || healthClaimFailed;

  const overallResult = deriveDecision(checks, hardReject);
  const fails = checks.filter((c) => c.result === "FAIL");
  const warns = checks.filter((c) => c.result === "WARN");

  return {
    agentName: PRE_REVIEW_AGENT_NAME,
    overallResult,
    executiveSummary: llm.executive_summary,
    validationChecks: checks,
    warnings: warns.length ? warns.map((c) => `${c.check_name}: ${c.note ?? "low confidence"}`).join("; ") : null,
    errors: fails.length ? fails.map((c) => `${c.check_name}: ${c.note ?? "failed"}`).join("; ") : null,
    recommendations: llm.recommendations ?? null,
    confidenceScore: averageConfidence(checks),
  };
}

export const PRE_REVIEW_STAGE = REVIEW_STAGE.PRE_REVIEW;
