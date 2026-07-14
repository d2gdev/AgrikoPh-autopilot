import { describe, expect, it } from "vitest";
import { globalBlockersVisible, internalLinkPresentation, workRowMatchesFilters } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/panels/MapWorkPanel";
import { MapOverviewPanel } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/panels/MapOverviewPanel";
import { pageMatchesBlockerFilter, pageMatchesPriorityFilter, priorityBadgeTone } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/panels/MapPagesPanel";

describe("command-center filters", () => {
  it("filters work by real priority, lifecycle state, and blocker classification", () => {
    const candidate = { priority: "high", state: "candidate" as const, blocker: "clear" as const };
    expect(workRowMatchesFilters(candidate, { priority: "high", state: "candidate", blocker: "clear" })).toBe(true);
    expect(workRowMatchesFilters(candidate, { priority: "low", state: "candidate", blocker: "clear" })).toBe(false);
    expect(workRowMatchesFilters(candidate, { priority: "high", state: "blocked", blocker: "clear" })).toBe(false);
    expect(workRowMatchesFilters(candidate, { priority: "high", state: "candidate", blocker: "review" })).toBe(false);
    expect(workRowMatchesFilters({ ...candidate, priority: "P0" }, { priority: "high", state: "candidate", blocker: "clear" })).toBe(true);
    expect(workRowMatchesFilters({ ...candidate, priority: "P1" }, { priority: "high", state: "candidate", blocker: "clear" })).toBe(true);
    expect(workRowMatchesFilters({ ...candidate, priority: "P2" }, { priority: "medium", state: "candidate", blocker: "clear" })).toBe(true);
    expect(workRowMatchesFilters({ ...candidate, priority: "P3" }, { priority: "low", state: "candidate", blocker: "clear" })).toBe(true);
  });
  it("counts P0 and P1 rules as high-priority overview actions", () => {
    const renderedText = (value: any): string => Array.isArray(value) ? value.map(renderedText).join("") : value && typeof value === "object" ? renderedText(value.props?.children) : String(value ?? "");
    const priorities = [...Array(57).fill("P0"), ...Array(180).fill("P1")];
    const rendered = renderedText(MapOverviewPanel({ mapState: { state: "ready", generatedAt: "2026-07-14T00:00:00.000Z", commandCenter: {
      identity: { versionId: "v3", strategyVersion: "2026-07-12", contractRevision: "3", packageSha256: "a".repeat(64), activatedAt: null },
      domainCounts: { clusters: 0, page_roles: 0, url_intent_ownership: 0, content_decisions: 0, prohibited_content: 0, internal_links: priorities.length, redirects: 0, canonicalization: 0, indexation: 0, evidence_gates: 0, high_stakes_reviews: 0 },
      clusters: [], pages: [], prohibited: [], blockers: { evidence: [], reviews: [] }, provenance: {},
      work: { internalLinks: priorities.map((priority, index) => ({ fromUrl: `/from-${index}`, toUrl: `/to-${index}`, priority, ruleIds: [`link:${index}`] })), redirects: [], canonicalization: [], indexation: [] },
    } } }));
    expect(rendered).toContain("237 high-priority actions");
  });
  it("hides global blockers under incompatible combined work filters", () => {
    expect(globalBlockersVisible({ family: "all", priority: "all", state: "blocked", blocker: "review" })).toBe(true);
    expect(globalBlockersVisible({ family: "links", priority: "all", state: "blocked", blocker: "review" })).toBe(false);
    expect(globalBlockersVisible({ family: "all", priority: "high", state: "blocked", blocker: "review" })).toBe(false);
    expect(globalBlockersVisible({ family: "all", priority: "all", state: "candidate", blocker: "review" })).toBe(false);
  });
  it("filters pages against actual prohibited URL associations", () => {
    expect(pageMatchesBlockerFilter("/blocked", ["/blocked"], "blocked")).toBe(true);
    expect(pageMatchesBlockerFilter("/clear", ["/blocked"], "blocked")).toBe(false);
    expect(pageMatchesBlockerFilter("/clear", ["/blocked"], "clear")).toBe(true);
  });
  it("filters page priority by normalized bands while retaining original badge values", () => {
    expect(pageMatchesPriorityFilter("P0", "high")).toBe(true);
    expect(pageMatchesPriorityFilter("P1", "high")).toBe(true);
    expect(pageMatchesPriorityFilter("P2", "medium")).toBe(true);
    expect(pageMatchesPriorityFilter("P3", "low")).toBe(true);
    expect(priorityBadgeTone("P0")).toBe("critical");
    expect(priorityBadgeTone("P2")).toBe("attention");
    expect(priorityBadgeTone("P3")).toBe("info");
  });
  it("presents link work without inventing an unobserved blocked state", () => {
    const link = { fromUrl: "/blogs/news/source", toUrl: "/products/rice", ruleIds: ["link:1"] };
    expect(internalLinkPresentation(link, [{ kind: "link", candidateId: "candidate", fromUrl: link.fromUrl, toUrl: link.toUrl } as any], [])).toBe("candidate");
    expect(internalLinkPresentation({ ...link, fromUrl: "/pages/about" }, [], [])).toBe("managed");
    expect(internalLinkPresentation(link, [], [{ page: link.fromUrl, ruleIds: ["link:1"], reason: "observation_unavailable: link source was not inspected" } as any])).toBe("evidence_unavailable");
    expect(internalLinkPresentation(link, [], [])).toBe("neutral");
  });
});
