import type { ParsedArticleHtml } from "./html-parser";

export type SeoIssue =
  | "missing-meta-description"
  | "title-too-long"
  | "meta-description-too-long"
  | "multiple-h1"
  | "missing-h1"
  | "thin-content";

export interface SeoAnalysis {
  titleLength: number;
  descLength: number;
  h1Count: number;
  h2s: string[];
  wordCount: number;
  readingTime: number;
  issues: SeoIssue[];
  score: number;
}

const ISSUE_DEDUCTIONS: Record<SeoIssue, number> = {
  "missing-meta-description": 20,
  "title-too-long": 10,
  "meta-description-too-long": 5,
  "multiple-h1": 15,
  "missing-h1": 20,
  "thin-content": 15,
};

export function analyzeSeo(
  meta: { seoTitle: string | null; seoDescription: string | null },
  parsed: ParsedArticleHtml
): SeoAnalysis {
  const title = meta.seoTitle ?? "";
  const desc = meta.seoDescription ?? "";
  const issues: SeoIssue[] = [];

  if (!desc) issues.push("missing-meta-description");
  if (title.length > 60) issues.push("title-too-long");
  if (desc.length > 160) issues.push("meta-description-too-long");
  if (parsed.h1s.length > 1) issues.push("multiple-h1");
  if (parsed.h1s.length === 0) issues.push("missing-h1");
  if (parsed.wordCount < 300) issues.push("thin-content");

  const deducted = issues.reduce((sum, issue) => sum + ISSUE_DEDUCTIONS[issue], 0);

  return {
    titleLength: title.length,
    descLength: desc.length,
    h1Count: parsed.h1s.length,
    h2s: parsed.h2s,
    wordCount: parsed.wordCount,
    readingTime: Math.ceil(parsed.wordCount / 200),
    issues,
    score: Math.max(0, 100 - deducted),
  };
}
