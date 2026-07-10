export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";

import { PERMISSIONS, getSessionShop, getSessionUser, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateProposalDraft } from "@/lib/content-pilot/generation-service";

type GenerateDraftBody = { preservePublishedReceipt?: boolean };

function classifyDraftGenerationError(raw: string): { status: number; error: string; detail: string } {
  const lower = raw.toLowerCase();
  const message = raw.trim();

  if (lower.startsWith("draft too short") || lower.startsWith("draft is missing")) {
    return {
      status: 422,
      error: "Draft validation failed",
      detail: raw,
    };
  }

  if (lower.includes("authentication fails") || lower.includes("api key") || lower.includes("401")) {
    return {
      status: 503,
      error: "AI provider authentication failed",
      detail: "The configured AI API key is invalid or expired. Update the DeepSeek/OpenRouter credential, then retry generation.",
    };
  }

  if (lower.includes("no ai provider configured") || lower.includes("provider not configured")) {
    return {
      status: 503,
      error: "AI provider is not configured",
      detail: "Set a valid DeepSeek or OpenRouter API key, then retry generation.",
    };
  }

  if (lower.includes("could not be parsed") || lower.includes("valid draft json")) {
    return {
      status: 502,
      error: "AI provider returned invalid draft JSON",
      detail: "The model response could not be parsed after retry. Retry once; if repeats, inspect the stored draft error.",
    };
  }

  return {
    status: 500,
    error: "Draft generation failed",
    detail: raw.slice(0, 500),
  };
}

function parseBody(rawBody: string): GenerateDraftBody {
  try {
    const parsed = JSON.parse(rawBody) as GenerateDraftBody;
    return parsed?.preservePublishedReceipt === true ? { preservePublishedReceipt: true } : {};
  } catch {
    return {};
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const { id } = await params;
  const shop = await getSessionShop(req);
  const actor = await getSessionUser(req) ?? "operator";
  const rateLimitActor = shop ?? actor ?? "embedded-app";

  if (!checkRateLimit(`gen-draft:${rateLimitActor}`, 120, 60_000)) {
    return NextResponse.json(
      { error: "Rate limit exceeded — max 120 draft generations per minute" },
      { status: 429 },
    );
  }

  const body = parseBody(await req.text());

  try {
    const result = await generateProposalDraft({
      prismaClient: prisma,
      proposalId: id,
      actor,
      preservePublishedReceipt: body.preservePublishedReceipt,
    });

    if (result.kind === "ready") {
      return NextResponse.json({
        draftStatus: result.proposal.draftStatus,
        draftContent: result.proposal.draftContent,
        draftError: result.proposal.draftError,
        draftGeneratedAt: result.proposal.draftGeneratedAt,
      });
    }

    if (result.kind === "conflict" || result.kind === "discarded") {
      return NextResponse.json(
        { error: result.reason },
        { status: 409 },
      );
    }

    const classified = classifyDraftGenerationError(result.error);
    return NextResponse.json(classified, { status: classified.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === `Proposal not found: ${id}`) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("[content-pilot/generate-draft] unhandled error:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: msg.slice(0, 500) },
      { status: 500 },
    );
  }
}
