import { test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai/knowledge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/knowledge")>("@/lib/ai/knowledge");
  return { ...actual, retrieveContext: vi.fn() };
});

import { groundBriefContext } from "@/lib/market-intel/generate-brief";
import { retrieveContext } from "@/lib/ai/knowledge";

const mockRetrieve = retrieveContext as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => mockRetrieve.mockReset());

test("adds grounding when competitor history exists", async () => {
  mockRetrieve.mockResolvedValue([
    { sourceType: "competitor_ad", sourceId: "c1", content: "Buy 1 take 1 turmeric.", score: 0.7, metadata: {} },
  ]);
  const ctx = await groundBriefContext("base brief", "turmeric promo");
  expect(ctx).toContain("Buy 1 take 1 turmeric.");
});

test("unchanged when nothing retrieved", async () => {
  mockRetrieve.mockResolvedValue([]);
  expect(await groundBriefContext("base brief", "q")).toBe("base brief");
});
