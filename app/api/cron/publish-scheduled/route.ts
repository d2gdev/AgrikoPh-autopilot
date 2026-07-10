export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publishDraft, resolveArticleHandle } from "@/lib/content-pilot/publish-draft";
import { contentProposalPublishRecoveryStatus } from "@/lib/content-pilot/publish-recovery";
import { fetchBlogContentHandler } from "@/jobs/fetch-blog-content";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { CONTENT_PROPOSAL_PUBLISHABLE_STATUSES } from "@/lib/content-pilot/proposal-state";

export async function GET(req: NextRequest) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const acquired = await acquireJobLock("publish-scheduled");
  if (!acquired) {
    return NextResponse.json(
      { skipped: true, reason: "publish-scheduled job already running" },
      { status: 409 },
    );
  }

  try {
    const now = new Date();
    const due = await prisma.contentProposal.findMany({
      where: {
        status: { in: [...CONTENT_PROPOSAL_PUBLISHABLE_STATUSES] },
        draftStatus: "ready",
        scheduledPublishAt: { lte: now },
      },
    });

    if (due.length === 0) return NextResponse.json({ published: 0 });

    const results: { id: string; ok: boolean; error?: string }[] = [];

    for (const proposal of due) {
      // optimistic lock — only one runner can publish at a time, and a
      // concurrent rejection must make the proposal ineligible.
      const locked = await prisma.contentProposal.updateMany({
        where: {
          id: proposal.id,
          status: { in: [...CONTENT_PROPOSAL_PUBLISHABLE_STATUSES] },
          draftStatus: "ready",
        },
        data: { draftStatus: "publishing" },
      });
      if (locked.count === 0) {
        results.push({ id: proposal.id, ok: false, error: "already publishing or no longer approved" });
        continue;
      }

      try {
        const resolvedArticleHandle = resolveArticleHandle(proposal);
        const { shopifyId, handle } = await publishDraft(proposal);
        await prisma.contentProposal.update({
          where: { id: proposal.id },
          data: {
            draftStatus: "published",
            publishedAt: new Date(),
            shopifyArticleId: shopifyId,
            publishedHandle: handle,
            ...(proposal.proposalType !== "new-content" && resolvedArticleHandle && !proposal.articleHandle
              ? { articleHandle: resolvedArticleHandle }
              : {}),
            scheduledPublishAt: null,
          },
        });
        await prisma.auditLog.create({
          data: {
            entityType: "ContentProposal",
            entityId: proposal.id,
            action: "published_scheduled",
            actor: "cron",
            before: { draftStatus: "ready" },
            after: { draftStatus: "published", shopifyId, handle },
          },
        });
        results.push({ id: proposal.id, ok: true });
      } catch (err) {
        console.error(`[publish-scheduled] failed for ${proposal.id}:`, err);
        // Non-idempotent ops (new-content create, internal-link append) must NOT
        // return to "ready" — a retry would double-create/double-append. Flag them
        // for manual inspection. Idempotent ops (seo-fix, content-refresh) are safe
        // to retry, so they return to "ready". Mirrors the manual publish route.
        const errorMessage = String(err);
        const recoveryStatus = contentProposalPublishRecoveryStatus(proposal.proposalType, errorMessage);
        await prisma.contentProposal
          .update({
            where: { id: proposal.id },
            data: { draftStatus: recoveryStatus, draftError: errorMessage.slice(0, 2000) },
          })
          .catch(() => {});
        results.push({ id: proposal.id, ok: false, error: errorMessage });
      }
    }

    fetchBlogContentHandler().catch((err) =>
      console.error("[publish-scheduled] re-index failed:", err)
    );

    return NextResponse.json({ published: results.filter((r) => r.ok).length, results });
  } finally {
    await releaseJobLock("publish-scheduled");
  }
}
