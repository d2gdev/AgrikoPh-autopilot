// AI Brand Review Agent (spec §AI Brand Review Agent). Validates tone, USP,
// product naming (LLM), plus website URL reachability and contact-info format
// (deterministic). Logo/colors/fonts are vision checks — SKIPPED in v1.

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
import { checkUrlReachable } from "./http-checks";

export const BRAND_REVIEW_AGENT_NAME = "Brand Review Agent";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\d][\d\s()+-]{6,}$/;

const SYSTEM_PROMPT = `You are the Brand Review Agent for Agriko, a Philippine agricultural products brand
(natural rice, herbal products; professional, trustworthy, health-conscious voice).
Return STRICT JSON only:
{
  "executive_summary": "1-2 sentence summary",
  "checks": [
    { "check_name": "Tone of Voice", "result": "PASS|WARN|FAIL", "confidence": 0.0-1.0, "note": "matches brand voice" },
    { "check_name": "USP Clarity", "result": "...", "confidence": ..., "note": "unique selling proposition clear" },
    { "check_name": "Product Naming", "result": "...", "confidence": ..., "note": "product names correct, consistent" }
  ],
  "recommendations": "specific fixes if any"
}`;

export async function runBrandReview(input: AgentInput, signal: AbortSignal): Promise<AgentReport> {
  const { copy } = input;
  const checks: ValidationCheck[] = [];

  // Vision-dependent checks — not available in v1.
  checks.push(skipped("Logo Presence"));
  checks.push(skipped("Logo Quality"));
  checks.push(skipped("Logo Placement"));
  checks.push(skipped("Brand Colors"));
  checks.push(skipped("Font Consistency"));

  // LLM text checks.
  const llm = await runLlmReview(
    SYSTEM_PROMPT,
    { primary_text: copy.primary_text, headline: copy.headline, description: copy.description, cta: copy.cta },
    signal,
  );
  for (const c of llm.checks) checks.push({ ...c });

  // Website URL reachability (deterministic, 100% threshold).
  const url = copy.website_url;
  if (url) {
    const reach = await checkUrlReachable(url, signal);
    checks.push({
      check_name: "Website URL Valid",
      result: reach.ok ? "PASS" : "FAIL",
      confidence: 1,
      note: reach.note,
    });
  } else {
    checks.push({ check_name: "Website URL Valid", result: "FAIL", confidence: 1, note: "No website URL provided" });
  }

  // Contact info format (email/phone/address present + valid).
  const contact = copy.contact ?? {};
  const emailOk = contact.email ? EMAIL_RE.test(contact.email) : false;
  const phoneOk = contact.phone ? PHONE_RE.test(contact.phone) : false;
  const addressOk = Boolean(contact.address && contact.address.trim().length > 0);
  const contactOk = emailOk && phoneOk && addressOk;
  checks.push({
    check_name: "Contact Info Accuracy",
    result: contactOk ? "PASS" : "FAIL",
    confidence: contactOk ? 0.95 : 1,
    note: contactOk ? undefined : "Email, phone, and address must all be present and valid",
  });

  const overallResult = deriveDecision(checks);
  const fails = checks.filter((c) => c.result === "FAIL");
  const warns = checks.filter((c) => c.result === "WARN");

  return {
    agentName: BRAND_REVIEW_AGENT_NAME,
    overallResult,
    executiveSummary: llm.executive_summary,
    validationChecks: checks,
    warnings: warns.length ? warns.map((c) => `${c.check_name}: ${c.note ?? "low confidence"}`).join("; ") : null,
    errors: fails.length ? fails.map((c) => `${c.check_name}: ${c.note ?? "failed"}`).join("; ") : null,
    recommendations: llm.recommendations ?? null,
    confidenceScore: averageConfidence(checks),
  };
}

export const BRAND_REVIEW_STAGE = REVIEW_STAGE.BRAND_REVIEW;
