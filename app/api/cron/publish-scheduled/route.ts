export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { CONTENT_PROPOSAL_PUBLISHABLE_STATUSES } from "@/lib/content-pilot/proposal-state";
import { publishContentProposal, retryIncompletePublishFinalizations } from "@/lib/content-pilot/publish-service";
import { runFetchBlogContentLocked } from "@/jobs/fetch-blog-content";

export async function GET(req: NextRequest) {
  const authError = requireCronAuth(req);
  if (authError) return authError;
  const acquired = await acquireJobLock("publish-scheduled");
  if (!acquired) return NextResponse.json({ skipped: true, reason: "publish-scheduled job already running" }, { status: 409 });
  try {
    const now = new Date();
    const bookkeeping = await retryIncompletePublishFinalizations(prisma, 50);
    const due = await prisma.contentProposal.findMany({ where: { status: { in: [...CONTENT_PROPOSAL_PUBLISHABLE_STATUSES] }, draftStatus: "ready", scheduledPublishAt: { lte: now } }, select: { id: true } });
    const results = [] as { id: string; kind: string; error?: string; warning?: string }[];
    for (const proposal of due) {
      const result = await publishContentProposal({ prismaClient: prisma, proposalId: proposal.id, actor: "cron", trigger: "scheduled", dueBefore: now, reindex: false });
      results.push({ id: proposal.id, kind: result.kind, ...("message" in result ? { error: result.message } : {}), ...("warning" in result ? { warning: result.warning } : {}) });
    }
    const published = results.filter((result) => result.kind === "published" || result.kind === "published_with_warnings").length;
    let reindexWarning: string | undefined;
    if (published) {
      try { await runFetchBlogContentLocked(); }
      catch (error) { reindexWarning = `Post-publish re-index failed: ${String(error)}`; }
    }
    const withReindexWarning = (result: typeof results[number]) => {
      if (result.kind !== "published" && result.kind !== "published_with_warnings") return result;
      const warning = [result.warning, reindexWarning].filter((value): value is string => Boolean(value)).join(" ");
      return { ...result, kind: "published_with_warnings", warning, error: warning };
    };
    const truthfulResults = reindexWarning ? results.map(withReindexWarning) : results;
    if (reindexWarning) {
      await Promise.all(results
        .filter((result) => result.kind === "published" || result.kind === "published_with_warnings")
        .map((result) => prisma.contentProposal.updateMany({
          where: { id: result.id, draftStatus: "published" },
          data: { publishWarning: withReindexWarning(result).warning },
        })));
    }
    return NextResponse.json({ published, results: truthfulResults, bookkeeping, ...(reindexWarning ? { reindexWarning } : {}) });
  } finally { await releaseJobLock("publish-scheduled"); }
}
