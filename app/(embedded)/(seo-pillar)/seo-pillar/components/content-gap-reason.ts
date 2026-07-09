import type { ContentGap } from "./types";

export function contentGapReason(gap: ContentGap): string {
  if (gap.issue === "missing-meta") {
    return gap.articleHandle
      ? `Existing article ${gap.articleHandle} is missing SERP metadata.`
      : "Existing article is missing SERP metadata.";
  }

  if (gap.issue === "thin-content") {
    const words = typeof gap.wordCount === "number" ? ` (${gap.wordCount.toLocaleString()} words)` : "";
    return gap.articleHandle
      ? `Existing article ${gap.articleHandle} is thin${words}.`
      : `Existing article is thin${words}.`;
  }

  const impressions = Number(gap.impressions ?? 0);
  const position = Number(gap.position ?? 0);
  if (impressions > 0 && position > 0) {
    return `Uncovered GSC query with ${impressions.toLocaleString()} impressions at avg position ${position.toFixed(1)}.`;
  }

  return "Uncovered query not matched to existing article content.";
}
