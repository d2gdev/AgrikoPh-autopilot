import { beforeEach, expect, test, vi } from "vitest";

vi.mock("openai", () => ({ default: vi.fn() }));

// Mock only retrieveContext; keep the real formatGroundingBlock so the test
// exercises the actual rendering.
vi.mock("@/lib/ai/knowledge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/knowledge")>("@/lib/ai/knowledge");
  return { ...actual, retrieveContext: vi.fn() };
});

import { groundSkillContext } from "@/lib/skills/runner";
import { retrieveContext } from "@/lib/ai/knowledge";
const mockRetrieve = retrieveContext as ReturnType<typeof vi.fn>;

beforeEach(() => mockRetrieve.mockReset());

test("adds grounding block when insights exist", async () => {
  mockRetrieve.mockResolvedValue([
    { sourceType: "market_insight", sourceId: "m1", content: "Competitor X cut prices 10%.", score: 0.8, metadata: {} },
  ]);
  const ctx = await groundSkillContext("base context", "campaign ROAS pause");
  expect(ctx).toContain("base context");
  expect(ctx).toContain("Competitor X cut prices 10%.");
});

test("returns base context unchanged when nothing retrieved", async () => {
  mockRetrieve.mockResolvedValue([]);
  expect(await groundSkillContext("base context", "q")).toBe("base context");
});
