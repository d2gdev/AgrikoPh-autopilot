import { expect, it } from "vitest";
import { computeCtrOpportunities } from "@/lib/seo/opportunities";

it("attributes a query using a mapping beyond the first 50 pairs", () => {
  const filler = Array.from({ length: 50 }, (_, index) => ({
    query: `filler ${index}`,
    page: `https://agrikoph.com/blogs/news/filler-${index}`,
    clicks: 0,
    impressions: 1000 - index,
    position: "8.0",
  }));
  const opportunities = computeCtrOpportunities(
    [{ query: "target query", clicks: 0, impressions: 200, ctr: "0%", position: "8.0" }],
    [...filler, {
      query: "target query",
      page: "https://agrikoph.com/blogs/news/target-article",
      clicks: 0,
      impressions: 200,
      position: "8.0",
    }],
  );
  expect(opportunities[0]?.page).toBe("https://agrikoph.com/blogs/news/target-article");
});
