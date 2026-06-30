import { beforeEach, expect, test, vi } from "vitest";
import { collectDraftCitations } from "@/lib/content-pilot/generate-draft";
import type { ContentProposal } from "@prisma/client";

vi.mock("@/lib/ai/knowledge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/knowledge")>("@/lib/ai/knowledge");
  return { ...actual, retrieveContext: vi.fn() };
});
import { retrieveContext } from "@/lib/ai/knowledge";
const mockRetrieve = retrieveContext as unknown as ReturnType<typeof vi.fn>;

function proposal(overrides: Partial<ContentProposal>): ContentProposal {
  return { id: "p1", title: "Organic Ginger Tea", articleHandle: "ginger-tea", proposalType: "new-content", ...overrides } as ContentProposal;
}

beforeEach(() => mockRetrieve.mockReset());

test("maps retrieved chunks to compact citations for grounded types", async () => {
  mockRetrieve.mockResolvedValue([
    { sourceType: "article", sourceId: "a1", content: "x", score: 0.91, metadata: { title: "Ginger 101" } },
    { sourceType: "review", sourceId: "r1", content: "y", score: 0.42, metadata: {} },
  ]);
  const out = await collectDraftCitations(proposal({}));
  expect(out).toEqual([
    { sourceType: "article", title: "Ginger 101", score: 0.91 },
    { sourceType: "review", title: "review:r1", score: 0.42 },
  ]);
});

test("returns [] for non-grounded proposal types without calling retrieveContext", async () => {
  const out = await collectDraftCitations(proposal({ proposalType: "seo-fix" }));
  expect(out).toEqual([]);
  expect(mockRetrieve).not.toHaveBeenCalled();
});

test("returns [] when nothing retrieved (additive)", async () => {
  mockRetrieve.mockResolvedValue([]);
  expect(await collectDraftCitations(proposal({}))).toEqual([]);
});
