import { test, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { indexKnowledgeHandler } from "@/jobs/index-knowledge";
import { collectSourceDocs } from "@/lib/ai/knowledge-sources";
import { embedTexts } from "@/lib/ai/embeddings";
import { prisma } from "@/lib/db";

vi.mock("@/lib/ai/knowledge-sources", () => ({ collectSourceDocs: vi.fn() }));
vi.mock("@/lib/ai/embeddings", () => ({ embedTexts: vi.fn(), EMBEDDING_DIM: 1024 }));
vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: { create: vi.fn().mockResolvedValue({ id: "run-1" }), update: vi.fn() },
    knowledgeChunk: { findMany: vi.fn(), deleteMany: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  },
}));

const mockCollect = collectSourceDocs as Mock;
const mockEmbed = embedTexts as Mock;
const mockExisting = prisma.knowledgeChunk.findMany as Mock;
const mockExecRaw = prisma.$executeRawUnsafe as Mock;
const mockDelete = prisma.knowledgeChunk.deleteMany as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  mockExisting.mockResolvedValue([]);
  mockEmbed.mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => Array(1024).fill(0.1))));
});

test("embeds and upserts chunks for new content", async () => {
  mockCollect.mockResolvedValue([
    { sourceType: "article", sourceId: "a1", text: "ginger tea benefits", metadata: { title: "T" } },
  ]);
  const result = await indexKnowledgeHandler();
  expect(mockEmbed).toHaveBeenCalled();
  expect(mockExecRaw).toHaveBeenCalled(); // upsert via raw SQL (vector column)
  expect(result.summary.indexed).toBeGreaterThan(0);
  expect(result.status).toBe("success");
});

test("skips chunks whose contentHash is unchanged", async () => {
  mockCollect.mockResolvedValue([
    { sourceType: "article", sourceId: "a1", text: "stable text", metadata: {} },
  ]);
  // First run computes the hash; capture it by running once with empty existing.
  await indexKnowledgeHandler();
  const insertedHash = mockExecRaw.mock.calls[0]!.find((a: unknown) => typeof a === "string" && /^[a-f0-9]{64}$/.test(a as string));
  vi.clearAllMocks();
  mockExisting.mockResolvedValue([{ sourceType: "article", sourceId: "a1", chunkIndex: 0, contentHash: insertedHash }]);
  const result = await indexKnowledgeHandler();
  expect(mockEmbed).not.toHaveBeenCalled();
  expect(result.summary.skipped).toBeGreaterThan(0);
});

test("deletes chunks for source rows that no longer exist", async () => {
  mockCollect.mockResolvedValue([]); // no current sources
  mockExisting.mockResolvedValue([{ sourceType: "article", sourceId: "gone", chunkIndex: 0, contentHash: "h" }]);
  const result = await indexKnowledgeHandler();
  expect(mockDelete).toHaveBeenCalled();
  expect(result.summary.deleted).toBeGreaterThan(0);
});
