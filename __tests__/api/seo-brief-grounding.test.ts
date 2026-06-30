import { test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

vi.mock("@/lib/ai/knowledge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/knowledge")>("@/lib/ai/knowledge");
  return { ...actual, retrieveContext: vi.fn() };
});

import { groundSeoBriefContext } from "@/app/api/seo/brief/route";
import { retrieveContext } from "@/lib/ai/knowledge";

const mockRetrieve = retrieveContext as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => mockRetrieve.mockReset());

test("adds grounding when relevant articles exist", async () => {
  mockRetrieve.mockResolvedValue([
    { sourceType: "article", sourceId: "a1", content: "Black rice benefits explained.", score: 0.7, metadata: {} },
  ]);
  const ctx = await groundSeoBriefContext("base brief", "black rice");
  expect(ctx).toContain("Black rice benefits explained.");
});

test("unchanged when nothing retrieved", async () => {
  mockRetrieve.mockResolvedValue([]);
  expect(await groundSeoBriefContext("base brief", "q")).toBe("base brief");
});
