import { ALL_TOPICAL_MAP_DOMAINS, projectTopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { describe, expect, it } from "vitest";

const ref = (coverageUnitId: string) => ({ coverageUnitId, artifactId: "map", locator: { kind: "markdown_heading", headingPath: ["Map"] } });
const rule = (ruleId: string, ruleType: string, payload: Record<string, unknown>, sourceArtifactId = "map") => ({ ruleId, ruleType, payload: { ...payload, rawContent: "SECRET" }, sourceArtifactId, sourceReferences: [ref(`coverage:${ruleId}`)] });

describe("projectTopicalMapCommandCenter", () => {
  it("projects all compiled domains into a bounded deterministic operator model", () => {
    const url = "https://agrikoph.com/blogs/news/black-rice";
    const rules = [
      rule("rule:cluster:1", "clusters", { cluster: "Black rice", memberUrls: [url] }),
      rule("rule:role:1", "page_roles", { currentUrl: url, cluster: "Black rice", role: "supporting", priority: "high" }),
      rule("rule:owner:1", "url_intent_ownership", { currentUrl: "/blogs/news/black-rice", primaryKeywordOrTheme: "black rice", dominantIntent: "informational", exclusiveIntentScope: "black rice education", priority: "high" }),
      rule("rule:decision:1", "content_decisions", { currentUrl: url, decision: "keep", exactTargetIfAny: "", priority: "high", evidence: "Traffic supported" }),
      rule("rule:prohibited:1", "prohibited_content", { currentUrl: url, decision: "prohibit", exactTargetIfAny: "medical claims", priority: "critical", evidence: "Unsafe" }),
      rule("rule:link:1", "internal_links", { fromUrl: url, toUrl: "/collections/rice", currentBodyState: "missing", requiredAction: "add", recommendedAnchor: "rice", linkPurpose: "commercial path", priority: "high", verification: "inspect" }, "internal-links"),
      rule("rule:redirect:1", "redirects", { redirectId: "r1", source: "/old", configuredTarget: "/blogs/news/black-rice", finalTarget: url, hopCount: "1", topicRelevant: "yes", knownState: "configured", requiredAction: "retain" }, "redirect-inventory"),
      rule("rule:canonical:1", "canonicalization", { currentUrl: url, proposedCanonicalUrl: "/blogs/news/black-rice", priority: "medium", decision: "review", evidence: "read only" }),
      rule("rule:index:1", "indexation", { currentUrl: url, proposedCanonicalUrl: "/blogs/news/black-rice", publishingState: "published", priority: "medium", decision: "index", evidence: "read only" }),
      rule("rule:evidence:1", "evidence_gates", { name: "Fresh SERP evidence", literalText: "Evidence must be current" }, "evidence"),
      rule("rule:review:1", "high_stakes_reviews", { name: "Medical review", literalText: "Manual review required" }, "evidence"),
    ];
    const projected = projectTopicalMapCommandCenter({ strategy: { id: "v3", strategyVersion: "2026-07-12", contractRevision: "3", packageSha256: "abc", activatedAt: new Date("2026-07-12T00:00:00Z") }, rules });

    expect(projected.identity).toEqual({ versionId: "v3", strategyVersion: "2026-07-12", contractRevision: "3", packageSha256: "abc", activatedAt: "2026-07-12T00:00:00.000Z" });
    expect(Object.keys(projected.domainCounts).sort()).toEqual(ALL_TOPICAL_MAP_DOMAINS.slice().sort());
    expect(Object.values(projected.domainCounts)).toEqual(expect.arrayContaining(Array(11).fill(1)));
    expect(projected.clusters[0]).toMatchObject({ name: "Black rice", memberUrls: ["/blogs/news/black-rice"], ruleIds: ["rule:cluster:1"] });
    expect(projected.pages[0]).toMatchObject({ url: "/blogs/news/black-rice", cluster: "Black rice", role: "supporting", dominantIntent: "informational", decision: "keep", ruleIds: ["rule:decision:1", "rule:owner:1", "rule:role:1"] });
    expect(projected.prohibited[0]).toMatchObject({ url: "/blogs/news/black-rice", item: "medical claims", ruleIds: ["rule:prohibited:1"] });
    expect(projected.work.internalLinks[0]).toMatchObject({ fromUrl: "/blogs/news/black-rice", toUrl: "/collections/rice", ruleIds: ["rule:link:1"] });
    expect(projected.work.redirects[0].ruleIds).toEqual(["rule:redirect:1"]);
    expect(projected.work.canonicalization[0].ruleIds).toEqual(["rule:canonical:1"]);
    expect(projected.work.indexation[0].ruleIds).toEqual(["rule:index:1"]);
    expect(projected.blockers.evidence[0]).toMatchObject({ name: "Fresh SERP evidence", ruleIds: ["rule:evidence:1"] });
    expect(projected.blockers.reviews[0]).toMatchObject({ name: "Medical review", ruleIds: ["rule:review:1"] });
    expect(projected.provenance["rule:link:1"]).toMatchObject({ sourceArtifactId: "internal-links", sourceReferences: [expect.objectContaining({ coverageUnitId: "coverage:rule:link:1" })] });
    expect(JSON.stringify(projected)).not.toContain("rawContent");
    expect(JSON.stringify(projected)).not.toContain("SECRET");
  });

  it("rejects unknown compiled rule domains", () => {
    expect(() => projectTopicalMapCommandCenter({ strategy: { id: "v", strategyVersion: "1", contractRevision: "1", packageSha256: "x", activatedAt: null }, rules: [rule("rule:x", "unknown", {})] })).toThrow("UNKNOWN_TOPICAL_MAP_DOMAIN");
  });
});
