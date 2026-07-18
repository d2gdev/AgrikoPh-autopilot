export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { getActionableMapContentCandidateIds } from "@/lib/content-pilot/map-candidate-history";
import { getLatestSnapshot } from "@/lib/seo/snapshot";
import { prisma } from "@/lib/db";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { analysisEvidenceState, readAnalysisForStrategy, readAnalysisStrategyIdentity } from "@/lib/seo/analysis";

function blogIdentity(value: string | undefined): { blogHandle: string; handle: string } | null {
  if (!value) return null;
  const match = /^\/blogs\/([^/]+)\/([^/]+)$/.exec(value);
  return match ? { blogHandle: match[1]!, handle: match[2]! } : null;
}

export async function GET(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const [snap, commandCenter] = await Promise.all([getLatestSnapshot("seo_analysis"), loadActiveTopicalMapCommandCenter(prisma)]);
  if (!commandCenter) return NextResponse.json({ state: "no_active_strategy", analysis: null, generatedAt: null, strategy: null });
  const cachedStrategy = snap ? readAnalysisStrategyIdentity(snap.payload) : null;
  const analysis = commandCenter && snap ? readAnalysisForStrategy(snap.payload, commandCenter.identity) : null;
  const stale = cachedStrategy !== null && (cachedStrategy.versionId !== commandCenter.identity.versionId || cachedStrategy.packageSha256 !== commandCenter.identity.packageSha256);
  const evidenceState = snap ? analysisEvidenceState(snap.payload) : "observation_unavailable";
  const actionableContentIds = analysis && !stale && evidenceState === "current"
    ? await getActionableMapContentCandidateIds(prisma, {
        strategyVersionId: commandCenter.identity.versionId,
        gaps: analysis.gaps,
      })
    : null;
  const linkGaps = analysis && !stale && evidenceState === "current"
    ? analysis.gaps.filter((gap) => gap.kind === "link")
    : [];
  const linkIdentities = linkGaps
    .map((gap) => blogIdentity(gap.fromUrl))
    .filter((identity): identity is NonNullable<typeof identity> => identity !== null);
  const currentLinkArticles = linkIdentities.length > 0
    ? await prisma.articleRecord.findMany({
        where: { OR: linkIdentities },
        select: { blogHandle: true, handle: true, contentHash: true, updatedAt: true },
      })
    : [];
  const currentLinkArticleByUrl = new Map(currentLinkArticles.map((article) => [
    `/blogs/${article.blogHandle}/${article.handle}`,
    article,
  ]));
  const currentLinkCandidateIds = new Set(linkGaps.flatMap((gap) => {
    const article = currentLinkArticleByUrl.get(gap.fromUrl ?? "");
    if (!article) return [];
    const matches = gap.observation.stateHash
      ? article.contentHash === gap.observation.stateHash
      : article.updatedAt.toISOString() === gap.observation.capturedAt;
    return matches ? [gap.candidateId] : [];
  }));
  const presentedAnalysis = analysis && actionableContentIds
    ? {
        ...analysis,
        gaps: analysis.gaps.filter((gap) =>
          gap.kind === "content"
            ? actionableContentIds.has(gap.candidateId)
            : currentLinkCandidateIds.has(gap.candidateId)),
      }
    : analysis;
  return NextResponse.json({
    state: stale ? "strategy_identity_stale" : analysis && evidenceState === "current" ? "ready" : analysis ? evidenceState : "empty",
    analysis: stale || evidenceState !== "current" ? null : presentedAnalysis,
    generatedAt: !stale && analysis && evidenceState === "current" ? snap?.fetchedAt ?? null : null,
    strategy: commandCenter.identity,
    ...(stale ? { cachedStrategy } : {}),
  });
}
