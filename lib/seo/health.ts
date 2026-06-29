export interface ArticleHealthInput {
  handle: string;
  title: string;
  wordCount: number;
  internalLinkCount: number;
  headingCount: number;
  inboundCount: number;
  seoData: unknown;
}

export interface OnPageHealthResult {
  totals: {
    total: number;
    missingMeta: number;
    thinContent: number;
    noInternalLinks: number;
    lowHeadings: number;
    orphan: number;
    // B4 — concrete on-page checks
    titleLengthOff: number;
    descLengthOff: number;
    missingDesc: number;
    missingH1: number;
    duplicateTitle: number;
  };
  worstOffenders: Array<{
    handle: string;
    title: string;
    wordCount: number;
    issues: string[];
  }>;
}

// Permissive view of what blog-seo's SeoAnalysis JSON may contain.
interface SeoDataLike {
  issues?: unknown;
  titleLength?: unknown;
  descLength?: unknown;
  seoTitle?: unknown;
  seoDescription?: unknown;
  metaTitle?: unknown;
  metaDescription?: unknown;
}

interface MetaSignals {
  missingTitle: boolean;
  missingDesc: boolean;
  // Resolved lengths (null when unknown / not derivable from the record).
  titleLength: number | null;
  descLength: number | null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function deriveMetaIssues(seoData: unknown): MetaSignals {
  if (!seoData || typeof seoData !== "object") {
    return { missingTitle: false, missingDesc: false, titleLength: null, descLength: null };
  }
  const d = seoData as SeoDataLike;
  let missingTitle = false;
  let missingDesc = false;

  // blog-seo emits an `issues` array of string codes.
  if (Array.isArray(d.issues)) {
    const codes = d.issues.map((i) => String(i));
    if (codes.includes("missing-meta-title") || codes.includes("missing-title")) missingTitle = true;
    if (codes.includes("missing-meta-description")) missingDesc = true;
  }

  // Fall back to direct length / string fields when present.
  if (typeof d.titleLength === "number" && d.titleLength === 0) missingTitle = true;
  if (typeof d.descLength === "number" && d.descLength === 0) missingDesc = true;
  if (d.seoTitle === "" || d.metaTitle === "") missingTitle = true;
  if (d.seoDescription === "" || d.metaDescription === "") missingDesc = true;

  // Resolve lengths: prefer explicit *Length fields, else measure the string.
  const titleStr = strOrNull(d.seoTitle) ?? strOrNull(d.metaTitle);
  const descStr = strOrNull(d.seoDescription) ?? strOrNull(d.metaDescription);
  const titleLength =
    typeof d.titleLength === "number"
      ? d.titleLength
      : titleStr !== null
        ? titleStr.length
        : null;
  const descLength =
    typeof d.descLength === "number"
      ? d.descLength
      : descStr !== null
        ? descStr.length
        : null;

  return { missingTitle, missingDesc, titleLength, descLength };
}

// B4 — title/description length thresholds.
const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESC_MIN = 120;
const DESC_MAX = 160;

function deriveIssues(a: ArticleHealthInput): string[] {
  const issues: string[] = [];
  if (a.wordCount < 300) issues.push("Thin content");
  if (a.internalLinkCount === 0) issues.push("No internal links");
  if (a.headingCount < 2) issues.push("Few headings");
  if (a.inboundCount === 0) issues.push("Orphan (no inbound links)");

  // B4 — missing H1: only a headingCount signal is exposed on the record.
  if (a.headingCount < 1) issues.push("Missing H1");

  const { missingTitle, missingDesc, titleLength, descLength } = deriveMetaIssues(a.seoData);
  if (missingTitle) issues.push("Missing meta title");
  if (missingDesc) issues.push("Missing meta description");

  // B4 — title length outside 30–60 chars (only when present & a length is known).
  if (!missingTitle && titleLength !== null && titleLength > 0) {
    if (titleLength < TITLE_MIN || titleLength > TITLE_MAX) {
      issues.push("Title length off");
    }
  }

  // B4 — description length outside 120–160 chars. Missing description is its
  // own issue (handled above); only flag length when a description exists.
  if (!missingDesc && descLength !== null && descLength > 0) {
    if (descLength < DESC_MIN || descLength > DESC_MAX) {
      issues.push("Description length off");
    }
  }

  return issues;
}

export function aggregateOnPageHealth(articles: ArticleHealthInput[]): OnPageHealthResult {
  const totals = {
    total: articles.length,
    missingMeta: 0,
    thinContent: 0,
    noInternalLinks: 0,
    lowHeadings: 0,
    orphan: 0,
    titleLengthOff: 0,
    descLengthOff: 0,
    missingDesc: 0,
    missingH1: 0,
    duplicateTitle: 0,
  };

  // B4 — duplicate titles across the corpus: a title shared by >1 article.
  const titleCounts = new Map<string, number>();
  for (const a of articles) {
    const key = (a.title ?? "").trim().toLowerCase();
    if (!key) continue;
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }

  const offenders: Array<{ handle: string; title: string; wordCount: number; issues: string[] }> = [];

  for (const a of articles) {
    const issues = deriveIssues(a);

    // B4 — flag this article if its title is shared with another article.
    const titleKey = (a.title ?? "").trim().toLowerCase();
    if (titleKey && (titleCounts.get(titleKey) ?? 0) > 1) {
      issues.push("Duplicate title");
    }

    if (issues.includes("Thin content")) totals.thinContent++;
    if (issues.includes("No internal links")) totals.noInternalLinks++;
    if (issues.includes("Few headings")) totals.lowHeadings++;
    if (issues.includes("Orphan (no inbound links)")) totals.orphan++;
    if (issues.includes("Missing meta title") || issues.includes("Missing meta description")) {
      totals.missingMeta++;
    }
    if (issues.includes("Missing meta description")) totals.missingDesc++;
    if (issues.includes("Title length off")) totals.titleLengthOff++;
    if (issues.includes("Description length off")) totals.descLengthOff++;
    if (issues.includes("Missing H1")) totals.missingH1++;
    if (issues.includes("Duplicate title")) totals.duplicateTitle++;

    if (issues.length >= 1) {
      offenders.push({ handle: a.handle, title: a.title, wordCount: a.wordCount, issues });
    }
  }

  offenders.sort((x, y) => y.issues.length - x.issues.length);

  return { totals, worstOffenders: offenders.slice(0, 20) };
}
