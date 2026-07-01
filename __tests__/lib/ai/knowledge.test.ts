import { beforeEach, expect, test, vi } from "vitest";
import { retrieveContext, formatGroundingBlock } from "@/lib/ai/knowledge";
import { embedTexts, EmbeddingsUnavailableError } from "@/lib/ai/embeddings";
import { prisma } from "@/lib/db";

vi.mock("@/lib/ai/embeddings", () => ({
  embedTexts: vi.fn(),
  EmbeddingsUnavailableError: class extends Error {},
}));
vi.mock("@/lib/db", () => ({ prisma: { $queryRawUnsafe: vi.fn() } }));

const mockEmbed = embedTexts as ReturnType<typeof vi.fn>;
const mockQuery = prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockEmbed.mockReset();
  mockQuery.mockReset();
  mockEmbed.mockResolvedValue([Array(1024).fill(0.1)]);
});

test("returns rows above minScore, ordered as the DB returns them", async () => {
  mockQuery.mockResolvedValue([
    { sourceType: "article", sourceId: "a1", content: "x", score: 0.9, metadata: { title: "T" } },
    { sourceType: "review", sourceId: "r1", content: "y", score: 0.5, metadata: {} },
  ]);
  const out = await retrieveContext({ query: "ginger tea", minScore: 0.4 });
  expect(out.map((r) => r.sourceId)).toEqual(["a1", "r1"]);
});

test("drops rows below minScore", async () => {
  mockQuery.mockResolvedValue([
    { sourceType: "article", sourceId: "a1", content: "x", score: 0.9, metadata: {} },
    { sourceType: "review", sourceId: "r1", content: "y", score: 0.2, metadata: {} },
  ]);
  const out = await retrieveContext({ query: "q", minScore: 0.35 });
  expect(out.map((r) => r.sourceId)).toEqual(["a1"]);
});

test("returns [] when embeddings unavailable (graceful)", async () => {
  mockEmbed.mockRejectedValue(new EmbeddingsUnavailableError("off"));
  expect(await retrieveContext({ query: "q" })).toEqual([]);
});

test("returns [] when the embeddings call is aborted (e.g. a slow/hanging service)", async () => {
  mockEmbed.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));
  expect(await retrieveContext({ query: "q" })).toEqual([]);
});

test("bounds the embeddings call with its own short timeout, independent of any caller-supplied timer", async () => {
  await retrieveContext({ query: "q" });
  // Grounding is additive/best-effort — a slow embeddings service must never be
  // able to consume a caller's own request budget (e.g. an AI completion's
  // AbortSignal.timeout started before this call), so this must bound itself.
  expect(mockEmbed).toHaveBeenCalledWith(
    ["q"],
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

test("returns [] when the DB query throws (graceful)", async () => {
  mockQuery.mockRejectedValue(new Error("db down"));
  expect(await retrieveContext({ query: "q" })).toEqual([]);
});

test("formatGroundingBlock is empty for no chunks", () => {
  expect(formatGroundingBlock([])).toBe("");
});

test("formatGroundingBlock cites source + title", () => {
  const block = formatGroundingBlock([
    { sourceType: "article", sourceId: "a1", content: "Ginger helps digestion.", score: 0.9, metadata: { title: "Ginger 101" } },
  ]);
  expect(block).toContain("Ginger 101");
  expect(block).toContain("Ginger helps digestion.");
});
