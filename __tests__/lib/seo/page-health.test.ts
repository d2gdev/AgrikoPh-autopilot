import { describe, expect, it } from "vitest";
import { computePageHealth } from "@/lib/seo/page-health";

const gsc = [{ page: "/blogs/news/black-rice", clicks: 1, impressions: 1_000, ctr: "0.1%", position: "5" }];

describe("computePageHealth nullable analytics", () => {
  it("does not treat missing GA4 rates as measured zero rates", () => {
    const [row] = computePageHealth(gsc, [{ page: "/blogs/news/black-rice", sessions: 100, bounceRate: "—", conversionRate: "—" }]);
    expect(row).toMatchObject({ bounceRate: null, conversionRate: null, flag: null, severity: 0 });
  });

  it("still flags an explicit measured zero conversion rate", () => {
    const [row] = computePageHealth(gsc, [{ page: "/blogs/news/black-rice", sessions: 100, bounceRate: "30%", conversionRate: "0%" }]);
    expect(row).toMatchObject({ conversionRate: 0, flag: "high-impressions-low-conversion" });
  });
});
