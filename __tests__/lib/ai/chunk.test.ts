import { test, expect } from "vitest";
import { chunkText } from "@/lib/ai/chunk";

test("short text yields a single chunk", () => {
  const chunks = chunkText("hello world");
  expect(chunks).toHaveLength(1);
  expect(chunks[0]!.chunkIndex).toBe(0);
  expect(chunks[0]!.content).toBe("hello world");
  expect(chunks[0]!.contentHash).toMatch(/^[a-f0-9]{64}$/);
});

test("long text splits into ordered chunks with overlap", () => {
  // Distinct words (not a repeated literal) so a startsWith-style assertion
  // can't be satisfied by a broken overlap implementation (wrong words,
  // wrong count, or fixed literals prepended).
  const words = Array.from({ length: 800 }, (_, i) => `word${i}`);
  const text = words.join(" ");
  const chunks = chunkText(text, { maxTokens: 500, overlapTokens: 50 });

  expect(chunks.length).toBeGreaterThan(1);
  chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));

  const chunkWords = chunks.map((c) => c.content.split(" "));

  // Find the k such that the trailing k words of `a` exactly equal the
  // leading k words of `b`. Because every word in `words` is distinct, a
  // match can only occur at the true overlap length — there is no
  // monotonic relationship between candidate k values (a match at k=25
  // says nothing about k=1, since the compared elements shift), so every
  // candidate must be checked independently. With unique words, at most
  // one k yields a full match; that match can only be the real overlap
  // seeded by chunkText, never a coincidence.
  const trailingOverlap = (a: string[], b: string[]): number => {
    const maxK = Math.min(a.length, b.length);
    for (let k = maxK; k >= 1; k--) {
      const aTail = a.slice(a.length - k);
      const bHead = b.slice(0, k);
      if (aTail.every((w, idx) => w === bHead[idx])) {
        return k;
      }
    }
    return 0;
  };

  const overlaps: number[] = [];
  for (let i = 0; i < chunkWords.length - 1; i++) {
    const k = trailingOverlap(chunkWords[i]!, chunkWords[i + 1]!);
    expect(k).toBeGreaterThanOrEqual(1);
    const aTail = chunkWords[i]!.slice(chunkWords[i]!.length - k);
    const bHead = chunkWords[i + 1]!.slice(0, k);
    expect(aTail).toEqual(bHead);
    overlaps.push(k);
  }

  // Reconstruct the full word sequence: chunk 0 in full, then each
  // subsequent chunk with its overlapping prefix stripped. This must
  // exactly reproduce the original word list — catching any dropped or
  // duplicated words at chunk boundaries.
  const reconstructed: string[] = [...chunkWords[0]!];
  for (let i = 1; i < chunkWords.length; i++) {
    const k = overlaps[i - 1]!;
    reconstructed.push(...chunkWords[i]!.slice(k));
  }
  expect(reconstructed).toEqual(words);
});

test("identical content produces identical hash", () => {
  expect(chunkText("same")[0]!.contentHash).toBe(chunkText("same")[0]!.contentHash);
});

test("empty/whitespace text yields no chunks", () => {
  expect(chunkText("   ")).toEqual([]);
});
