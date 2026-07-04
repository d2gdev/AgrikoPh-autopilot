import type { PrismaClient } from "@prisma/client";
import {
  scoreFinding,
  classifyPriority,
  findingToImpact,
  changeTypeToEffort,
  type ContentFinding,
} from "./priority-score";
import {
  getGscQueriesForWindow,
  getGscQueryPagePairsForWindow,
  getLatestGscWindow,
} from "@/lib/seo/gsc-normalized";

export interface ProposalInput {
  articleHandle: string | null;
  proposalType: string;
  changeType: string;
  priority: string;
  impact: string;
  effort: string;
  title: string;
  description: string;
  proposedState: Record<string, unknown>;
  sourceData: Record<string, unknown>;
  priorityScore: number;
}

function trafficBucket(impressions: number): number {
  if (impressions >= 5000) return 40;
  if (impressions >= 2500) return 32;
  if (impressions >= 1000) return 24;
  if (impressions >= 250) return 14;
  return 8;
}

function toProposal(finding: ContentFinding): ProposalInput {
  const score = scoreFinding(finding);
  const priority = classifyPriority(score);
  return {
    articleHandle: finding.articleHandle ?? null,
    proposalType:
      finding.type === "orphan-link"
        ? "internal-link"
      : finding.type === "new-content-gap"
        ? "new-content"
      : finding.type === "thin-content" || finding.type === "stale-content"
        ? "content-refresh"
      : "seo-fix",
    changeType: finding.changeType,
    priority,
    impact: findingToImpact(score),
    effort: changeTypeToEffort(finding.changeType),
    title: finding.title,
    description: finding.description,
    proposedState: finding.proposedState,
    sourceData: finding.evidence,
    priorityScore: score,
  };
}

const CTR_BY_POSITION: Record<number, number> = {
  1: 0.28,
  2: 0.15,
  3: 0.10,
  5: 0.06,
  10: 0.035,
  20: 0.018,
};

function expectedCtr(pos: number): number {
  const bracket = [1, 2, 3, 5, 10, 20].find((b) => pos <= b) ?? 20;
  return CTR_BY_POSITION[bracket] ?? 0.008;
}

// Stop-words to exclude when matching query terms against a target keyword.
const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "are", "was", "how", "why", "what", "which", "where", "when", "does", "can", "its"]);
const BROAD_TOPICS = new Set(["cooking", "nutrition", "philippine-culture", "organic-farming"]);

type ProposalArticle = {
  handle: string;
  title: string;
  wordCount: number;
  inboundCount: number;
  internalLinkCount: number;
  seoData: unknown;
  topicsData: unknown;
};

function topicEntries(topicsData: unknown): Array<{ topic: string; confidence: number }> {
  return Array.isArray(topicsData)
    ? topicsData
        .map((entry) => {
          const topic = typeof entry?.topic === "string" ? entry.topic : "";
          const confidence = typeof entry?.confidence === "number" ? entry.confidence : 0;
          return { topic, confidence };
        })
        .filter((entry) => entry.topic && entry.confidence >= 0.15)
    : [];
}

function meaningfulTerms(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((term) => term.length > 3 && !STOP_WORDS.has(term))
  );
}

function sourceScore(source: ProposalArticle, target: ProposalArticle): number {
  if (source.handle === target.handle) return Number.NEGATIVE_INFINITY;

  const sourceTopics = topicEntries(source.topicsData);
  const targetTopics = topicEntries(target.topicsData);
  const sourceTopicMap = new Map(sourceTopics.map((entry) => [entry.topic, entry.confidence]));

  let score = 0;
  let specificOverlap = 0;
  for (const targetTopic of targetTopics) {
    const sourceConfidence = sourceTopicMap.get(targetTopic.topic);
    if (sourceConfidence == null) continue;

    const topicScore = Math.min(targetTopic.confidence, sourceConfidence) * 30;
    if (BROAD_TOPICS.has(targetTopic.topic)) {
      score += topicScore * 0.25;
    } else {
      score += topicScore;
      specificOverlap++;
    }
  }

  const sourceTerms = meaningfulTerms(`${source.title} ${source.handle}`);
  const targetTerms = meaningfulTerms(`${target.title} ${target.handle}`);
  let termOverlap = 0;
  for (const term of targetTerms) {
    if (sourceTerms.has(term)) termOverlap++;
  }
  score += termOverlap * 6;

  const targetLooksLikeRecipe = targetTerms.has("recipe") || targetTerms.has("recipes");
  const sourceLooksLikeRecipe = sourceTerms.has("recipe") || sourceTerms.has("recipes");
  if (targetLooksLikeRecipe && sourceLooksLikeRecipe) score += 4;

  score += Math.min(source.inboundCount ?? 0, 10) * 3;
  score += Math.min(source.internalLinkCount ?? 0, 10) * 0.75;
  score += Math.min(Math.max((source.wordCount ?? 0) - 600, 0) / 400, 5);

  if (specificOverlap === 0 && termOverlap === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return score;
}

function findBestLinkSource(
  articles: ProposalArticle[],
  target: ProposalArticle
): ProposalArticle | null {
  const ranked = articles
    .map((source) => ({ source, score: sourceScore(source, target) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  return best && best.score >= 8 ? best.source : null;
}

// Find supporting keywords for a target keyword from global GSC queries.
// Matches queries that share ≥1 meaningful word (>3 chars, not a stop-word) with the target.
// Excludes branded queries ("agriko") and single-word queries.
// Returns up to 4 supporting keywords sorted by impressions desc.
function findSupportingKeywords(
  targetKeyword: string,
  gscQueries: Array<{ query: string; impressions: number; clicks: number; position: number }>
): string[] {
  const targetWords = new Set(
    targetKeyword.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  );
  if (targetWords.size === 0) return [];

  return gscQueries
    .filter((q) => {
      if (q.query === targetKeyword) return false;
      if (q.query.includes("agriko")) return false;
      if (q.query.split(/\s+/).length < 2) return false;
      const qWords = q.query.toLowerCase().split(/\s+/);
      return qWords.some((w) => w.length > 3 && !STOP_WORDS.has(w) && targetWords.has(w));
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 4)
    .map((q) => q.query);
}

// Build a map of article handle → ranked keyword list from the gsc_query_page snapshot.
// GSC page values are full URLs (https://domain.com/blogs/news/handle) so we extract
// the final path segment to match against article handles.
function buildKeywordMap(
  pairs: Array<{ query: string; page: string; impressions: number; clicks: number; position: string }>
): Map<string, { targetKeyword: string; supportingKeywords: string[] }> {
  const byHandle = new Map<string, typeof pairs>();

  for (const pair of pairs) {
    // Extract handle from URL: last non-empty path segment.
    const handle = pair.page.split("/").filter(Boolean).pop() ?? "";
    if (!handle) continue;
    if (!byHandle.has(handle)) byHandle.set(handle, []);
    byHandle.get(handle)!.push(pair);
  }

  const result = new Map<string, { targetKeyword: string; supportingKeywords: string[] }>();
  for (const [handle, rows] of byHandle) {
    // Sort by impressions desc — highest-volume query is the primary target.
    const sorted = [...rows].sort((a, b) => (b.impressions as number) - (a.impressions as number));
    const [primary, ...rest] = sorted;
    if (!primary) continue;
    result.set(handle, {
      targetKeyword: primary.query,
      // Up to 4 supporting keywords; skip branded/single-word queries and the primary itself.
      supportingKeywords: rest
        .filter((r) => r.query !== primary.query && r.query.split(" ").length > 1)
        .slice(0, 4)
        .map((r) => r.query),
    });
  }
  return result;
}

const MAX_COMPETITOR_SEEDS_TOTAL = 6;
const MAX_TESTS_PER_COMPETITOR = 2;

// Builds "counter-angle" ContentProposal seeds from the latest competitor-analysis
// SkillInsight. Runs inside generateProposals (not a standalone producer) because the
// daily cron wipes all pending proposals and regenerates from this function nightly —
// a standalone producer's rows would be lost within 24h.
function competitorFindings(insight: { id: string; items: unknown } | null): ProposalInput[] {
  if (!insight) return [];
  const items = Array.isArray(insight.items) ? insight.items : [];
  const proposals: ProposalInput[] = [];

  for (const raw of items) {
    if (proposals.length >= MAX_COMPETITOR_SEEDS_TOTAL) break;
    if (raw === null || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;

    const competitor = typeof item.competitor === "string" && item.competitor ? item.competitor : null;
    if (!competitor) continue;

    const gaps = Array.isArray(item.gaps)
      ? item.gaps.filter((g): g is string => typeof g === "string" && g.length > 0)
      : [];
    const recommendedTests = Array.isArray(item.recommendedTests)
      ? item.recommendedTests.filter((t): t is string => typeof t === "string" && t.length > 0)
      : [];

    for (const test of recommendedTests.slice(0, MAX_TESTS_PER_COMPETITOR)) {
      if (proposals.length >= MAX_COMPETITOR_SEEDS_TOTAL) break;

      const finding: ContentFinding = {
        type: "new-content-gap",
        trafficScore: 20,
        businessValue: 20,
        severity: "medium",
        confidence: 0.75,
        risk: "low",
        changeType: "new_article",
        title: `Counter-angle: ${test}`.slice(0, 240),
        description:
          `Competitor ${competitor} is testing this angle` +
          (gaps.length > 0 ? ` while leaving gaps: ${gaps.join("; ")}.` : ".") +
          ` Ship a counter-angle article before they own the search intent.`,
        evidence: { insightId: insight.id, competitor, gaps },
        proposedState: { targetKeyword: test, angle: test, competitor },
      };

      const score = scoreFinding(finding);
      proposals.push({
        articleHandle: null,
        proposalType: "new-content",
        changeType: "new_article",
        priority: "medium",
        impact: findingToImpact(score),
        effort: changeTypeToEffort(finding.changeType),
        title: finding.title,
        description: finding.description,
        proposedState: finding.proposedState,
        sourceData: finding.evidence,
        priorityScore: score,
      });
    }
  }

  return proposals;
}

const MAX_KEYWORD_GAP_SEEDS = 6;

type MarketInsightRow = {
  id: string;
  competitorId: string | null;
  evidence: unknown;
};

// Builds new-content ContentProposal seeds from open keyword_gap MarketInsights
// (produced by jobs/fetch-market-intel.ts from DataForSEO Labs domain-intersection
// data — competitor organic rankings, unrelated to Google Ads Keyword Planner).
// Runs inside generateProposals for the same reason as competitorFindings: the
// nightly cron wipes and regenerates all pending proposals from this function.
function keywordGapFindings(insights: MarketInsightRow[]): ProposalInput[] {
  const proposals: ProposalInput[] = [];

  for (const insight of insights) {
    if (proposals.length >= MAX_KEYWORD_GAP_SEEDS) break;
    if (insight === null || typeof insight !== "object") continue;
    const evidence = insight.evidence;
    if (evidence === null || typeof evidence !== "object") continue;
    const ev = evidence as Record<string, unknown>;

    const keyword = typeof ev.keyword === "string" && ev.keyword ? ev.keyword : null;
    const competitorDomain =
      typeof ev.competitorDomain === "string" && ev.competitorDomain ? ev.competitorDomain : null;
    const competitorPosition = typeof ev.competitorPosition === "number" ? ev.competitorPosition : null;
    const searchVolume = typeof ev.searchVolume === "number" ? ev.searchVolume : null;

    if (!keyword || !competitorDomain || competitorPosition == null || searchVolume == null) continue;

    const priority = searchVolume >= 1000 ? "high" : "medium";
    const title = `Keyword gap: "${keyword}" (${competitorDomain} ranks #${competitorPosition})`.slice(0, 240);
    const angle = `${competitorDomain} ranks #${competitorPosition} for "${keyword}" (~${searchVolume}/mo searches) and we don't appear at all — a dedicated article targeting this keyword can capture the gap.`;

    const finding: ContentFinding = {
      type: "new-content-gap",
      trafficScore: trafficBucket(searchVolume),
      businessValue: 18,
      severity: "medium",
      confidence: 0.75,
      risk: "low",
      changeType: "new_article",
      title,
      description: angle,
      evidence: { marketInsightId: insight.id, keyword, competitorDomain, competitorPosition, searchVolume },
      proposedState: { targetKeyword: keyword, angle, competitorDomain, searchVolume },
    };

    const score = scoreFinding(finding);
    proposals.push({
      articleHandle: null,
      proposalType: "new-content",
      changeType: "new_article",
      priority,
      impact: findingToImpact(score),
      effort: changeTypeToEffort(finding.changeType),
      title: finding.title,
      description: finding.description,
      proposedState: finding.proposedState,
      sourceData: {
        marketInsightId: insight.id,
        competitorId: insight.competitorId ?? null,
        evidence: { keyword, competitorDomain, competitorPosition, searchVolume },
      },
      priorityScore: score,
    });
  }

  return proposals;
}

function articleHandleFromPage(page: string): string {
  return page.split(/[?#]/)[0]?.split("/").filter(Boolean).pop() ?? "";
}

function buildQueryLandingMap(
  pairs: Array<{ query: string; page: string; impressions: number; clicks: number; position: string }>,
  validHandles: Set<string>
): Map<string, { handle: string; page: string }> {
  const bestByQuery = new Map<string, { handle: string; page: string; impressions: number; clicks: number }>();

  for (const pair of pairs) {
    const handle = articleHandleFromPage(pair.page);
    if (!pair.query || !handle || !validHandles.has(handle)) continue;

    const current = bestByQuery.get(pair.query);
    if (
      !current ||
      pair.impressions > current.impressions ||
      (pair.impressions === current.impressions && pair.clicks > current.clicks)
    ) {
      bestByQuery.set(pair.query, {
        handle,
        page: pair.page,
        impressions: pair.impressions,
        clicks: pair.clicks,
      });
    }
  }

  return new Map(
    [...bestByQuery.entries()].map(([query, value]) => [
      query,
      { handle: value.handle, page: value.page },
    ])
  );
}

export async function generateProposals(prismaClient: PrismaClient): Promise<ProposalInput[]> {
  const [articles, latestGscWindow, gscSnap, gscQueryPageSnap, competitorInsight, keywordGapInsights] = await Promise.all([
    prismaClient.articleRecord.findMany({
      select: {
        handle: true,
        title: true,
        publishedAt: true,
        wordCount: true,
        inboundCount: true,
        internalLinkCount: true,
        seoData: true,
        topicsData: true,
      },
      orderBy: { indexedAt: "desc" },
      take: 200,
    }),
    getLatestGscWindow(prismaClient),
    prismaClient.rawSnapshot.findFirst({ where: { source: "gsc" }, orderBy: { fetchedAt: "desc" } }),
    prismaClient.rawSnapshot.findFirst({ where: { source: "gsc_query_page" }, orderBy: { fetchedAt: "desc" } }),
    prismaClient.skillInsight.findFirst({
      where: { insightType: "competitor-analysis" },
      orderBy: { createdAt: "desc" },
    }),
    prismaClient.marketInsight.findMany({
      where: { type: "keyword_gap", status: "open" },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  // GSC connector stores position as a string (e.g. "11.4") — normalise to number here.
  let gscQueries: Array<{ query: string; clicks: number; impressions: number; position: number }> =
    (((gscSnap?.payload as Record<string, unknown>)?.topQueries as Array<{
      query: string;
      clicks: number;
      impressions: number;
      position: number | string;
    }>) ?? []).map((q) => ({ ...q, position: parseFloat(String(q.position)) }));

  // Per-article keyword map derived from real GSC (query, page) pairs.
  let queryPagePairs =
    ((gscQueryPageSnap?.payload as Record<string, unknown>)?.pairs as Array<{
      query: string; page: string; impressions: number; clicks: number; position: string;
    }>) ?? [];

  if (latestGscWindow) {
    const [normalizedQueries, normalizedPairs] = await Promise.all([
      getGscQueriesForWindow(latestGscWindow, prismaClient),
      getGscQueryPagePairsForWindow(latestGscWindow, prismaClient),
    ]);
    gscQueries = normalizedQueries.map((q) => ({
      query: q.query,
      clicks: q.clicks,
      impressions: q.impressions,
      position: parseFloat(q.position),
    }));
    queryPagePairs = normalizedPairs;
  }

  const keywordMap = buildKeywordMap(queryPagePairs);
  const articlesByHandle = new Map(articles.map((article) => [article.handle, article]));
  const queryLandingMap = buildQueryLandingMap(queryPagePairs, new Set(articlesByHandle.keys()));

  const competitorProposals = competitorFindings(competitorInsight);
  const keywordGapProposals = keywordGapFindings(keywordGapInsights);

  if (
    articles.length === 0 &&
    gscQueries.length === 0 &&
    competitorProposals.length === 0 &&
    keywordGapProposals.length === 0
  ) {
    return [];
  }

  const findings: ContentFinding[] = [];
  const now = Date.now();
  const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;

  for (const article of articles) {
    const seo = article.seoData as { score?: number; issues?: string[] } | null;
    const seoScore = seo?.score ?? 0;
    const issues = seo?.issues ?? [];

    if (issues.includes("missing-meta-description")) {
      findings.push({
        type: "missing-meta",
        articleHandle: article.handle,
        articleTitle: article.title,
        trafficScore: 14,
        businessValue: 10,
        severity: "medium",
        confidence: 0.90,
        risk: "low",
        changeType: "metadata",
        title: `Add meta description — "${article.title}"`,
        description: `This article is missing a meta description, which reduces CTR in search results. Adding one targeting the primary keyword can lift clicks without changing rankings.`,
        evidence: { handle: article.handle, seoScore, issues },
        proposedState: { field: "metaDescription", currentValue: null, suggestedValue: "__AI_GENERATED__" },
      });
    }

    if (article.inboundCount === 0 && articles.length > 1) {
      const linkSource = findBestLinkSource(articles, article);
      findings.push({
        type: "orphan-link",
        articleHandle: article.handle,
        articleTitle: article.title,
        trafficScore: 14,
        businessValue: 15,
        severity: "medium",
        confidence: 0.80,
        risk: "low",
        changeType: "internal_link",
        title: `Add inbound link to "${article.title}"`,
        description: `This article has no inbound internal links, reducing its crawl priority and PageRank. Adding a contextual link from a related article can improve discoverability.`,
        evidence: { handle: article.handle, inboundCount: 0, suggestedSource: linkSource?.handle ?? null },
        proposedState: {
          fromArticle: linkSource?.handle ?? "find a topically related article",
          toArticle: article.handle,
          suggestedAnchorText: article.title.split(" ").slice(0, 4).join(" ").toLowerCase(),
        },
      });
    }

    if (typeof article.wordCount === "number" && article.wordCount < 600 && seoScore < 80) {
      findings.push({
        type: "thin-content",
        articleHandle: article.handle,
        articleTitle: article.title,
        trafficScore: 8,
        businessValue: 12,
        severity: "medium",
        confidence: 0.85,
        risk: "medium",
        changeType: "content",
        title: `Expand thin content — "${article.title}"`,
        description: `At ${article.wordCount} words, this article is too thin to compete for informational keywords. Expanding to 1,000+ words with additional H2 sections will improve SEO score and topical depth.`,
        evidence: { handle: article.handle, wordCount: article.wordCount, seoScore },
        proposedState: {
          targetWordCount: 1000,
          currentWordCount: article.wordCount,
          ...keywordMap.get(article.handle),
        },
      });
    }

    if (
      article.publishedAt &&
      now - new Date(article.publishedAt as Date).getTime() > ONE_YEAR
    ) {
      findings.push({
        type: "stale-content",
        articleHandle: article.handle,
        articleTitle: article.title,
        trafficScore: 8,
        businessValue: 8,
        severity: "low",
        confidence: 0.70,
        risk: "low",
        changeType: "content",
        title: `Refresh stale article — "${article.title}"`,
        description: `Published over a year ago. Refreshing the date, updating statistics, and expanding with new sections signals freshness to Google and can recover ranking positions.`,
        evidence: { handle: article.handle, publishedAt: article.publishedAt, seoScore },
        proposedState: {
          action: "refresh-date-and-expand",
          currentPublishedAt: article.publishedAt,
          ...keywordMap.get(article.handle),
        },
      });
    }
  }

  const existingTitlesLower = articles.map((a) => a.title.toLowerCase());

  for (const q of gscQueries) {
    if (q.position < 5 || q.position > 20 || q.impressions < 5) continue;
    const expected = expectedCtr(q.position);
    const actualCtr = q.clicks / Math.max(q.impressions, 1);
    if (actualCtr >= expected * 0.8) continue;
    const landing = queryLandingMap.get(q.query);
    if (!landing) continue;
    const article = articlesByHandle.get(landing.handle);

    findings.push({
      type: "gsc-quick-win",
      articleHandle: landing.handle,
      articleTitle: article?.title,
      trafficScore: trafficBucket(q.impressions),
      businessValue: 20,
      severity: "high",
      confidence: 0.85,
      risk: "low",
      changeType: "metadata",
      title: `GSC quick win — optimise for "${q.query}"`,
      description: `Ranking position ${q.position.toFixed(1)} with ${q.impressions} impressions but only ${q.clicks} clicks (CTR ${(actualCtr * 100).toFixed(1)}% vs expected ${(expected * 100).toFixed(1)}%). A title/meta rewrite targeting this query could reach page 1.`,
      evidence: {
        query: q.query,
        page: landing.page,
        handle: landing.handle,
        position: q.position,
        impressions: q.impressions,
        clicks: q.clicks,
        ctrGap: expected - actualCtr,
      },
      proposedState: {
        targetQuery: q.query,
        suggestedTitleSuffix: `— ${q.query}`,
        action: "rewrite-title-and-meta",
        articleHandle: landing.handle,
      },
    });
  }

  for (const q of gscQueries) {
    if (q.position <= 20 || q.impressions < 5) continue;
    const words = q.query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    // "covered" requires majority overlap — a single shared word (e.g. "rice") is not enough.
    // Require that ≥50% of the query's meaningful words appear in the same article title,
    // with a minimum of 2 matching words when the query has 3+ meaningful words.
    const covered = words.length === 0 ? false : existingTitlesLower.some((t) => {
      const matchCount = words.filter((w) => t.includes(w)).length;
      return words.length <= 2 ? matchCount >= words.length : matchCount >= Math.ceil(words.length * 0.5) && matchCount >= 2;
    });
    if (covered) continue;

    findings.push({
      type: "new-content-gap",
      trafficScore: trafficBucket(q.impressions),
      businessValue: 18,
      severity: "medium",
      confidence: 0.75,
      risk: "low",
      changeType: "new_article",
      title: `New article opportunity — "${q.query}"`,
      description: `${q.impressions} impressions with no matching article. Creating a dedicated 1,200-word guide targeting this keyword could capture traffic currently going elsewhere.`,
      evidence: { query: q.query, impressions: q.impressions, clicks: q.clicks, position: q.position },
      proposedState: {
        suggestedTitle: `${q.query.charAt(0).toUpperCase() + q.query.slice(1)}: Complete Guide`,
        targetKeyword: q.query,
        supportingKeywords: findSupportingKeywords(q.query, gscQueries),
        idealWordCount: 1200,
      },
    });
  }

  const scored = [
    ...findings.map((f) => toProposal(f)),
    ...competitorProposals,
    ...keywordGapProposals,
  ].sort((a, b) => b.priorityScore - a.priorityScore);

  const seen = new Set<string>();
  const deduped: ProposalInput[] = [];
  for (const proposal of scored) {
    // For handle-less proposals (e.g. new-content gaps) the articleHandle is null,
    // so keying on handle+type alone collapses every gap into one bucket. Add a
    // discriminator (target keyword / title) so distinct gaps survive dedup.
    const discriminator =
      proposal.articleHandle == null
        ? `::${String((proposal.proposedState as { targetKeyword?: unknown }).targetKeyword ?? proposal.title)}`
        : "";
    const key = `${proposal.articleHandle ?? "new"}::${proposal.proposalType}${discriminator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(proposal);
  }

  return deduped;
}
