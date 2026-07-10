export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { CONTENT_PROPOSAL_PUBLISHABLE_STATUSES } from "@/lib/content-pilot/proposal-state";
import { publishContentProposal, retryIncompletePublishFinalizations } from "@/lib/content-pilot/publish-service";

export async function GET(req: NextRequest) {
  const authError = requireCronAuth(req);
  if (authError) return authError;
  const acquired = await acquireJobLock("publish-scheduled");
  if (!acquired) return NextResponse.json({ skipped: true, reason: "publish-scheduled job already running" }, { status: 409 });
  try {
    const now = new Date();
    const bookkeeping = await retryIncompletePublishFinalizations(prisma, 50);
    const due = await prisma.contentProposal.findMany({ where: { status: { in: [...CONTENT_PROPOSAL_PUBLISHABLE_STATUSES] }, draftStatus: "ready", scheduledPublishAt: { lte: now } }, select: { id: true } });
    const results = [] as { id: string; kind: string; error?: string }[];
    for (const proposal of due) {
      const result = await publishContentProposal({ prismaClient: prisma, proposalId: proposal.id, actor: "cron", trigger: "scheduled", dueBefore: now });
      results.push({ id: proposal.id, kind: result.kind, ...("message" in result ? { error: result.message } : {}) });
    }
    return NextResponse.json({ published: results.filter((result) => result.kind === "published" || result.kind === "published_with_warnings").length, results, bookkeeping });
  } finally { await releaseJobLock("publish-scheduled"); }
}
