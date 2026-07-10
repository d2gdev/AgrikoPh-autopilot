export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createContentProposalOnce } from "@/lib/content-pilot/create-proposal";
import { requireAppAuth, getSessionShop, getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { classifyPriority, findingToImpact, changeTypeToEffort } from "@/lib/content-pilot/priority-score";
import { getLatestGscData } from "@/lib/seo/data";
import { withContentProposalDedupeKey } from "@/lib/content-pilot/create-proposal";
import { articleHandleFromBlogPage, classifySeoPromotion } from "@/lib/seo/promotion";

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
});
const PromoteGapsBodySchema = z.object({
  gaps: z.array(GapInputSchema).min(1).max(50),
});

function normalizeHandle(handle: string | null | undefined): string | null {
  return handle ? handle.toLowerCase() : null;
}

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`seo-promote:${actor}`, 10, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 10 promotions per minute" }, { status: 429 });
  }

  const parsed = PromoteGapsBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { gaps } = parsed.data;

  // Pull GSC keyword context to enrich proposals
  const gscData = await getLatestGscData();
  const allQueries = gscData.queries;
  const knownQueries = new Map(allQueries.map((q) => [q.query.toLowerCase(), q]));

  let skipped = 0;

  // Candidate titles/handles from the input (deduped, valid gaps only).
  const candidateTitles = Array.from(new Set(gaps.map((g) => g.suggestedTitle)));
  const gapHandles = gaps.map((g) => g.articleHandle ?? articleHandleFromBlogPage(g.page)).filter((h): h is string => Boolean(h));
  const candidateHandles = Array.from(new Set(gapHandles));
  const skippedReasons = { duplicate: 0, missingArticle: 0, nonBlogExistingPage: 0 };

  const created = await prisma.$transaction(async (tx) => {
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
    const rows: Array<Record<string, unknown>> = [];

    for (const gap of gaps) {
      const knownQuery = knownQueries.get(gap.query.toLowerCase());
      const impressions = gap.impressions ?? knownQuery?.impressions ?? 0;
      const position = gap.position ?? (knownQuery ? Number(knownQuery.position) : undefined);
      const inputTitle = gap.suggestedTitle;
      const requestedHandle = gap.articleHandle ?? articleHandleFromBlogPage(gap.page);
      const matchedArticle =
        (requestedHandle ? articleByHandle.get(requestedHandle.toLowerCase()) : undefined) ??
        articleByTitle.get(inputTitle.toLowerCase());
      const decision = classifySeoPromotion({
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
      const title = matchedArticle?.title ?? inputTitle;
      const wordCount = matchedArticle?.wordCount ?? gap.wordCount ?? 0;
      const proposalTitle =
        proposalType === "seo-fix"
          ? `Improve SERP snippet: ${title}`
          : proposalType === "content-refresh"
            ? `Expand thin content: ${title}`
            : title;
    const score = Math.min(
      100,
      Math.round((impressions ?? 0) / 20) +
        (position && position <= 10 ? 20 : position && position <= 20 ? 10 : 0)
    );
    const priority = classifyPriority(score);
    const impact = findingToImpact(score);
    const effort = proposalType === "new-content"
      ? changeTypeToEffort("new_article")
      : proposalType === "seo-fix"
        ? "low"
        : "medium";
    const target = Math.max(500, Math.round(Math.max(wordCount || gap.wordCount || 200, 200) * 2));

    rows.push({
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
          : proposalType === "content-refresh"
            ? `Expand "${title}" from ${gap.wordCount ?? "few"} words to ${target}+ words to improve SEO.`
            : `Net-new article targeting the search query "${gap.query}" (${impressions ?? 0} impressions, avg position ${position ?? "—"}).`,
      proposedState:
        proposalType === "seo-fix"
          ? { articleHandle, articleTitle: title, targetQuery: gap.query, issue: gap.issue ?? gap.type ?? "serp-snippet" }
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
      sourceData: { source: "seo-pilot", query: gap.query, impressions: impressions ?? 0, position: position ?? null, issue: gap.issue ?? null, page: gap.page ?? null },
    });
    const keyed = withContentProposalDedupeKey(rows[rows.length - 1] as any);
    if (seenInBatch.has(keyed.dedupeKey)) {
      rows.pop(); skipped++; skippedReasons.duplicate++;
    } else seenInBatch.add(keyed.dedupeKey);
    }

    if (rows.length === 0) return [];

    const results = [];
    for (const r of rows) {
      const result = await createContentProposalOnce(tx, r as never);
      if (result.created) results.push(result.proposal); else skipped++;
    }
    return results;
  });

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
        entityId: created.map((p) => p.id).join(","),
        meta: { created: created.length, skipped, skippedReasons },
      },
    });
  } catch { /* audit log is best-effort */ }

  return NextResponse.json({
    created: created.length,
    skipped,
    skippedReasons,
    proposals: created.map((p) => ({ id: p.id, title: p.title })),
  });
}
