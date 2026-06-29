export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publishDraft, resolveArticleHandle } from "@/lib/content-pilot/publish-draft";
import { fetchBlogContentHandler } from "@/jobs/fetch-blog-content";

export async function GET(req: NextRequest) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const now = new Date();
  const due = await prisma.contentProposal.findMany({
    where: {
      draftStatus: "ready",
      scheduledPublishAt: { lte: now },
    },
  });

  if (due.length === 0) return NextResponse.json({ published: 0 });

  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const proposal of due) {
    // optimistic lock — only one runner can publish at a time
    const locked = await prisma.contentProposal.updateMany({
      where: { id: proposal.id, draftStatus: "ready" },
      data: { draftStatus: "publishing" },
    });
    if (locked.count === 0) {
      results.push({ id: proposal.id, ok: false, error: "already publishing" });
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
      const nonIdempotent =
        proposal.proposalType === "new-content" ||
        proposal.proposalType === "internal-link";
      const errorMessage = String(err);
      const missingArticleIdentity = errorMessage.includes("requires an articleHandle");
      const recoveryStatus = missingArticleIdentity ? "failed" : nonIdempotent ? "publish-error" : "ready";
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
}
