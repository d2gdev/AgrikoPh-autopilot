export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSessionShop,
  getSessionUser,
  PERMISSIONS,
  requireAppAuth,
  requirePermission,
} from "@/lib/auth";
import { getAiClient } from "@/lib/ai/client";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  analysisEvidenceState,
  readAnalysisForStrategy,
} from "@/lib/seo/analysis";
import { getLatestSnapshot } from "@/lib/seo/snapshot";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";

const BriefInput = z.object({
  strategyVersionId: z.string().min(1),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  analysisGeneratedAt: z.string().datetime(),
  candidateId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

function classifyBriefError(err: unknown): { status: number; error: string; detail?: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("authentication fails") || lower.includes("api key") || lower.includes("401")) {
    return {
      status: 503,
      error: "AI provider authentication failed",
      detail: "The configured AI API key is invalid or expired. Update the DeepSeek/OpenRouter credential, then retry brief generation.",
    };
  }
  if (lower.includes("no ai provider configured") || lower.includes("provider not configured")) {
    return {
      status: 503,
      error: "AI provider is not configured",
      detail: "Set a valid DeepSeek or OpenRouter API key, then retry brief generation.",
    };
  }
  return {
    status: 500,
    error: "Brief generation failed",
    detail: "The AI provider failed unexpectedly. Retry brief generation, or contact an administrator if the problem continues.",
  };
}

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`brief:${actor}`, 10, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded: max 10 briefs per minute" }, { status: 429 });
  }
  const parsed = BriefInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid mapped content candidate." }, { status: 400 });
  }

  const [snapshot, commandCenter] = await Promise.all([
    getLatestSnapshot("seo_analysis"),
    loadActiveTopicalMapCommandCenter(prisma),
  ]);
  const generatedAt = snapshot?.payload?.generatedAt;
  if (!snapshot
    || !commandCenter
    || generatedAt !== parsed.data.analysisGeneratedAt
    || commandCenter.identity.versionId !== parsed.data.strategyVersionId
    || commandCenter.identity.packageSha256 !== parsed.data.packageSha256
    || analysisEvidenceState(snapshot.payload) !== "current") {
    return NextResponse.json({ error: "Analysis or strategy changed." }, { status: 409 });
  }
  const analysis = readAnalysisForStrategy(snapshot.payload, commandCenter.identity);
  const candidate = analysis?.gaps.find((gap) =>
    gap.candidateId === parsed.data.candidateId
    && gap.kind === "content"
    && typeof gap.page === "string");
  const page = candidate
    ? commandCenter.pages.find((item) =>
      item.url === candidate.page
      && item.ruleIds.slice().sort().join("\0") === candidate.ruleIds.slice().sort().join("\0"))
    : null;
  if (!candidate || !page?.decision) {
    return NextResponse.json({ error: "Mapped content candidate is no longer available." }, { status: 409 });
  }

  const prompt = [
    "Create a concise implementation brief for this exact active topical-map content decision.",
    `Mapped title: ${page.title ?? candidate.suggestedTitle}`,
    `Exact target URL: ${page.url}`,
    `Target keyword: ${page.primaryKeywordOrTheme ?? candidate.query}`,
    `Secondary variants: ${page.secondaryVariants ?? "none specified"}`,
    `Map decision: ${page.decision}`,
    `Observed evidence: ${JSON.stringify(candidate.observedEvidence)}`,
    "Do not propose another topic, title, URL, or intent.",
  ].join("\n");

  try {
    const ai = await getAiClient();
    const response = await ai.client.chat.completions.create({
      model: ai.model,
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: "You are Agriko's content implementation strategist. Follow the supplied active topical-map decision exactly. Write in English. Return: mapped objective, required updates, evidence to preserve, internal-link considerations, and completion checks.",
        },
        { role: "user", content: prompt },
      ],
    });
    const message = response.choices[0]?.message as Record<string, unknown> | undefined;
    const brief = ((message?.content as string) || (message?.reasoning_content as string) || "").trim();
    if (!brief) {
      return NextResponse.json({ error: "AI returned an empty brief — please retry" }, { status: 502 });
    }
    return NextResponse.json({ brief });
  } catch (err) {
    console.error("[content-pilot/brief] error:", err);
    const classified = classifyBriefError(err);
    const { status, ...payload } = classified;
    return NextResponse.json(payload, { status });
  }
}
