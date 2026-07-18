export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getBlockingMapContentProposals } from "@/lib/content-pilot/map-candidate-history";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { getLatestSnapshot } from "@/lib/seo/snapshot";
import { analysisEvidenceState, readAnalysisForStrategy, type MapAwareSeoGap } from "@/lib/seo/analysis";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { createGovernedContentProposalInTransaction } from "@/lib/topical-map/compliance-store";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";
import type { StrategyProposalCandidate } from "@/lib/topical-map/proposal-context";
import { topicalMapActionEligibility, topicalMapInternalLinkEligibility, topicalMapInternalLinkRequiresAddition } from "@/lib/topical-map/action-eligibility";
import { normalizeTopicalMapPriority } from "@/lib/topical-map/priority";

const BodySchema = z.object({
  strategyVersionId: z.string().min(1),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  analysisGeneratedAt: z.string().datetime(),
  candidateIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.candidateIds).size !== value.candidateIds.length) ctx.addIssue({ code: "custom", message: "Candidate IDs must be unique" });
});

type ResultStatus = "created" | "already_existing" | "stale_or_blocked" | "failed";
type Result = { candidateId: string; status: ResultStatus; proposalId?: string };

function blogIdentity(value: string | undefined): { blogHandle: string; handle: string } | null {
  if (!value) return null;
  const match = /^\/blogs\/([^/]+)\/([^/]+)$/.exec(normalizeGovernedUrl(value));
  return match ? { blogHandle: match[1]!, handle: match[2]! } : null;
}

function priority(value: string): "P1" | "P2" | "P3" {
  const band = normalizeTopicalMapPriority(value);
  return band === "high" ? "P1" : band === "low" ? "P3" : "P2";
}

async function proposalForCandidate(tx: typeof prisma, gap: MapAwareSeoGap, commandCenter: NonNullable<Awaited<ReturnType<typeof loadActiveTopicalMapCommandCenter>>>) {
  const observedAt = new Date(gap.observation.capturedAt);
  const now = new Date();
  if (observedAt.getTime() > now.getTime() + 5 * 60_000 || now.getTime() - observedAt.getTime() > 72 * 3_600_000) return null;

  if (gap.kind === "link") {
    const fromUrl = normalizeGovernedUrl(gap.fromUrl ?? "");
    const toUrl = normalizeGovernedUrl(gap.toUrl ?? "");
    const link = commandCenter.work.internalLinks.find(item => item.fromUrl === fromUrl && item.toUrl === toUrl && item.ruleIds.slice().sort().join("\0") === gap.ruleIds.slice().sort().join("\0"));
    const sourceIdentity = blogIdentity(fromUrl);
    if (!link || !sourceIdentity || !topicalMapInternalLinkEligibility(link.policy, link.currentBodyState, link.requiredAction).actionable || !topicalMapInternalLinkRequiresAddition(link.requiredAction)) return null;
    const source = await tx.articleRecord.findFirst({ where: sourceIdentity, select: { updatedAt: true, linksData: true } });
    if (!source || source.updatedAt.toISOString() !== gap.observation.capturedAt) return null;
    const internal = source.linksData && typeof source.linksData === "object" && Array.isArray((source.linksData as { internal?: unknown }).internal) ? (source.linksData as { internal: Array<{ href?: unknown }> }).internal : [];
    if (internal.some(item => typeof item.href === "string" && normalizeGovernedUrl(item.href) === toUrl)) return null;
    const targetIdentity = blogIdentity(toUrl);
    const data = {
      proposalType: "internal-link", changeType: "internal_link", articleHandle: sourceIdentity.handle,
      priority: priority(link.priority ?? gap.priority), impact: "medium", effort: "low",
      title: `Add internal link from ${sourceIdentity.handle} to ${targetIdentity?.handle ?? toUrl}`,
      description: link.linkPurpose ? `Add the required internal link for ${link.linkPurpose}.` : `Add the required internal link from ${fromUrl} to ${toUrl}.`,
      proposedState: { fromArticle: sourceIdentity.handle, toArticle: targetIdentity?.handle ?? toUrl, suggestedAnchorText: link.recommendedAnchor ?? gap.query, fromUrl, toUrl },
      sourceData: {
        source: "seo-pilot", strategyVersionId: gap.strategyVersionId, packageSha256: gap.packageSha256, ruleIds: gap.ruleIds,
        fromUrl, toUrl, recommendedAnchor: link.recommendedAnchor ?? null, linkPurpose: link.linkPurpose ?? null,
        currentBodyState: link.currentBodyState ?? null, requiredAction: link.requiredAction ?? null, verification: link.verification ?? null, originalPriority: link.priority ?? null,
        resolutionStatus: link.policy.resolutionStatus,
        observation: { capturedAt: gap.observation.capturedAt, provenance: gap.observation.provenance },
      },
    };
    return { data, candidate: { type: "internal_link", fromUrl, toUrl } satisfies StrategyProposalCandidate };
  }

  const targetUrl = normalizeGovernedUrl(gap.page ?? "");
  const page = commandCenter.pages.find(item => item.url === targetUrl && item.ruleIds.slice().sort().join("\0") === gap.ruleIds.slice().sort().join("\0"));
  const identity = blogIdentity(targetUrl);
  if (!page || !identity || !page.contentDecisionPolicy || !topicalMapActionEligibility(page.contentDecisionPolicy).actionable) return null;
  const article = await tx.articleRecord.findFirst({ where: identity, select: { handle: true, title: true, wordCount: true, updatedAt: true } });
  if (gap.action === "create" && article) return null;
  if (gap.action === "refresh" && (!article || article.updatedAt.toISOString() !== gap.observation.capturedAt)) return null;
  const isCreate = gap.action === "create";
  const proposedTitle = page.title ?? gap.suggestedTitle;
  const targetKeyword = page.primaryKeywordOrTheme ?? gap.query;
  const currentArticleTitle = article?.title ?? null;
  const data = {
    proposalType: isCreate ? "new-content" : "content-refresh", changeType: isCreate ? "new_article" : "update", articleHandle: identity.handle,
    priority: priority(page.priority ?? gap.priority), impact: "medium", effort: "medium", title: isCreate ? proposedTitle : `Refresh content: ${proposedTitle}`,
    description: isCreate ? `Create the active-map article for "${targetKeyword}".` : `Refresh "${proposedTitle}" according to the active map decision "${page.decision}" using only the attached current evidence.`,
    proposedState: isCreate ? { title: proposedTitle, targetQuery: targetKeyword, targetKeyword, targetUrl, blogHandle: identity.blogHandle } : { action: "refresh", articleHandle: identity.handle, articleTitle: proposedTitle, targetKeyword, targetUrl, blogHandle: identity.blogHandle, mapDecision: page.decision, mapEvidence: page.evidence ?? null, priority: page.priority ?? gap.priority, observedEvidence: gap.observedEvidence },
    sourceData: {
      source: "seo-pilot", query: gap.query, page: targetUrl, blogHandle: identity.blogHandle,
      mapTitle: proposedTitle, targetKeyword, targetUrl, currentArticleTitle,
      mapDecision: page.decision ?? null, mapEvidence: page.evidence ?? null, originalPriority: page.priority ?? gap.priority,
      secondaryVariants: page.secondaryVariants ?? null, contentKind: page.contentKind ?? null,
      publishingState: page.publishingState ?? null, exactTargetIfAny: page.exactTargetIfAny ?? null,
      resolutionStatus: page.contentDecisionPolicy.resolutionStatus,
      observation: { capturedAt: gap.observation.capturedAt, provenance: gap.observation.provenance },
      strategyVersionId: gap.strategyVersionId, packageSha256: gap.packageSha256, ruleIds: gap.ruleIds,
      observedEvidence: gap.observedEvidence,
    },
  };
  return { data, candidate: { type: "content", action: isCreate ? "create" : "update", targetUrl } satisfies StrategyProposalCandidate };
}

export async function POST(req: NextRequest) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const { strategyVersionId, packageSha256, analysisGeneratedAt, candidateIds } = parsed.data;
  const actor = (await getSessionUser(req)) ?? "operator";
  const [snapshot, commandCenter] = await Promise.all([getLatestSnapshot("seo_analysis"), loadActiveTopicalMapCommandCenter(prisma)]);
  const persistedGeneratedAt = snapshot?.payload && typeof snapshot.payload === "object" && !Array.isArray(snapshot.payload) ? (snapshot.payload as { generatedAt?: unknown }).generatedAt : null;
  if (!snapshot || !commandCenter || persistedGeneratedAt !== analysisGeneratedAt || commandCenter.identity.versionId !== strategyVersionId || commandCenter.identity.packageSha256 !== packageSha256 || analysisEvidenceState(snapshot.payload) !== "current") {
    return NextResponse.json({ error: "Analysis or strategy changed", code: "STRATEGY_CHANGED" }, { status: 409 });
  }
  const analysis = readAnalysisForStrategy(snapshot.payload, commandCenter.identity);
  if (!analysis) return NextResponse.json({ error: "Analysis or strategy changed", code: "STRATEGY_CHANGED" }, { status: 409 });
  const byId = new Map(analysis.gaps.map(gap => [gap.candidateId, gap]));
  const results: Result[] = [];

  for (const candidateId of candidateIds) {
    const gap = byId.get(candidateId);
    if (!gap) { results.push({ candidateId, status: "stale_or_blocked" }); continue; }
    try {
      const result = await prisma.$transaction(async tx => {
        const proposal = await proposalForCandidate(tx as typeof prisma, gap, commandCenter);
        if (!proposal) return { status: "stale_or_blocked" as const };
        const blockedProposals = await getBlockingMapContentProposals(tx as typeof prisma, [gap]);
        const existingProposalId = blockedProposals.get(candidateId);
        if (existingProposalId) {
          return { status: "already_existing" as const, proposalId: existingProposalId };
        }
        const persisted = await createGovernedContentProposalInTransaction(tx as never, { ...proposal, expectedStrategy: { versionId: strategyVersionId, packageSha256 } } as never);
        if (persisted.created && persisted.proposal) {
          await tx.auditLog.create({ data: { actor, action: "seo_map_candidate_promoted", entityType: "ContentProposal", entityId: persisted.proposal.id, meta: { candidateId, strategyVersionId, packageSha256 } } });
          return { status: "created" as const, proposalId: persisted.proposal.id };
        }
        if (persisted.proposal) return { status: "already_existing" as const, proposalId: persisted.proposal.id };
        return { status: "stale_or_blocked" as const };
      });
      results.push({ candidateId, ...result });
    } catch {
      results.push({ candidateId, status: "failed" });
    }
  }

  const counts = { created: 0, already_existing: 0, stale_or_blocked: 0, failed: 0 };
  for (const result of results) counts[result.status]++;
  return NextResponse.json({ results, counts });
}
