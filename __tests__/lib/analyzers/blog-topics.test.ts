import { describe, expect, it } from "vitest";
import { analyzeTopics } from "@/lib/analyzers/blog-topics";

describe("analyzeTopics", () => {
  it("does not classify price language as rice", () => {
    const topics = analyzeTopics(
      "How customer testimonial UGC builds trust",
      "Compare price points and promotion performance before testing a new creative.",
      ["advertising"],
    );

    expect(topics.map((topic) => topic.topic)).not.toContain("rice");
  });

  it("does not promote incidental generic body words into article topics", () => {
    const topics = analyzeTopics(
      "How customer testimonial UGC builds trust",
      "The ad shows organic rice, ginger tea, food, meals, and local ingredients as product examples.",
      ["advertising"],
    );

    expect(topics).toEqual([]);
  });

  it("classifies a topic when the title establishes relevance", () => {
    const topics = analyzeTopics(
      "Red Rice vs Brown Rice for Filipino Meals",
      "This whole grain guide compares nutrition, fiber, cooking time, and meal planning.",
      [],
    );

    expect(topics).toContainEqual(expect.objectContaining({
      topic: "rice",
      matchedKeywords: expect.arrayContaining(["rice", "brown rice"]),
    }));
  });

  it("does not let a Shopify tag override title relevance", () => {
    const topics = analyzeTopics(
      "A practical buyer guide",
      "The article explains nutrients and fiber.",
      ["nutrition"],
    );

    expect(topics.map((topic) => topic.topic)).not.toContain("nutrition");
  });
});
