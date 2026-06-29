/**
 * Heuristic filter for spam "serialized-story" creatives that pollute the
 * Meta Ad Library scrape (e.g. dramatic romance/revenge novelette ads from
 * content-farm pages like "TaleTerrace"). These are never relevant to a
 * Agriko competitor analysis but match broad keyword searches.
 *
 * Pure + dependency-free so it can be unit-tested and reused by the UI.
 */

export interface SpamCheckInput {
  adCopy?: string | null;
  headline?: string | null;
  description?: string | null;
  pageName?: string | null;
}

/** Dramatic / novelette tropes, multilingual (EN + Tagalog) — lowercased. */
const STORY_KEYWORDS = [
  // English
  "fiancee", "fiancée", "mistress", "billionaire", "ceo", "tycoon", "heiress",
  "revenge", "divorce", "affair", "secretary", "wedding", "bride", "groom",
  "cheated", "betrayed", "pregnant", "contract marriage",
  // Tagalog
  "kasal", "asawa", "fiancée", "sekretarya", "kabit", "naghiganti",
  "diborsyo", "ikakasal", "nobya", "nobyo", "pari", "hubo't hubad",
  "nagtaksil", "buntis", "milyonaryo",
];

/** Page-name fragments characteristic of story content farms. */
const STORY_PAGE_HINTS = ["tale", "story", "novel", "drama", "chapter", "saga", "fiction"];

export interface SpamScore {
  isSpam: boolean;
  score: number;
  reasons: string[];
}

/**
 * Scores a creative for "serialized-story spam" likelihood.
 * Conservative by design: legit competitor ads are short product copy, so the
 * length gate alone excludes almost all of them before keyword matching.
 */
export function scoreSpamStoryAd(ad: SpamCheckInput): SpamScore {
  const reasons: string[] = [];
  const copy = (ad.adCopy ?? "").trim();
  const haystack = `${ad.headline ?? ""} ${ad.description ?? ""} ${copy}`.toLowerCase();

  let score = 0;

  // 1. Length — story ads run very long; product ads almost never do.
  if (copy.length > 1200) { score += 2; reasons.push("very-long-copy"); }
  else if (copy.length > 600) { score += 1; reasons.push("long-copy"); }

  // 2. Dramatic keyword density.
  const keywordHits = STORY_KEYWORDS.filter((k) => haystack.includes(k));
  if (keywordHits.length >= 4) { score += 2; reasons.push(`keywords:${keywordHits.length}`); }
  else if (keywordHits.length >= 2) { score += 1; reasons.push(`keywords:${keywordHits.length}`); }

  // 3. Heavy dialogue — quotation marks (curly + straight).
  const quoteCount = (copy.match(/[""“”]/g) ?? []).length;
  if (quoteCount >= 6) { score += 1; reasons.push(`quotes:${quoteCount}`); }

  // 4. Long-dash narrative breaks ("——") common in these ads.
  if (/[—–]{2,}|——/.test(copy)) { score += 1; reasons.push("emdash-break"); }

  // 5. Many sentences (narrative prose, not a product pitch).
  const sentences = (copy.match(/[.!?]+/g) ?? []).length;
  if (sentences >= 12) { score += 1; reasons.push(`sentences:${sentences}`); }

  // 6. Page name is a known story-farm pattern (weak signal).
  const pageName = (ad.pageName ?? "").toLowerCase();
  if (STORY_PAGE_HINTS.some((h) => pageName.includes(h))) {
    score += 1;
    reasons.push("story-page-name");
  }

  // Require real narrative bulk so a short product ad mentioning "wedding"
  // (e.g. a florist) can never be misclassified.
  const isStorySpam = copy.length > 500 && score >= 3;

  // 7. Cloaked-link dropship scams (e.g. turmeric/joint-gel "Buy 1 Get 1"
  //    ads pointing at .click redirect domains). Separate, narrow path:
  //    requires a junk/cloaking domain AND urgency, so legit promos pass.
  const JUNK_DOMAINS = [".click", "metroph", ".shop/", ".vip", ".top/"];
  const URGENCY = [
    "buy 1 get 1", "buy one get one", "products left", "only", "hurry",
    "offer is about to end", "limited stock", "order now", "while supplies last",
  ];
  const hasJunkDomain = JUNK_DOMAINS.some((d) => haystack.includes(d));
  const urgencyHits = URGENCY.filter((u) => haystack.includes(u)).length;
  if (hasJunkDomain) { score += 2; reasons.push("cloaked-link-domain"); }
  if (urgencyHits >= 2) { score += 1; reasons.push(`urgency:${urgencyHits}`); }
  const isDropshipScam = hasJunkDomain && urgencyHits >= 2;

  return { isSpam: isStorySpam || isDropshipScam, score, reasons };
}

/** Convenience boolean wrapper. */
export function isSpamStoryAd(ad: SpamCheckInput): boolean {
  return scoreSpamStoryAd(ad).isSpam;
}
