export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createGovernedContentProposalInTransaction, StrategyChangedError } from "@/lib/topical-map/compliance-store";
import { getSessionShop, getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { classifyPriority, findingToImpact, changeTypeToEffort } from "@/lib/content-pilot/priority-score";
import { getLatestGscData } from "@/lib/seo/data";
import { withContentProposalDedupeKey } from "@/lib/content-pilot/create-proposal";
import { articleHandleFromBlogPage, classifySeoPromotion } from "@/lib/seo/promotion";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";
import type { StrategyProposalCandidate } from "@/lib/topical-map/proposal-context";

const GapInputSchema = z.object({
  query: z.string().trim().min(1).max(160),
  impressions: z.coerce.number().int().nonnegative().max(10_000_000).optional(),
  position: z.coerce.number().min(0).max(100).optional(),
  suggestedTitle: z.string().trim().min(10).max(180),
  issue: z.enum(["missing-meta", "thin-content"]).optional(),
  articleHandle: z.string().trim().min(1).max(180).optional(),
  wordCount: z.coerce.number().int().nonnegative().max(100_000).optional(),
  page: z.string().trim().max(500).optional(),
  type: z.string().trim().max(80).optional(),
  ruleIds: z.array(z.string().trim().min(1)).min(1).max(50),
  kind: z.enum(["content", "link"]),
  state: z.literal("candidate"),
  action: z.enum(["create", "update", "refresh"]),
  strategyVersionId: z.string().trim().min(1),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  fromUrl: z.string().trim().min(1).max(500).optional(),
  toUrl: z.string().trim().min(1).max(500).optional(),
  priority: z.string().trim().min(1).max(40),
  mapEvidence: z.string().trim().min(1).max(2_000).nullable(),
  observedEvidence: z.array(z.object({ query: z.string().trim().min(1).max(160), impressions: z.number().nonnegative(), position: z.number().nullable() }).strict()).max(20),
}).strict();
const PromoteGapsBodySchema = z.object({
  strategyVersionId: z.string().trim().min(1),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  gaps: z.array(GapInputSchema).min(1).max(50),
}).strict();

export async function POST(req: NextRequest) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`seo-promote:${actor}`, 10, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 10 promotions per minute" }, { status: 429 });
  }

  const parsed = PromoteGapsBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { gaps, strategyVersionId, packageSha256 } = parsed.data;
  const commandCenter = await loadActiveTopicalMapCommandCenter(prisma);
  if (!commandCenter || commandCenter.identity.versionId !== strategyVersionId || commandCenter.identity.packageSha256 !== packageSha256) {
    return NextResponse.json({ error: "Active strategy changed", code: "STRATEGY_CHANGED" }, { status: 409 });
  }
  const sameRules = (left: string[], right: string[]) => left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
  const governedRuleIds = gaps.map((gap): string[] | null => {
    if (gap.strategyVersionId !== strategyVersionId || gap.packageSha256 !== packageSha256) return null;
    if (gap.kind === "content" && gap.page) {
      const page = commandCenter.pages.find((item) => item.url === gap.page && item.decision && (gap.action === "create" ? /(create|publish|new)/i : /(update|refresh|improve|optimi[sz]e|expand)/i).test(item.decision));
      return page && gap.priority === (page.priority ?? "unspecified") && gap.mapEvidence === (page.evidence ?? null) && sameRules(gap.ruleIds, page.ruleIds) ? [...page.ruleIds] : null;
    }
    if (gap.kind === "link" && gap.action === "update" && gap.fromUrl && gap.toUrl) {
      const fromUrl = normalizeGovernedUrl(gap.fromUrl);
      const toUrl = normalizeGovernedUrl(gap.toUrl);
      const link = commandCenter.work.internalLinks.find((item) => item.fromUrl === fromUrl && item.toUrl === toUrl && /(absent|missing|not present|add)/i.test(`${item.currentBodyState ?? ""} ${item.requiredAction ?? ""}`));
      return link && normalizeGovernedUrl(gap.page ?? "") === fromUrl && sameRules(gap.ruleIds, link.ruleIds) ? [...link.ruleIds] : null;
    }
    return null;
  });
  if (governedRuleIds.some((ruleIds) => ruleIds === null)) {
    return NextResponse.json({ error: "Gap rule context is not active", code: "STRATEGY_CHANGED" }, { status: 409 });
  }

  // Pull GSC keyword context to enrich proposals
  const gscData = await getLatestGscData();
  const allQueries = gscData.queries;
  const knownQueries = new Map(allQueries.map((q) => [q.query.toLowerCase(), q]));
  const evidenceFor = (gap: z.infer<typeof GapInputSchema>) => {
    const pageEvidence = gap.page ? gscData.queryPagePairs.filter((item) => normalizeGovernedUrl(item.page) === normalizeGovernedUrl(gap.page!)).slice(0, 20).map((item) => ({ query: item.query, impressions: item.impressions, position: Number.isFinite(Number(item.position)) ? Number(item.position) : null })) : [];
    if (pageEvidence.length) return pageEvidence;
    const query = knownQueries.get(gap.query.toLowerCase());
    return query ? [{ query: query.query, impressions: query.impressions, position: Number.isFinite(Number(query.position)) ? Number(query.position) : null }] : [];
  };
  if (gaps.some((gap) => JSON.stringify(gap.observedEvidence) !== JSON.stringify(evidenceFor(gap)))) {
    return NextResponse.json({ error: "Gap evidence is no longer current", code: "STRATEGY_CHANGED" }, { status: 409 });
  }

  let skipped = 0;

  // Candidate titles/handles from the input (deduped, valid gaps only).
  const contentGaps = gaps.filter((gap) => gap.kind === "content");
  const candidateTitles = Array.from(new Set(contentGaps.map((g) => g.suggestedTitle)));
  const gapHandles = contentGaps.map((g) => g.articleHandle ?? articleHandleFromBlogPage(g.page)).filter((h): h is string => Boolean(h));
  const candidateHandles = Array.from(new Set(gapHandles));
  const skippedReasons = { duplicate: 0, missingArticle: 0, nonBlogExistingPage: 0, missingGovernedContext: 0 };

  let created;
  try {
  created = await prisma.$transaction(async (tx) => {
    const existingArticles = await tx.articleRecord.findMany({
        where: {
          OR: [
            { title: { in: candidateTitles, mode: "insensitive" } },
            ...(candidateHandles.length > 0 ? [{ handle: { in: candidateHandles } }] : []),
          ],
        },
        select: { handle: true, title: true, wordCount: true },
      });

    const articleByHandle = new Map(existingArticles.map((a) => [a.handle.toLowerCase(), a]));
    const articleByTitle = new Map(existingArticles.map((a) => [a.title.toLowerCase(), a]));

    const seenInBatch = new Set<string>();
    const rows: Array<{ data: Record<string, unknown>; candidate: StrategyProposalCandidate }> = [];

    for (const [gapIndex, gap] of gaps.entries()) {
      if (gap.kind === "link") {
        const fromUrl = normalizeGovernedUrl(gap.fromUrl!);
        const toUrl = normalizeGovernedUrl(gap.toUrl!);
        const governedLink = commandCenter.work.internalLinks.find((link) => link.fromUrl === fromUrl && link.toUrl === toUrl)!;
        const fromArticle = articleHandleFromBlogPage(fromUrl) ?? fromUrl;
        const toArticle = articleHandleFromBlogPage(toUrl) ?? toUrl;
        rows.push({
          data: {
            proposalType: "internal-link", changeType: "internal_link", articleHandle: fromArticle,
            priority: /critical|highest|high/i.test(governedLink.priority ?? "") ? "P1" : /low/i.test(governedLink.priority ?? "") ? "P3" : "P2", impact: "medium", effort: "low",
            title: `Add internal link from ${fromArticle} to ${toArticle}`,
            description: governedLink.linkPurpose ? `Add the required internal link for ${governedLink.linkPurpose}.` : `Add the required internal link from ${fromUrl} to ${toUrl}.`,
            proposedState: { fromArticle, toArticle, suggestedAnchorText: governedLink.recommendedAnchor ?? gap.query, fromUrl, toUrl },
            sourceData: { source: "seo-pilot", strategyVersionId, packageSha256, ruleIds: governedRuleIds[gapIndex]!, fromUrl, toUrl, recommendedAnchor: governedLink.recommendedAnchor ?? null, linkPurpose: governedLink.linkPurpose ?? null, priority: governedLink.priority ?? null },
          },
          candidate: { type: "internal_link", fromUrl, toUrl },
        });
        continue;
      }
      const knownQuery = knownQueries.get(gap.query.toLowerCase());
      const impressions = gap.impressions ?? knownQuery?.impressions ?? 0;
      const position = gap.position ?? (knownQuery ? Number(knownQuery.position) : undefined);
      const inputTitle = gap.suggestedTitle;
      const requestedHandle = gap.articleHandle ?? articleHandleFromBlogPage(gap.page);
      const matchedArticle =
        (requestedHandle ? articleByHandle.get(requestedHandle.toLowerCase()) : undefined) ??
        articleByTitle.get(inputTitle.toLowerCase());
      const decision = gap.kind === "content" && gap.action === "create"
        ? { kind: "promote" as const, proposalType: "new-content" as const }
        : gap.kind === "content" && gap.action === "refresh"
          ? { kind: "promote" as const, proposalType: "content-refresh" as const }
          : classifySeoPromotion({
        issue: gap.issue,
        opportunityType: gap.type,
        page: gap.page,
        requestedHandle,
        matchedArticle: matchedArticle ?? null,
      });
      if (decision.kind === "skip") {
        skipped++;
        skippedReasons[decision.reason]++;
        continue;
      }
      const proposalType = decision.proposalType;
      const articleHandle = matchedArticle?.handle ?? requestedHandle ?? null;
      const targetUrl = typeof gap.page === "string" && gap.page.trim()
        ? gap.page.trim()
        : articleHandle ? `/blogs/news/${articleHandle}` : null;
      if (!targetUrl) {
        skipped++;
        skippedReasons.missingGovernedContext++;
        continue;
      }
      const title = matchedArticle?.title ?? inputTitle;
      const wordCount = matchedArticle?.wordCount ?? 0;
      const governedPage = commandCenter.pages.find((page) => page.url === targetUrl);
      const mapRefresh = gap.action === "refresh";
      const mapDecision = mapRefresh ? governedPage?.decision : undefined;
      const mapEvidence = mapRefresh ? governedPage?.evidence ?? null : undefined;
      const proposalTitle =
        proposalType === "seo-fix"
          ? `Improve SERP snippet: ${title}`
          : mapRefresh
            ? `Refresh content: ${title}`
          : proposalType === "content-refresh"
            ? `Expand thin content: ${title}`
            : title;
    const score = Math.min(
      100,
      Math.round((impressions ?? 0) / 20) +
        (position && position <= 10 ? 20 : position && position <= 20 ? 10 : 0)
    );
    const priority = mapRefresh ? (/critical|highest|high/i.test(gap.priority) ? "P1" : /low/i.test(gap.priority) ? "P3" : "P2") : classifyPriority(score);
    const impact = findingToImpact(score);
    const effort = proposalType === "new-content"
      ? changeTypeToEffort("new_article")
      : proposalType === "seo-fix"
        ? "low"
        : "medium";
    const target = Math.max(500, Math.round(Math.max(wordCount || 200, 200) * 2));

    const data = {
      proposalType,
      changeType: proposalType === "new-content" ? "new_article" : "update",
      articleHandle: articleHandle ?? null,
      priority,
      impact,
      effort,
      title: proposalTitle,
      description:
        proposalType === "seo-fix"
          ? `Rewrite meta title and description for "${title}" targeting "${gap.query}" (${impressions ?? 0} impressions, avg position ${position ?? "—"}).`
          : mapRefresh
            ? `Refresh "${title}" according to the active map decision "${mapDecision}" using only the attached current evidence.`
          : proposalType === "content-refresh"
            ? `Expand "${title}" from ${wordCount || "few"} words to ${target}+ words to improve SEO.`
            : `Net-new article targeting the search query "${gap.query}" (${impressions ?? 0} impressions, avg position ${position ?? "—"}).`,
      proposedState:
        proposalType === "seo-fix"
          ? { articleHandle, articleTitle: title, targetQuery: gap.query, issue: gap.issue ?? gap.type ?? "serp-snippet" }
          : mapRefresh
            ? { action: "refresh", articleHandle, articleTitle: title, targetUrl, mapDecision, mapEvidence, priority: gap.priority, observedEvidence: gap.observedEvidence }
          : proposalType === "content-refresh"
            ? { action: "expand", articleHandle, articleTitle: title, currentWordCount: wordCount, targetWordCount: target, issue: gap.issue }
            : {
                title,
                targetQuery: gap.query,
                targetKeyword: gap.query,
                seoKeywords: allQueries
                  .filter(q => q.query !== gap.query && gap.query.split(" ").some(w => w.length > 3 && q.query.includes(w)))
                  .slice(0, 8)
                  .map(q => q.query),
                gscPosition: position ?? null,
                gscImpressions: impressions ?? 0,
              },
      sourceData: { source: "seo-pilot", query: gap.query, impressions: impressions ?? 0, position: position ?? null, issue: gap.issue ?? null, page: gap.page ?? null, strategyVersionId, packageSha256, ruleIds: governedRuleIds[gapIndex]!, ...(mapRefresh ? { mapDecision, mapEvidence, priority: gap.priority, observedEvidence: gap.observedEvidence } : {}) },
    };
    const keyed = withContentProposalDedupeKey(data as any);
    if (seenInBatch.has(keyed.dedupeKey)) {
      skipped++; skippedReasons.duplicate++;
    } else {
      seenInBatch.add(keyed.dedupeKey);
      rows.push({
        data,
        candidate: proposalType === "new-content"
          ? { type: "content", action: "create", targetUrl }
          : proposalType === "seo-fix"
            ? { type: "seo_metadata", targetUrl }
            : { type: "content", action: "update", targetUrl },
      });
    }
    }

    if (rows.length === 0) return [];

    const results = [];
    for (const r of rows) {
      const result = await createGovernedContentProposalInTransaction(tx as never, { ...r, expectedStrategy: { versionId: strategyVersionId, packageSha256 } } as never);
      if (result.created) results.push(result.proposal); else skipped++;
    }
    return results;
  });
  } catch (error) {
    if (error instanceof StrategyChangedError) return NextResponse.json({ error: "Active strategy changed", code: "STRATEGY_CHANGED" }, { status: 409 });
    throw error;
  }

  if (created.length === 0) {
    return NextResponse.json({ created: 0, skipped, skippedReasons, proposals: [] });
  }

  try {
    const actor = (await getSessionUser(req)) ?? "operator";
    await prisma.auditLog.create({
      data: {
        actor,
        action: "seo_gap_promoted",
        entityType: "ContentProposal",
        entityId: created.map((p) => p!.id).join(","),
        meta: { created: created.length, skipped, skippedReasons },
      },
    });
  } catch { /* audit log is best-effort */ }

  return NextResponse.json({
    created: created.length,
    skipped,
    skippedReasons,
    proposals: created.map((p) => ({ id: p!.id, title: p!.title })),
  });
}
