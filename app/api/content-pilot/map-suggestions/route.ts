export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  analysisEvidenceState,
  readAnalysisForStrategy,
} from "@/lib/seo/analysis";
import { getLatestSnapshot } from "@/lib/seo/snapshot";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const [snapshot, commandCenter] = await Promise.all([
    getLatestSnapshot("seo_analysis"),
    loadActiveTopicalMapCommandCenter(prisma),
  ]);
  const generatedAt = snapshot?.payload?.generatedAt;
  if (!snapshot
    || !commandCenter
    || typeof generatedAt !== "string"
    || analysisEvidenceState(snapshot.payload) !== "current") {
    return NextResponse.json(
      { error: "Current strategy-bound SEO analysis is required." },
      { status: 409 },
    );
  }
  const analysis = readAnalysisForStrategy(snapshot.payload, commandCenter.identity);
  if (!analysis) {
    return NextResponse.json(
      { error: "SEO analysis does not match the active topical map." },
      { status: 409 },
    );
  }

  const pageByUrl = new Map(commandCenter.pages.map((page) => [page.url, page]));
  const actionable = analysis.gaps.flatMap((gap) => {
    if (gap.kind !== "content" || !gap.page) return [];
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

  const research = analysis.suppressed.flatMap((item) => {
    const page = pageByUrl.get(item.page);
    const contentRuleIds = page?.ruleDomains.content_decisions ?? [];
    if (!page?.decision || !contentRuleIds.some((ruleId) => item.ruleIds.includes(ruleId))) return [];
    return [{
      targetUrl: page.url,
      title: page.title ?? item.currentArticleTitle ?? page.url,
      priority: page.priority ?? "unspecified",
      decision: page.decision,
      reason: item.reason,
      ruleIds: [...contentRuleIds].sort(),
    }];
  });

  return NextResponse.json({
    strategy: {
      versionId: commandCenter.identity.versionId,
      packageSha256: commandCenter.identity.packageSha256,
      analysisGeneratedAt: generatedAt,
    },
    actionable,
    research: [...new Map(research.map((item) => [item.targetUrl, item])).values()],
  });
}
