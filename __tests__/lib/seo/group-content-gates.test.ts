import { describe, expect, it } from "vitest";
import { groupContentGateSuppressions } from "@/lib/seo/group-content-gates";

describe("groupContentGateSuppressions", () => {
  it("groups duplicate page suppressions and preserves every reason and rule", () => {
    const grouped = groupContentGateSuppressions([
      { page: "/blogs/news/brown-rice-recipes", reason: "manual_gate", ruleIds: ["rule:1"] },
      { page: "/blogs/news/brown-rice-recipes", reason: "conditions_unsatisfied", ruleIds: ["rule:2", "rule:1"] },
      { page: "/blogs/news/other", reason: "observation_unavailable", ruleIds: ["rule:3"] },
    ]);

    expect(grouped).toEqual([{
      page: "/blogs/news/brown-rice-recipes",
      reasons: ["conditions_unsatisfied", "manual_gate"],
      ruleIds: ["rule:1", "rule:2"],
    }]);
  });

  it("retains the available bounded page context", () => {
    const observation = { source: "store" as const, capturedAt: "2026-07-14T00:00:00.000Z", provenance: "ArticleRecord:news/brown-rice-recipes" };
    const grouped = groupContentGateSuppressions([
      { page: "/blogs/news/brown-rice-recipes", reason: "manual_gate", ruleIds: ["rule:1"], currentArticleTitle: "Brown Rice Recipes", observation },
      { page: "/blogs/news/brown-rice-recipes", reason: "manual_gate", ruleIds: ["rule:2"] },
    ]);

    expect(grouped[0]).toEqual(expect.objectContaining({ currentArticleTitle: "Brown Rice Recipes", observation }));
  });
});
