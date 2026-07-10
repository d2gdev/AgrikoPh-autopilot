import { hasMissingMeta } from "@/lib/seo/meta";
import type { GscQueryPageRow, GscQueryRow } from "@/lib/seo/types";

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "how", "why",
  "what", "which", "where", "when", "does", "can", "its",
]);

export interface SeoAnalysisLimits {
  queriesTotal: number;
  queriesAnalyzed: number;
  articlesTotalLowerBound: number;
  articlesAnalyzed: number;
  articlesTruncated: boolean;
}

export interface SeoAnalysisArticle {
  handle: string;
  title: string;
  wordCount: number | null;
  internalLinkCount: number | null;
  seoData: unknown;
}

export interface ProgrammaticSeoGap {
  query: string;
  impressions: number;
  position: number;
  suggestedTitle: string;
  issue?: "missing-meta" | "thin-content";
  articleHandle?: string;
  wordCount?: number | null;
}

function articleHandleFromBlogPage(page: string | undefined): string | null {
  if (!page) return null;
  let path = page;
  try {
    path = new URL(page).pathname;
  } catch {
    path = page.split(/[?#]/)[0] ?? page;
  }
  const parts = path.split("/").filter(Boolean);
  const blogIndex = parts.findIndex((part) => part === "blogs");
  const handle = blogIndex >= 0 ? parts[blogIndex + 2] : null;
  return handle && /^[a-z0-9][a-z0-9_-]*$/i.test(handle) ? handle.toLowerCase() : null;
}

function meaningfulTerms(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((term) => term.length > 3 && !STOP_WORDS.has(term));
}

function titleCoversQuery(title: string, query: string): boolean {
  const queryTerms = meaningfulTerms(query);
  if (queryTerms.length === 0) return false;
  const titleTerms = new Set(meaningfulTerms(title));
  const matchCount = queryTerms.filter((term) => titleTerms.has(term)).length;
  return queryTerms.length <= 2
    ? matchCount >= queryTerms.length
    : matchCount >= Math.ceil(queryTerms.length * 0.5) && matchCount >= 2;
}

const gapKey = (gap: ProgrammaticSeoGap) =>
  gap.articleHandle
    ? `${gap.issue ?? "article"}:${gap.articleHandle.toLowerCase()}`
    : `new-content:${gap.query.trim().toLowerCase()}`;

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const keys = new Set<string>();
  return items.filter((item) => {
    const itemKey = key(item);
    if (keys.has(itemKey)) return false;
    keys.add(itemKey);
    return true;
  });
}

export function buildProgrammaticSeoGaps(input: {
  queries: GscQueryRow[];
  queryPagePairs: GscQueryPageRow[];
  articles: SeoAnalysisArticle[];
  queryLimit?: number;
}): ProgrammaticSeoGap[] {
  const articleHandles = new Set(input.articles.map((article) => article.handle.toLowerCase()));
  const coveredQueries = new Set<string>();
  for (const pair of input.queryPagePairs) {
    const handle = articleHandleFromBlogPage(pair.page);
    if (handle && articleHandles.has(handle)) coveredQueries.add(pair.query.toLowerCase());
  }

  const queries = input.queries
    .filter((query) => {
      const position = parseFloat(query.position);
      return position >= 5 && position <= 20 &&
        !coveredQueries.has(query.query.toLowerCase()) &&
        !input.articles.some((article) => titleCoversQuery(article.title, query.query));
    })
    .sort((a, b) =>
      b.impressions - a.impressions ||
      a.clicks - b.clicks ||
      parseFloat(a.position) - parseFloat(b.position) ||
      a.query.localeCompare(b.query)
    )
    .slice(0, input.queryLimit ?? 30);

  const gaps: ProgrammaticSeoGap[] = [];
  for (const query of queries) {
    const position = parseFloat(query.position);
    const title = query.query.charAt(0).toUpperCase() + query.query.slice(1);
    gaps.push({
      query: query.query,
      impressions: query.impressions,
      position,
      suggestedTitle: `${title}: Benefits, Uses & Complete Guide`,
    });
  }

  for (const article of input.articles.filter((item) => (item.wordCount ?? 0) < 300).slice(0, 5)) {
    gaps.push({
      query: article.title.toLowerCase(),
      impressions: 0,
      position: 0,
      suggestedTitle: article.title,
      issue: "thin-content",
      articleHandle: article.handle,
      wordCount: article.wordCount,
    });
  }

  for (const article of input.articles.filter((item) => hasMissingMeta(item.seoData)).slice(0, 5)) {
    gaps.push({
      query: article.title.toLowerCase(),
      impressions: 0,
      position: 0,
      suggestedTitle: article.title,
      issue: "missing-meta",
      articleHandle: article.handle,
      wordCount: article.wordCount,
    });
  }

  return uniqueBy(gaps, gapKey);
}
