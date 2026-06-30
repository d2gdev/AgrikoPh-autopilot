import { beforeEach, expect, test, vi } from "vitest";
import { buildGroundedSystemPrompt } from "@/lib/content-pilot/generate-draft";

// Mock only retrieveContext; keep the real formatGroundingBlock so the test
// exercises the actual rendering.
vi.mock("@/lib/ai/knowledge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/knowledge")>("@/lib/ai/knowledge");
  return { ...actual, retrieveContext: vi.fn() };
});
import { retrieveContext } from "@/lib/ai/knowledge";
const mockRetrieve = retrieveContext as ReturnType<typeof vi.fn>;

beforeEach(() => mockRetrieve.mockReset());

test("appends grounding block when chunks are retrieved", async () => {
  mockRetrieve.mockResolvedValue([
    { sourceType: "article", sourceId: "a1", content: "Agriko ginger is organic.", score: 0.9, metadata: { title: "Ginger" } },
  ]);
  const prompt = await buildGroundedSystemPrompt("base system", "organic ginger tea");
  expect(prompt).toContain("base system");
  expect(prompt).toContain("Agriko ginger is organic.");
});

test("returns base prompt unchanged when nothing retrieved", async () => {
  mockRetrieve.mockResolvedValue([]);
  const prompt = await buildGroundedSystemPrompt("base system", "organic ginger tea");
  expect(prompt).toBe("base system");
});
