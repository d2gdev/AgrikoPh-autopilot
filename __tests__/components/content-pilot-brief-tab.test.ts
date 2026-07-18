import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "app/(embedded)/(content-pilot)/content-pilot/components/BriefTab.tsx",
  "utf8",
);

describe("Content Pilot Brief tab", () => {
  it("shows only exact-map actionable and research suggestions", () => {
    expect(source).toContain("Mapped content work");
    expect(source).toContain("Mapped research only");
    expect(source).toContain("/api/content-pilot/map-suggestions");
    expect(source).toContain("/api/seo/gaps/promote-selected");
    expect(source).not.toContain("Custom Topic");
    expect(source).not.toContain("Top content gaps");
    expect(source).not.toContain("/api/content-pilot/proposals/manual");
  });
});
