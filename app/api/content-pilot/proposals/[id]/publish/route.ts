export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { getSessionUser, PERMISSIONS, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publishDraft, resolveArticleHandle } from "@/lib/content-pilot/publish-draft";
import { contentProposalPublishRecoveryStatus } from "@/lib/content-pilot/publish-recovery";
import { fetchBlogContentHandler } from "@/jobs/fetch-blog-content";
import { markContentProposalOpportunityResolved } from "@/lib/opportunities/content-proposal-outcomes";
import { CONTENT_PROPOSAL_PUBLISHABLE_STATUSES } from "@/lib/content-pilot/proposal-state";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requirePermission(req, PERMISSIONS.CONTENT_PUBLISH);
  if (authError) return authError;
  const { id } = await params;

  const actor = (await getSessionUser(req)) ?? "operator";

  const proposal = await prisma.contentProposal.findUnique({
    where: { id },
  });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!CONTENT_PROPOSAL_PUBLISHABLE_STATUSES.includes(
    proposal.status as (typeof CONTENT_PROPOSAL_PUBLISHABLE_STATUSES)[number]
  )) {
    return NextResponse.json(
      { error: `Cannot publish a proposal with status "${proposal.status}"` },
      { status: 409 }
    );
  }
  if (proposal.draftStatus !== "ready") {
    const detail = proposal.draftStatus === "failed" && proposal.draftError
      ? `: ${proposal.draftError}`
      : "";
    return NextResponse.json(
      { error: `Cannot publish — draft status is "${proposal.draftStatus ?? "none"}"${detail}` },
      { status: 409 }
    );
  }

  const locked = await prisma.contentProposal.updateMany({
    where: {
      id,
      status: { in: [...CONTENT_PROPOSAL_PUBLISHABLE_STATUSES] },
      draftStatus: "ready",
    },
    data: { draftStatus: "publishing" },
  });
  if (locked.count === 0) {
    const latest = await prisma.contentProposal.findUnique({
      where: { id },
      select: { draftStatus: true, draftError: true },
    });
    const detail = latest?.draftStatus === "failed" && latest.draftError
      ? `: ${latest.draftError}`
      : "";
    return NextResponse.json(
      { error: `Cannot publish — draft status is "${latest?.draftStatus ?? "none"}"${detail}` },
      { status: 409 }
    );
  }

  try {
    // Re-fetch after acquiring the lock: the lock above only guards draftStatus,
    // so a concurrent edit (PATCH /proposals/[id], which writes draftContent while
    // leaving draftStatus at "ready") can land between the initial read and the
    // lock. Without this re-fetch, publishDraft() below would silently publish
    // the pre-edit draftContent instead of what the operator just saved. Done
    // inside the try block so a failure here still flows through the catch
    // below and releases the "publishing" lock instead of leaving it stuck.
    const fresh = await prisma.contentProposal.findUnique({ where: { id } });
    if (!fresh) throw new Error("Proposal disappeared after lock was acquired");

    const resolvedArticleHandle = resolveArticleHandle(fresh);
    const { shopifyId, handle } = await publishDraft(fresh);

    // Persist the Shopify article id/handle immediately, before any further step
    // (SEO-score lookup, metafield work) that could throw. If a later step fails
    // and the publish is retried, publishDraft can detect the existing article
    // via proposal.shopifyArticleId and update it rather than creating a duplicate.
    await prisma.contentProposal.update({
      where: { id },
      data: {
        shopifyArticleId: shopifyId,
        ...(handle ? { publishedHandle: handle } : {}),
        ...(fresh.proposalType !== "new-content" && resolvedArticleHandle && !fresh.articleHandle
          ? { articleHandle: resolvedArticleHandle }
          : {}),
      },
    });

    // Fetch current SEO score from indexed article
    const indexed = resolvedArticleHandle
      ? await prisma.articleRecord.findFirst({
          where: { handle: resolvedArticleHandle },
          select: { seoData: true },
          orderBy: { indexedAt: "desc" },
        })
      : null;
    const seoData = indexed?.seoData as { score?: number; blogHandle?: string } | null;
    const baselineSeoScore = seoData?.score ?? null;
    const resolvedBlogHandle = seoData?.blogHandle ?? null;

    // Merge resolved blogHandle into proposedState so "View on Shopify" always links correctly
    const updatedProposedState = resolvedBlogHandle
      ? { ...(fresh.proposedState as Record<string, unknown>), blogHandle: resolvedBlogHandle }
      : fresh.proposedState;

    await prisma.contentProposal.update({
      where: { id },
      data: {
        draftStatus: "published",
        publishedAt: new Date(),
        shopifyArticleId: shopifyId,
        publishedHandle: handle,
        ...(fresh.proposalType !== "new-content" && resolvedArticleHandle && !fresh.articleHandle
          ? { articleHandle: resolvedArticleHandle }
          : {}),
        proposedState: updatedProposedState ?? undefined,
        ...(baselineSeoScore !== null ? { baselineSeoScore } : {}),
      },
    });

    await markContentProposalOpportunityResolved(prisma, {
      proposalId: id,
      sourceData: fresh.sourceData,
    });

    await prisma.auditLog.create({
      data: {
        entityType: "ContentProposal",
        entityId: id,
        action: fresh.proposalType === "seo-fix" ? "seo_meta_applied" : "published",
        actor,
        before: { draftStatus: "ready" },
        after: { draftStatus: "published", shopifyId, handle },
      },
    });

    // Re-index blog content so ArticleRecord reflects the published state.
    // Non-blocking: publish already succeeded. But surface any failure to the
    // operator via a reindexWarning in the response instead of swallowing it.
    let reindexWarning: string | undefined;
    try {
      await fetchBlogContentHandler();
    } catch (reindexErr) {
      reindexWarning = `Post-publish re-index failed: ${String(reindexErr)}. The article is published but the local index may be stale until the next re-index.`;
      console.warn("[content-pilot/publish] post-publish re-index failed:", reindexErr);
    }

    return NextResponse.json({
      published: true,
      shopifyId,
      handle,
      ...(reindexWarning ? { reindexWarning } : {}),
    });
  } catch (err: unknown) {
    console.error("[content-pilot/publish] error:", err);
    // Non-idempotent operations (new-content create, internal-link append) must NOT
    // silently return to "ready" — a re-publish would double-create/double-append in
    // the live store. Flag them for manual inspection instead. Idempotent ops
    // (seo-fix, body refresh) are safe to retry, so they return to "ready".
    const errorMessage = String(err);
    const recoveryStatus = contentProposalPublishRecoveryStatus(proposal.proposalType, errorMessage);
    await prisma.contentProposal.update({
      where: { id },
      data: { draftStatus: recoveryStatus, draftError: errorMessage.slice(0, 2000) },
    }).catch((updateErr) => {
      console.error("[content-pilot/publish] failed to release publish lock:", updateErr);
    });
    // Shopify userErrors → 422 so the UI can show the Shopify message
    const userErrors =
      err instanceof Error && "userErrors" in err
        ? (err as Error & { userErrors: unknown }).userErrors
        : undefined;
    const status = userErrors ? 422 : 500;
    return NextResponse.json({ error: errorMessage, userErrors }, { status });
  }
}
