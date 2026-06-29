import { TOPIC_CLUSTERS } from "@/lib/config/topic-clusters";

export interface TopicTag {
  topic: string;
  confidence: number;
  matchedKeywords: string[];
}

function countOccurrences(text: string, keyword: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(keyword, pos)) !== -1) {
    count++;
    pos += keyword.length;
  }
  return count;
}

export function analyzeTopics(
  title: string,
  bodyText: string,
  shopifyTags: string[]
): TopicTag[] {
  const searchText = [title, bodyText, ...shopifyTags].join(" ").toLowerCase();
  const wordCount = Math.max(1, searchText.split(/\s+/).length);
  const results: TopicTag[] = [];

  for (const [topic, keywords] of Object.entries(TOPIC_CLUSTERS)) {
    const matched = keywords.filter((kw) => searchText.includes(kw.toLowerCase()));
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
