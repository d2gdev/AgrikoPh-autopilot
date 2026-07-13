import { describe, expect, it } from "vitest";
import { analysisEvidenceState, buildMapAwareSeoGaps, buildProgrammaticSeoGaps, readAnalysisForStrategy } from "@/lib/seo/analysis";
import type { TopicalMapCommandCenter } from "@/lib/topical-map/command-center";

describe("buildProgrammaticSeoGaps", () => {
  it("keeps thin-content and missing-meta findings for the same article", () => {
    const gaps = buildProgrammaticSeoGaps({
      queries: [],
      queryPagePairs: [],
      articles: [{
        handle: "thin-and-meta",
        title: "Thin and Meta",
        wordCount: 120,
        internalLinkCount: 0,
        seoData: { issues: ["missing-meta-description"] },
      }],
    });
    expect(gaps.map((gap) => gap.issue)).toEqual(["thin-content", "missing-meta"]);
  });

  it("does not suppress a meta finding because another title shares its prefix", () => {
    const gaps = buildProgrammaticSeoGaps({
      queries: [{ query: "black rice benefits", clicks: 0, impressions: 100, ctr: "0%", position: "8" }],
      queryPagePairs: [],
      articles: [{
        handle: "black-rice",
        title: "Black Rice",
        wordCount: 700,
        internalLinkCount: 2,
        seoData: { titleLength: 0 },
      }],
    });
    expect(gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ articleHandle: "black-rice", issue: "missing-meta" }),
    ]));
  });

  it("selects high-impression eligible gaps before applying the query limit", () => {
    const clickSortedIneligible = Array.from({ length: 30 }, (_, index) => ({
      query: `ranking query ${index}`,
      clicks: 1,
      impressions: 10,
      ctr: "10%",
      position: "1",
    }));

    const gaps = buildProgrammaticSeoGaps({
      queries: [
        ...clickSortedIneligible,
        {
          query: "organic black rice philippines",
          clicks: 0,
          impressions: 10_000,
          ctr: "0%",
          position: "8",
        },
      ],
      queryPagePairs: [],
      articles: [],
    });

    expect(gaps).toEqual([
      expect.objectContaining({
        query: "organic black rice philippines",
        impressions: 10_000,
        position: 8,
      }),
    ]);
  });

  it("does not treat long-query term overlap as fully covered when only half the terms match", () => {
    const gaps = buildProgrammaticSeoGaps({
      queries: [{
        query: "black rice price philippines",
        clicks: 10,
        impressions: 200,
        ctr: "3%",
        position: "10",
      }],
      queryPagePairs: [],
      articles: [{
        handle: "black-rice",
        title: "Black Rice",
        wordCount: 1000,
        internalLinkCount: 8,
        seoData: { titleLength: 0 },
      }],
    });

    expect(gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ query: "black rice price philippines" }),
    ]));
  });
});

describe("map-aware SEO analysis", () => {
  const identity = { versionId: "v3", packageSha256: "a".repeat(64) };
  const commandCenter: TopicalMapCommandCenter = {
    identity: { ...identity, strategyVersion: "3", contractRevision: "3", activatedAt: null },
    domainCounts: { clusters: 0, page_roles: 0, url_intent_ownership: 0, content_decisions: 2, prohibited_content: 1, internal_links: 1, redirects: 0, canonicalization: 0, indexation: 0, evidence_gates: 0, high_stakes_reviews: 0 },
    clusters: [],
    pages: [
      { url: "/blogs/news/mapped", decision: "create", primaryKeywordOrTheme: "mapped topic", priority: "high", ruleIds: ["rule:decision:1"], ruleDomains: { content_decisions: ["rule:decision:1"] } },
      { url: "/blogs/news/prohibited", decision: "create", primaryKeywordOrTheme: "medical cure", ruleIds: ["rule:decision:2"], ruleDomains: { content_decisions: ["rule:decision:2"] } },
    ],
    prohibited: [{ url: "/blogs/news/prohibited", item: "Do not publish medical cure claims", ruleIds: ["rule:prohibited:1"] }],
    work: { internalLinks: [{ fromUrl: "/blogs/news/source", toUrl: "/blogs/news/mapped", currentBodyState: "absent", ruleIds: ["rule:link:1"] }], redirects: [], canonicalization: [], indexation: [] },
    blockers: { evidence: [], reviews: [] },
    provenance: {},
  };

  it("keeps unmapped search demand as an observation but only maps governed candidates", () => {
    const result = buildMapAwareSeoGaps({
      strategy: identity, commandCenter,
      queries: [{ query: "unmapped popular query", clicks: 0, impressions: 900, ctr: "0%", position: "8" }],
      queryPagePairs: [], articles: [{ handle: "source", title: "Source", wordCount: 500, internalLinkCount: 0, seoData: {} }],
    });
    expect(result.observations).toEqual([expect.objectContaining({ query: "unmapped popular query" })]);
    expect(result.gaps).toContainEqual(expect.objectContaining({ kind: "content", strategyVersionId: "v3", ruleIds: ["rule:decision:1"], state: "candidate" }));
    expect(result.gaps).toContainEqual(expect.objectContaining({ kind: "content", priority: "high", observedEvidence: [] }));
    expect(result.gaps).toContainEqual(expect.objectContaining({ kind: "link", ruleIds: ["rule:link:1"], state: "candidate" }));
    expect(result.gaps).not.toEqual(expect.arrayContaining([expect.objectContaining({ query: "unmapped popular query" })]));
    expect(result.suppressed).toContainEqual(expect.objectContaining({ ruleIds: ["rule:decision:2", "rule:prohibited:1"], reason: "Do not publish medical cure claims" }));
  });

  it("emits an existing mapped page with a refresh decision as an actionable refresh with page evidence", () => {
    const refreshMap: TopicalMapCommandCenter = { ...commandCenter, pages: [{ url: "/blogs/news/source", decision: "optimize", evidence: "Preserve the winning intent while improving clarity.", primaryKeywordOrTheme: "source topic", priority: "medium", ruleIds: ["opaque-42"], ruleDomains: { content_decisions: ["opaque-42"] } }], prohibited: [] };
    const result = buildMapAwareSeoGaps({ strategy: identity, commandCenter: refreshMap, queries: [{ query: "source topic", clicks: 4, impressions: 120, ctr: "3%", position: "9" }], queryPagePairs: [{ query: "source topic", page: "https://agrikoph.com/blogs/news/source", clicks: 4, impressions: 120, position: "9" }], articles: [{ handle: "source", title: "Source", wordCount: 500, internalLinkCount: 0, seoData: {} }] });
    expect(result.gaps).toContainEqual(expect.objectContaining({ kind: "content", action: "refresh", page: "/blogs/news/source", query: "source topic", priority: "medium", mapEvidence: "Preserve the winning intent while improving clarity.", ruleIds: ["opaque-42"], observedEvidence: [{ query: "source topic", impressions: 120, position: 9 }] }));
  });

  it("requires exact inspected link absence and blocks present or uninspectable pairs", () => {
    const base = { strategy: identity, commandCenter, queries: [], queryPagePairs: [], articles: [{ handle: "source", title: "Source", wordCount: 500, internalLinkCount: 0, seoData: {} }] };
    const absent = buildMapAwareSeoGaps({ ...base, linkInspections: new Map([["/blogs/news/source", { capturedAt: new Date(), targets: new Set<string>() }]]) });
    expect(absent.gaps).toContainEqual(expect.objectContaining({ kind: "link", fromUrl: "/blogs/news/source", toUrl: "/blogs/news/mapped" }));
    const present = buildMapAwareSeoGaps({ ...base, linkInspections: new Map([["/blogs/news/source", { capturedAt: new Date(), targets: new Set(["/blogs/news/mapped"]) }]]) });
    expect(present.gaps).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: "link" })]));
    const unavailable = buildMapAwareSeoGaps({ ...base, linkInspections: new Map() });
    expect(unavailable.suppressed).toContainEqual(expect.objectContaining({ reason: expect.stringContaining("observation_unavailable"), ruleIds: ["rule:link:1"] }));
  });

  it("does not claim unverified non-blog page absence", () => {
    const map: TopicalMapCommandCenter = { ...commandCenter, pages: [{ url: "/pages/unknown", decision: "create", priority: "high", ruleIds: ["opaque"], ruleDomains: { content_decisions: ["opaque"] } }], prohibited: [] };
    const result = buildMapAwareSeoGaps({ strategy: identity, commandCenter: map, queries: [], queryPagePairs: [], articles: [], verifiedAbsentUrls: new Set() });
    expect(result.gaps).toEqual(expect.not.arrayContaining([expect.objectContaining({ page: "/pages/unknown" })]));
    expect(result.suppressed).toContainEqual(expect.objectContaining({ page: "/pages/unknown", reason: expect.stringContaining("observation_unavailable") }));
  });

  it("accepts cached analysis only for the exact active identity", () => {
    const analysis = { gaps: [], observations: [], suppressed: [] };
    const envelope = { schemaVersion: "2", strategy: identity, generatedAt: "2026-07-13T00:00:00.000Z", analysis, evidence: { gscCapturedAt: "2026-07-13T00:00:00.000Z", storeCapturedAt: "2026-07-13T00:00:00.000Z", linkCapturedAt: "2026-07-13T00:00:00.000Z", maxAgeHours: 72 } };
    expect(readAnalysisForStrategy(envelope, identity)).toEqual(analysis);
    expect(readAnalysisForStrategy(envelope, { ...identity, versionId: "v4" })).toBeNull();
    expect(readAnalysisForStrategy(envelope, { ...identity, packageSha256: "b".repeat(64) })).toBeNull();
  });

  it("enforces the 72-hour evidence boundary and unavailable observations", () => {
    const payload = (capturedAt: string | null) => ({ schemaVersion: "2", strategy: identity, generatedAt: "2026-07-13T00:00:00.000Z", analysis: { gaps: [], observations: [], suppressed: [] }, evidence: { gscCapturedAt: capturedAt, storeCapturedAt: capturedAt, linkCapturedAt: capturedAt, maxAgeHours: 72 } });
    expect(analysisEvidenceState(payload("2026-07-10T00:00:00.000Z"), new Date("2026-07-13T00:00:00.000Z"))).toBe("current");
    expect(analysisEvidenceState(payload("2026-07-09T23:59:59.999Z"), new Date("2026-07-13T00:00:00.000Z"))).toBe("evidence_stale");
    expect(analysisEvidenceState(payload(null), new Date("2026-07-13T00:00:00.000Z"))).toBe("observation_unavailable");
  });

  it("rejects a malformed cached gap and a per-gap identity mismatch", () => {
    const validGap = { kind: "content", strategyVersionId: "v3", packageSha256: "a".repeat(64), ruleIds: ["rule:1"], state: "candidate", action: "create", query: "mapped", suggestedTitle: "Mapped guide", page: "/blogs/news/mapped", priority: "high", mapEvidence: null, observedEvidence: [{ query: "mapped", impressions: 12, position: 8 }] };
    const envelope = (gap: unknown) => ({ schemaVersion: "2", strategy: identity, generatedAt: "2026-07-13T00:00:00.000Z", analysis: { gaps: [gap], observations: [], suppressed: [] }, evidence: { gscCapturedAt: "2026-07-13T00:00:00.000Z", storeCapturedAt: "2026-07-13T00:00:00.000Z", linkCapturedAt: "2026-07-13T00:00:00.000Z", maxAgeHours: 72 } });
    expect(readAnalysisForStrategy(envelope({ ...validGap, ruleIds: [] }), identity)).toBeNull();
    expect(readAnalysisForStrategy(envelope({ ...validGap, strategyVersionId: "v4" }), identity)).toBeNull();
    expect(readAnalysisForStrategy(envelope({ ...validGap, packageSha256: "b".repeat(64) }), identity)).toBeNull();
  });
});
