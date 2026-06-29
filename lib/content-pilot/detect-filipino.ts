// Heuristic Filipino/Tagalog detection for stored content drafts.
// Used to find existing AI drafts that were generated in Filipino so they can be
// regenerated in English. See memory: english-only-output.

// Common Tagalog/Filipino function words that rarely appear in English text.
// Kept to high-signal, unambiguous tokens to avoid false positives on English.
const FILIPINO_STOPWORDS = new Set([
  "ang", "mga", "ng", "sa", "na", "ay", "ito", "iyon", "yan", "dito", "doon",
  "kung", "dahil", "pero", "naman", "lang", "rin", "din", "po", "ako", "ikaw",
  "siya", "kami", "kayo", "sila", "niya", "nila", "namin", "natin", "ninyo",
  "kasi", "talaga", "ngayon", "hindi", "wala", "meron", "mayroon", "para",
  "upang", "nang", "kapag", "habang", "saka", "tayo", "kanila", "kanya",
  "masarap", "maganda", "malusog", "kalusugan", "halaman", "bigas", "kanin",
  "luto", "lutuin", "inumin", "pagkain", "araw-araw", "subukan", "tuwing",
]);

// HTML/markup strip + tokenization to plain lowercase words.
function tokenize(text: string): string[] {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .toLowerCase()
    .match(/[a-zàáâäãåèéêëìíîïòóôöõùúûü']+/gi) ?? [];
}

/** Pull all human-readable text out of a draftContent JSON blob. */
export function extractDraftText(draftContent: unknown): string {
  if (!draftContent || typeof draftContent !== "object") return "";
  const c = draftContent as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["title", "metaTitle", "metaDescription", "bodyHtml", "suggestedParagraph", "anchorText"]) {
    const v = c[key];
    if (typeof v === "string") parts.push(v);
  }
  if (Array.isArray(c.tags)) parts.push(c.tags.filter((t) => typeof t === "string").join(" "));
  return parts.join("\n");
}

export interface FilipinoVerdict {
  isFilipino: boolean;
  score: number;        // ratio of Filipino stopwords to total words
  matchedCount: number; // count of Filipino stopword hits
  wordCount: number;
  sample: string;       // first ~120 chars of detected text
}

/**
 * Detect whether text is (substantially) Filipino. A draft is flagged when
 * Filipino function words make up a meaningful share of the words AND there are
 * enough hits to rule out the odd loanword in otherwise-English copy.
 */
export function detectFilipino(text: string): FilipinoVerdict {
  const words = tokenize(text);
  const wordCount = words.length;
  let matchedCount = 0;
  for (const w of words) if (FILIPINO_STOPWORDS.has(w)) matchedCount++;
  const score = wordCount > 0 ? matchedCount / wordCount : 0;
  // Thresholds: needs both a real density (>2%) and an absolute floor (>=4 hits)
  // so a long English article with one stray token isn't flagged.
  const isFilipino = score > 0.02 && matchedCount >= 4;
  return {
    isFilipino,
    score: Number(score.toFixed(4)),
    matchedCount,
    wordCount,
    sample: text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120),
  };
}
