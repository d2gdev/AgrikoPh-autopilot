export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { getBlockingMapContentProposals } from "@/lib/content-pilot/map-candidate-history";
import { prisma } from "@/lib/db";
import {
  analysisEvidenceState,
  readAnalysisForStrategy,
} from "@/lib/seo/analysis";
import { getLatestSnapshot } from "@/lib/seo/snapshot";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const commandCenter = await loadActiveTopicalMapCommandCenter(prisma);
  if (!commandCenter) {
    return NextResponse.json(
      { error: "An active topical map is required." },
      { status: 409 },
    );
  }

  const now = new Date();
  const [snapshot, contentTasks] = await Promise.all([
    getLatestSnapshot("seo_analysis"),
    prisma.seoFollowUpTask.findMany({
      where: {
        status: "open",
        sourceType: "topical_map",
        sourceKey: {
          startsWith: `topical-map-content:${commandCenter.identity.versionId}:`,
        },
      },
      orderBy: [{ earliestReviewAt: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        sourceKey: true,
        title: true,
        description: true,
        targetUrl: true,
        priority: true,
        earliestReviewAt: true,
        dueAt: true,
        sourceData: true,
      },
    }),
  ]);
  const generatedAt = snapshot?.payload?.generatedAt;
  const analysis = snapshot
    && typeof generatedAt === "string"
    && analysisEvidenceState(snapshot.payload) === "current"
    ? readAnalysisForStrategy(snapshot.payload, commandCenter.identity)
    : null;

  const pageByUrl = new Map(commandCenter.pages.map((page) => [page.url, page]));
  const blockedProposals = analysis
    ? await getBlockingMapContentProposals(prisma, analysis.gaps)
    : new Map<string, string>();
  const taskByCandidateId = new Map(contentTasks.flatMap((task) => {
    if (!isRecord(task.sourceData)
      || typeof task.sourceData.candidateId !== "string"
      || task.sourceData.strategyVersionId !== commandCenter.identity.versionId
      || task.sourceData.packageSha256 !== commandCenter.identity.packageSha256) {
      return [];
    }
    return [[task.sourceData.candidateId, task] as const];
  }));
  const actionable = (analysis?.gaps ?? []).flatMap((gap) => {
    if (gap.kind !== "content" || !gap.page || blockedProposals.has(gap.candidateId)) return [];
    const task = taskByCandidateId.get(gap.candidateId);
    if (!task || task.earliestReviewAt.getTime() > now.getTime()) return [];
    const page = pageByUrl.get(gap.page);
    if (!page?.decision) return [];
    return [{
      candidateId: gap.candidateId,
      targetUrl: page.url,
      title: page.title ?? gap.suggestedTitle,
      action: gap.action === "create" ? "create" as const : "refresh" as const,
      priority: page.priority ?? gap.priority,
      decision: page.decision,
      ruleIds: [...(page.ruleDomains.content_decisions ?? [])].sort(),
    }];
  });

  const research = (analysis?.suppressed ?? []).flatMap((item) => {
    const page = pageByUrl.get(item.page);
    const contentRuleIds = page?.ruleDomains.content_decisions ?? [];
    if (!page?.url.startsWith("/blogs/")
      || !page.decision
      || !contentRuleIds.some((ruleId) => item.ruleIds.includes(ruleId))) return [];
    return [{
      targetUrl: page.url,
      title: page.title ?? item.currentArticleTitle ?? page.url,
      priority: page.priority ?? "unspecified",
      decision: page.decision,
      reason: item.reason,
      ruleIds: [...contentRuleIds].sort(),
    }];
  });
  const upcoming = contentTasks.flatMap((task) => {
    if (task.earliestReviewAt.getTime() <= now.getTime()) return [];
    if (!isRecord(task.sourceData)
      || task.sourceData.strategyVersionId !== commandCenter.identity.versionId
      || task.sourceData.packageSha256 !== commandCenter.identity.packageSha256
      || typeof task.sourceData.candidateId !== "string"
      || (task.sourceData.action !== "create" && task.sourceData.action !== "refresh")) {
      return [];
    }
    const phase = isRecord(task.sourceData.phase) ? task.sourceData.phase : null;
    const ruleIds = [...new Set([
      ...(Array.isArray(task.sourceData.ruleIds) ? task.sourceData.ruleIds : []),
      ...(Array.isArray(task.sourceData.phaseRuleIds) ? task.sourceData.phaseRuleIds : []),
    ].filter((ruleId): ruleId is string => typeof ruleId === "string"))].sort();
    return [{
      taskId: task.id,
      title: task.title,
      targetUrl: task.targetUrl,
      action: task.sourceData.action,
      obligations: task.description,
      priority: task.priority,
      earliestReviewAt: task.earliestReviewAt.toISOString(),
      dueAt: task.dueAt?.toISOString() ?? null,
      phaseLabel: typeof phase?.label === "string" ? phase.label : null,
      ruleIds,
    }];
  });

  return NextResponse.json({
    strategy: {
      versionId: commandCenter.identity.versionId,
      packageSha256: commandCenter.identity.packageSha256,
      analysisGeneratedAt: typeof generatedAt === "string" ? generatedAt : null,
    },
    currentWork: analysis
      ? { status: "current", reason: null }
      : {
          status: "refresh_required",
          reason: "Current strategy-bound SEO analysis must be refreshed.",
        },
    actionable,
    upcoming,
    research: [...new Map(research.map((item) => [item.targetUrl, item])).values()],
  });
}
