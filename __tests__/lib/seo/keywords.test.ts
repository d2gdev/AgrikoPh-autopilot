import { describe, expect, it } from "vitest";
import { buildKeywordReport } from "@/lib/seo/keywords";

describe("buildKeywordReport", () => {
  it("alerts when a previously ranking tracked keyword disappears", () => {
    const report = buildKeywordReport(
      [{ keyword: "black rice" }],
      [],
      [{ query: "black rice", clicks: 8, impressions: 100, ctr: "8%", position: "3" }],
    );

    expect(report[0]).toMatchObject({
      keyword: "black rice",
      position: null,
      status: "declined",
      alert: true,
    });
  });

  it("keeps a never-observed keyword untracked without an alert", () => {
    expect(buildKeywordReport([{ keyword: "new keyword" }], [], [])[0]).toMatchObject({
      status: "untracked",
      alert: false,
    });
  });
});
