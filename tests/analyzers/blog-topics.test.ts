import { describe, it, expect } from "vitest";
import { analyzeTopics } from "@/lib/analyzers/blog-topics";

describe("analyzeTopics", () => {
  it("tags moringa topic from title and body", () => {
    const result = analyzeTopics("Growing Moringa at Home", "Malunggay is a superfood. Moringa leaves are nutritious.", []);
    const moringa = result.find((t) => t.topic === "moringa");
    expect(moringa).toBeDefined();
    expect(moringa!.matchedKeywords).toContain("moringa");
    expect(moringa!.matchedKeywords).toContain("malunggay");
    expect(moringa!.confidence).toBeGreaterThan(0);
  });

  it("tags from Shopify tags array", () => {
    const result = analyzeTopics("A blog post", "Some content.", ["rice", "sinandomeng"]);
    const rice = result.find((t) => t.topic === "rice");
    expect(rice).toBeDefined();
    expect(rice!.matchedKeywords).toContain("rice");
  });

  it("returns topics sorted by confidence descending", () => {
    const result = analyzeTopics(
      "Moringa moringa moringa",
      "organic organic organic moringa",
      []
    );
    for (let i = 1; i < result.length; i++) {
      const previous = result[i - 1];
      const current = result[i];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      expect(previous?.confidence).toBeGreaterThanOrEqual(current?.confidence ?? 0);
    }
  });

  it("returns empty array for content with no keyword matches", () => {
    const result = analyzeTopics("Weather report", "It rained today.", []);
    expect(result).toHaveLength(0);
  });

  it("confidence equals matchedKeywords.length / totalKeywordsInCluster", () => {
    // Confidence blends keyword breadth with keyword density.
    const result = analyzeTopics("Moringa malunggay", "content", []);
    const moringa = result.find((t) => t.topic === "moringa")!;
    expect(moringa.confidence).toBeCloseTo(0.8, 2);
  });
});
