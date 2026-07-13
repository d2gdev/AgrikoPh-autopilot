import { describe, expect, it } from "vitest";
import { workRowMatchesFilters } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/panels/MapWorkPanel";
import { pageMatchesBlockerFilter } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/panels/MapPagesPanel";

describe("command-center filters", () => {
  it("filters work by real priority, lifecycle state, and blocker classification", () => {
    const candidate = { priority: "high", state: "candidate" as const, blocker: "clear" as const };
    expect(workRowMatchesFilters(candidate, { priority: "high", state: "candidate", blocker: "clear" })).toBe(true);
    expect(workRowMatchesFilters(candidate, { priority: "low", state: "candidate", blocker: "clear" })).toBe(false);
    expect(workRowMatchesFilters(candidate, { priority: "high", state: "blocked", blocker: "clear" })).toBe(false);
    expect(workRowMatchesFilters(candidate, { priority: "high", state: "candidate", blocker: "review" })).toBe(false);
  });
  it("filters pages against actual prohibited URL associations", () => {
    expect(pageMatchesBlockerFilter("/blocked", ["/blocked"], "blocked")).toBe(true);
    expect(pageMatchesBlockerFilter("/clear", ["/blocked"], "blocked")).toBe(false);
    expect(pageMatchesBlockerFilter("/clear", ["/blocked"], "clear")).toBe(true);
  });
});
