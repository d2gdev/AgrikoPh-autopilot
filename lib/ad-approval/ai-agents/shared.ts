// Shared types and helpers for the three Ad Approval AI review agents.
// See docs/ad-approval-spec.md §AI Agents. v1 is text + HTTP only; vision-
// dependent checks are emitted as SKIPPED entries (honest, not dropped).

import { z } from "zod";
import { chatCompletionWithFailover } from "@/lib/ai/client";
import { DECISION, type Decision } from "@/lib/ad-approval/constants";

export interface AdCopy {
  primary_text?: string;
  headline?: string;
  description?: string;
  cta?: string;
  start_date?: string;
  end_date?: string;
  website_url?: string;
  contact?: { email?: string; phone?: string; address?: string };
}

export interface AdCreative {
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  logo_placement?: string;
  captions?: string;
  destination_url?: string;
  campaign_name?: string;
  utm?: Record<string, string>;
  pixel_id?: string;
  event_config?: unknown;
}

export interface AgentInput {
  campaignId: string;
  revisionNumber: number;
  copy: AdCopy;
  creative: AdCreative;
}

export type CheckResult = "PASS" | "WARN" | "FAIL" | "SKIPPED";

export interface ValidationCheck {
  check_name: string;
  result: CheckResult;
  confidence: number; // 0..1
  note?: string;
}

export interface AgentReport {
  agentName: string;
  overallResult: Decision;
  executiveSummary: string;
  validationChecks: ValidationCheck[];
  warnings: string | null;
  errors: string | null;
  recommendations: string | null;
  confidenceScore: number;
  rawResponse?: unknown;
}

// Vision checks are not available in v1 (text-only models). Emit them honestly.
export function skipped(check_name: string): ValidationCheck {
  return { check_name, result: "SKIPPED", confidence: 0, note: "vision not available in v1" };
}

/**
 * Derive the overall decision from validation checks (spec decision logic):
 * REJECTED if any hard-reject check fails or ≥3 FAILs; NEEDS_REVISION if 1-2
 * FAILs; otherwise PASS. SKIPPED/WARN never fail the ad on their own.
 */
export function deriveDecision(checks: ValidationCheck[], hardReject = false): Decision {
  const fails = checks.filter((c) => c.result === "FAIL").length;
  if (hardReject || fails >= 3) return DECISION.REJECTED;
  if (fails >= 1) return DECISION.NEEDS_REVISION;
  return DECISION.PASS;
}

export function averageConfidence(checks: ValidationCheck[]): number {
  const scored = checks.filter((c) => c.result !== "SKIPPED");
  if (scored.length === 0) return 1;
  const sum = scored.reduce((acc, c) => acc + (Number.isFinite(c.confidence) ? c.confidence : 0), 0);
  return Math.round((sum / scored.length) * 100) / 100;
}

// Zod schema for the structured JSON the LLM returns for text-based checks.
const llmCheckSchema = z.object({
  check_name: z.string(),
  result: z.enum(["PASS", "WARN", "FAIL"]),
  confidence: z.number().min(0).max(1),
  note: z.string().optional(),
});

export const llmReviewSchema = z.object({
  executive_summary: z.string(),
  checks: z.array(llmCheckSchema),
  recommendations: z.string().optional(),
});

export type LlmReview = z.infer<typeof llmReviewSchema>;

function extractJson(content: string): unknown {
  // Tolerate fenced ```json blocks or raw JSON.
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1]! : content;
  return JSON.parse(raw.trim());
}

/**
 * Run the LLM portion of a review: send the system+user prompt, parse a
 * Zod-validated JSON review. Honors an AbortSignal (job timeout). Throws on
 * timeout or unparseable output so the worker can retry.
 */
export async function runLlmReview(
  systemPrompt: string,
  userPayload: unknown,
  signal: AbortSignal,
): Promise<LlmReview> {
  const { content } = await chatCompletionWithFailover(
    {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    },
    { requestOptions: { signal } },
  );
  return llmReviewSchema.parse(extractJson(content));
}
