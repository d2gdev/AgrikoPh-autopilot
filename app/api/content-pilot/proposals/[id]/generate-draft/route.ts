export const dynamic = "force-dynamic";
// Draft generation runs a reasoning model that can emit tens of thousands of
// tokens; give it generous headroom so it isn't killed mid-generation.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireAppAuth, getSessionUser, getSessionShop } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateDraft, collectDraftCitations } from "@/lib/content-pilot/generate-draft";
import { resolveArticleHandle } from "@/lib/content-pilot/publish-draft";
import { fetchBlogArticles } from "@/lib/shopify-admin";

// ── Pre-publish validation ────────────────────────────────────────────────────

function validateDraft(
  proposalType: string,
  bodyHtml: string,
  targetWordCount?: number | null,
  action?: string | null
): string | null {
  const text = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = text.split(" ").filter(Boolean).length;

  if (targetWordCount && wordCount < targetWordCount * 0.8) {
    return `Draft too short: ${wordCount} words (target: ${targetWordCount}, minimum: ${Math.round(targetWordCount * 0.8)})`;
  }
  if (wordCount < 100) {
    return `Draft too short: only ${wordCount} words`;
  }
  if (!/<h2/i.test(bodyHtml) && wordCount > 300) {
    return `Draft is missing H2 headings (${wordCount} words with no structure)`;
  }
  if (action === "add_h1" && !/<h1[\s>]/i.test(bodyHtml)) {
    return "Draft is missing the requested H1 heading";
  }

  return null; // valid
}

function articleIdentityError(proposalType: string) {
  return `Proposal type "${proposalType}" requires an articleHandle or a Shopify article URL in proposal data`;
}

function classifyDraftGenerationError(err: unknown): { status: number; error: string; detail: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

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
      error: "AI returned invalid draft JSON",
      detail: "The model response could not be parsed after retry. Retry once; if it repeats, inspect the stored draft error.",
    };
  }

  return {
    status: 500,
    error: "Draft generation failed",
    detail: raw.slice(0, 500),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

// Tracks proposal ids with an in-flight generation in this process so two
// parallel requests for the same proposal don't both call the AI. Cleared in a
// finally block regardless of outcome. Best-effort (per-instance, in-memory).
const inFlight = new Set<string>();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const { id } = await params;
  const shop = await getSessionShop(req);
  const sessionUser = await getSessionUser(req);
  const actor = sessionUser ?? "operator";
  const rateLimitActor = shop ?? sessionUser ?? "embedded-app";
  // Raised to 120/min to support concurrent bulk backfills (e.g. re-generating
  // meta for the whole catalogue). Single-operator tool; abuse risk is low and
  // Shopify's own throttling still bounds the downstream publish step.
  if (!checkRateLimit(`gen-draft:${rateLimitActor}`, 120, 60_000)) {
    return NextResponse.json(
      { error: "Rate limit exceeded — max 120 draft generations per minute" },
      { status: 429 }
    );
  }

  // Dedup: reject a second concurrent generation for the same proposal id.
  if (inFlight.has(id)) {
    return NextResponse.json(
      { error: "Generation already in progress for this proposal" },
      { status: 409 }
    );
  }
  inFlight.add(id);

  try {
  const proposal = await prisma.contentProposal.findUnique({
    where: { id },
  });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (proposal.status !== "approved") {
    return NextResponse.json(
      { error: "Only approved proposals can generate a draft" },
      { status: 409 }
    );
  }

  const resolvedArticleHandle =
    proposal.proposalType === "new-content" ? null : resolveArticleHandle(proposal);
  if (proposal.proposalType !== "new-content" && !resolvedArticleHandle) {
    const error = articleIdentityError(proposal.proposalType);
    await prisma.contentProposal.update({
      where: { id },
      data: { draftStatus: "failed", draftError: error },
    });
    return NextResponse.json({ error }, { status: 422 });
  }
  const proposalForDraft =
    resolvedArticleHandle && !proposal.articleHandle
      ? { ...proposal, articleHandle: resolvedArticleHandle }
      : proposal;

  // Capture this BEFORE the first update flips draftStatus to "generating",
  // otherwise the audit label below would always read "generating" and never
  // distinguish a regeneration from a first-time generation.
  const wasReady = proposal.draftStatus === "ready";

  // Auto-recover orphaned in-progress rows so the operator can retry without
  // navigating away. Two stale conditions are recovered:
  //
  // "generating": safe to reset if this process has no inFlight record (the
  //   generation ran in another instance that restarted), OR if it has been
  //   running for > 6 min (past the 300s maxDuration on this route).
  //
  // "publishing": the publish route has maxDuration=30s, so anything still
  //   "publishing" after 2 min is guaranteed dead. No inFlight tracking for
  //   publish, so time-based only.
  const now = Date.now();
  if (
    proposal.draftStatus === "generating" &&
    (!inFlight.has(id) || (proposal.draftGeneratedAt && now - proposal.draftGeneratedAt.getTime() > 6 * 60 * 1000))
  ) {
    await prisma.contentProposal.update({ where: { id }, data: { draftStatus: "failed" } });
    proposal.draftStatus = "failed" as typeof proposal.draftStatus;
  } else if (
    proposal.draftStatus === "publishing" &&
    proposal.updatedAt &&
    now - proposal.updatedAt.getTime() > 2 * 60 * 1000
  ) {
    await prisma.contentProposal.update({ where: { id }, data: { draftStatus: "ready" } });
    proposal.draftStatus = "ready" as typeof proposal.draftStatus;
  }

  // Mark as generating immediately so the UI can show a spinner. We leave any
  // existing draftContent in place so a regeneration keeps showing the previous
  // draft until the new one is ready. We also stamp draftGeneratedAt now so the
  // stale-generating sweeper (in proposals/route.ts) can detect and recover a
  // proposal that gets stuck in "generating" if this process dies mid-call.
  // NOTE: "generating" is only ever cleared by (a) a successful completion
  // below, (b) the failure handler in this route's catch block, or (c) the
  // stale-generating sweeper — never anywhere else.
  //
  // Optimistic transition: only flip to "generating" if the row isn't ACTIVELY
  // mid-flight. We block "generating" (a concurrent generation) and "publishing"
  // (a publish reading the draft) — true races. We intentionally ALLOW "published"
  // and "ready": regenerating to improve a draft and re-publishing is a normal
  // operator workflow and doesn't touch the live article until they publish again.
  // NULL is not matched by Prisma's notIn filter (SQL: NULL NOT IN (...) = NULL).
  // Proposals that have never had a draft generated have draftStatus=null and must
  // be explicitly included, otherwise the claim always returns count=0 for them.
  const claimed = await prisma.contentProposal.updateMany({
    where: {
      id,
      OR: [
        { draftStatus: null },
        { draftStatus: { notIn: ["generating", "publishing"] } },
      ],
    },
    data: { draftStatus: "generating", draftGeneratedAt: new Date() },
  });
  if (claimed.count === 0) {
    return NextResponse.json(
      { error: "Draft is currently generating or publishing — try again in a moment" },
      { status: 409 }
    );
  }

  if (resolvedArticleHandle && !proposal.articleHandle) {
    await prisma.contentProposal.update({
      where: { id },
      data: { articleHandle: resolvedArticleHandle },
    });
  }

  try {
    // Fetch article context from Shopify (null for new-content proposals)
    let article = null;
    if (proposalForDraft.articleHandle) {
      const articles = await fetchBlogArticles();
      article = articles.find((a) => a.handle === proposalForDraft.articleHandle) ?? null;
    }

    const draftContent = await generateDraft(proposalForDraft, article);

    // Pre-publish validation — check word count and structure for body proposals.
    // Skip for metadata-only types (seo-fix, internal-link, missing-meta) which
    // have no bodyHtml to validate.
    if (
      proposal.proposalType !== "seo-fix" &&
      proposal.proposalType !== "internal-link" &&
      proposal.proposalType !== "missing-meta"
    ) {
      const dc = draftContent as Record<string, unknown>;
      const bodyHtml = (dc.bodyHtml as string | undefined) ?? "";
      const ps = proposal.proposedState as Record<string, unknown>;
      const targetWordCount = (ps.targetWordCount ?? ps.idealWordCount) as number | null ?? null;
      const action = typeof ps.action === "string" ? ps.action : null;
      const validationError = validateDraft(proposal.proposalType, bodyHtml, targetWordCount, action);
      if (validationError) {
        await prisma.contentProposal.update({
          where: { id },
          data: { draftStatus: "failed", draftError: validationError },
        });
        return NextResponse.json({ error: validationError }, { status: 422 });
      }
    }

    const updated = await prisma.contentProposal.update({
      where: { id },
      data: {
        draftStatus: "ready",
        draftContent: draftContent as object,
        draftGeneratedAt: new Date(),
        draftError: null,
      },
    });

    await prisma.contentProposalDraftHistory.create({
      data: {
        proposalId: id,
        savedBy: actor,
        draftContent: draftContent as object,
        reason: wasReady ? "regenerated" : "generated",
      },
    });

    // Citation persistence is best-effort and isolated from the core draft
    // write: the `citations` column's migration (20260701030000) is not yet
    // applied to the live DB, so this update can fail with `42703 column
    // "citations" does not exist`. It must never affect draftStatus/draftContent
    // or the response above.
    try {
      const citations = await collectDraftCitations(proposalForDraft);
      await prisma.contentProposal.update({
        where: { id },
        data: { citations: citations as object },
      });
    } catch (err) {
      console.warn("[generate-draft] skipped citation persistence:", err);
    }

    return NextResponse.json({
      draftStatus: updated.draftStatus,
      draftContent: updated.draftContent,
    });
  } catch (err) {
    console.error("[content-pilot/generate-draft] error:", err);
    const classified = classifyDraftGenerationError(err);
    const draftError = `${classified.error}: ${classified.detail}`;
    await prisma.contentProposal.update({
      where: { id },
      data: { draftStatus: "failed", draftError },
    });
    return NextResponse.json(classified, { status: classified.status });
  }
  } finally {
    inFlight.delete(id);
  }
}
