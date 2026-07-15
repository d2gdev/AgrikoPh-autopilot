import { TOPIC_CLUSTERS } from "@/lib/config/topic-clusters";

export interface TopicTag {
  topic: string;
  confidence: number;
  matchedKeywords: string[];
}

function keywordPattern(keyword: string): RegExp {
  const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "gi");
}

function containsKeyword(text: string, keyword: string): boolean {
  return keywordPattern(keyword).test(text);
}

function countOccurrences(text: string, keyword: string): number {
  return Array.from(text.matchAll(keywordPattern(keyword))).length;
}

export function analyzeTopics(
  title: string,
  bodyText: string,
  shopifyTags: string[]
): TopicTag[] {
  const relevanceText = [title, ...shopifyTags].join(" ").toLowerCase();
  const searchText = [title, bodyText, ...shopifyTags].join(" ").toLowerCase();
  const wordCount = Math.max(1, searchText.split(/\s+/).length);
  const results: TopicTag[] = [];

  for (const [topic, keywords] of Object.entries(TOPIC_CLUSTERS)) {
    if (!keywords.some((keyword) => containsKeyword(relevanceText, keyword))) continue;
    const matched = keywords.filter((keyword) => containsKeyword(searchText, keyword));
    if (matched.length === 0) continue;

    // Breadth: fraction of cluster keywords that appear at all
    const uniqueRatio = matched.length / keywords.length;

    // Depth: total keyword occurrences per 100 words, capped at 1.0 (3+ occ/100w = full depth)
    let occurrences = 0;
    for (const kw of matched) occurrences += countOccurrences(searchText, kw.toLowerCase());
    const densityScore = Math.min(1.0, (occurrences / wordCount) * 100 / 3);

    const confidence = Math.round((0.4 * uniqueRatio + 0.6 * densityScore) * 100) / 100;
    results.push({ topic, confidence, matchedKeywords: matched });
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}
