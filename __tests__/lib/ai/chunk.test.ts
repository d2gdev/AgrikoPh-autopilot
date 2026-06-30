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
  const word = "lorem ";
  const text = word.repeat(2000); // ~12k chars ≈ 3000 tokens
  const chunks = chunkText(text, { maxTokens: 500, overlapTokens: 50 });
  expect(chunks.length).toBeGreaterThan(1);
  chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  // Overlap: the tail of chunk N appears at the head of chunk N+1.
  const tail = chunks[0]!.content.slice(-100);
  expect(chunks[1]!.content.startsWith(tail.split(" ").slice(-3).join(" "))).toBe(true);
});

test("identical content produces identical hash", () => {
  expect(chunkText("same")[0]!.contentHash).toBe(chunkText("same")[0]!.contentHash);
});

test("empty/whitespace text yields no chunks", () => {
  expect(chunkText("   ")).toEqual([]);
});
