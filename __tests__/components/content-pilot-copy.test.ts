import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Content Pilot operator copy", () => {
  it("does not imply overview rows are passed into generic brief generation", () => {
    const source = readFileSync("app/(embedded)/(content-pilot)/content-pilot/components/OverviewTab.tsx", "utf8");

    expect(source).not.toContain("Create brief from a gap");
    expect(source).not.toContain("Create brief to address an orphan");
  });

  it("qualifies the dashboard publication metric as this month", () => {
    const source = readFileSync("app/(embedded)/components/dashboard/sections/PerformanceRow.tsx", "utf8");

    expect(source).toContain("published this month");
  });
});
