import { test, expect } from "vitest";
import { GroundingCitations, citationLabel } from "@/components/content-pilot/grounding-citations";

test("citationLabel formats source, type and score", () => {
  expect(citationLabel({ sourceType: "article", title: "Ginger 101", score: 0.912 })).toBe("Ginger 101 · article · 0.91");
});

test("renders nothing when there are no citations", () => {
  expect(GroundingCitations({ citations: [] })).toBeNull();
  expect(GroundingCitations({ citations: null })).toBeNull();
  expect(GroundingCitations({})).toBeNull();
});

test("returns an element when citations are present", () => {
  const el = GroundingCitations({ citations: [{ sourceType: "article", title: "Ginger 101", score: 0.9 }] });
  expect(el).not.toBeNull();
  // serialize the element tree to a string and confirm the citation text is in it
  expect(JSON.stringify(el)).toContain("Ginger 101");
});
