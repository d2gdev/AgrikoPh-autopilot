import { describe, expect, it } from "vitest";
import { StrategyPackagePanel, type StrategyPackageOverview } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/StrategyPackagePanel";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

function readRuntimeSources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return readRuntimeSources(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [readFileSync(path, "utf8")] : [];
  });
}

const activePackage: StrategyPackageOverview = {
  state: "ready",
  activeVersionId: "version-july-12",
  packages: [{
    id: "version-july-12",
    packageId: "agriko-topical-map-2026-07-12",
    strategyVersion: "2026-07-12",
    packageSha256: "100b4ba60036fc3a93f98fc81964962c564969db03d21613d2aeeac60e57cf5a",
    lifecycle: "active",
    validationStatus: "stale_evidence",
    evidenceDate: "2026-01-01T00:00:00.000Z",
    compiledRuleCount: 1493,
    validationIssues: [{ code: "STALE_MANDATORY_EVIDENCE", severity: "error", blocking: true, ruleId: "evidence:market", sourceArtifactId: "evidence" }],
    evidenceGates: [{ gateId: "evidence:market:0", ruleId: "evidence:market", mandatory: true, status: "stale", maxAgeDays: 180, ageDays: 192, blockingReason: "STALE_MANDATORY_EVIDENCE" }],
    compliance: { counts: { conflict: 2, needs_evidence: 1 }, recent: [{ result: "conflict", matchedRuleIds: ["owner:rice"], evidenceGates: ["evidence:market:0"], sourceArtifactIds: ["url-inventory"] }] },
    auditTimeline: [{ action: "topical_map_strategy_activated", occurredAt: "2026-07-12T01:00:00.000Z", actor: "operator", reason: "reviewed" }],
    lifecycleControls: { canActivate: false, canRollback: false, reason: "Runtime activation is unauthorized for this package." },
  }],
};

function text(value: unknown) { return JSON.stringify(value); }

describe("StrategyPackagePanel", () => {
  it("shows active identity, stale mandatory evidence, validation, compliance, traceability, and audit evidence", () => {
    const rendered = text(StrategyPackagePanel({ strategy: activePackage }));

    expect(rendered).toContain("Active strategy package");
    expect(rendered).toContain("agriko-topical-map-2026-07-12");
    expect(rendered).toContain("100b4ba60036");
    expect(rendered).toContain("Stale mandatory evidence");
    expect(rendered).toContain("evidence:market:0");
    expect(rendered).toContain("STALE_MANDATORY_EVIDENCE");
    expect(rendered).toContain("conflict");
    expect(rendered).toContain("2");
    expect(rendered).toContain("owner:rice");
    expect(rendered).toContain("url-inventory");
    expect(rendered).toContain("topical_map_strategy_activated");
  });

  it("keeps unavailable and partial package states explicit without rendering raw package bytes or lifecycle actions", () => {
    const unavailable = text(StrategyPackagePanel({ strategy: { state: "unavailable", message: "Strategy governance data is unavailable." } }));
    const partial = text(StrategyPackagePanel({ strategy: { state: "partial", message: "Some strategy governance data could not be loaded.", packages: activePackage.packages } }));

    expect(unavailable).toContain("Strategy governance data is unavailable.");
    expect(partial).toContain("Some strategy governance data could not be loaded.");
    expect(partial).toContain("Stale mandatory evidence");
    expect(partial).toContain("Activation unavailable");
    expect(partial).not.toContain("Activate strategy");
    expect(partial).not.toContain("Rollback strategy");
    expect(partial).not.toContain("rawContent");
    expect(partial).not.toContain("compiledPayload");
  });
});

describe("topical-map command center", () => {
  const read = (file: string) => readFileSync(file, "utf8");
  const page = read("app/(embedded)/(seo-pillar)/seo-pillar/page.tsx");
  const overview = read("app/(embedded)/(seo-pillar)/seo-pillar/components/panels/MapOverviewPanel.tsx");
  const pages = read("app/(embedded)/(seo-pillar)/seo-pillar/components/panels/MapPagesPanel.tsx");
  const work = read("app/(embedded)/(seo-pillar)/seo-pillar/components/panels/MapWorkPanel.tsx");
  const gaps = read("app/(embedded)/(seo-pillar)/seo-pillar/components/panels/ContentGapsPanel.tsx");
  const evidence = read("app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OpportunitiesPanel.tsx");
  const dataHook = read("app/(embedded)/(seo-pillar)/seo-pillar/components/useSeoData.ts");

  it("has no runtime fallback to the legacy June strategy", () => {
    const runtimeSeoSources = [
      ...readRuntimeSources("app/(embedded)/(seo-pillar)/seo-pillar"),
      ...readRuntimeSources("lib/seo"),
    ];
    const forbidden = ["KEYWORD_CLUSTERS", "PRIMARY_TARGETS", "SECONDARY_BANK", "ROADMAP", "June 2026 keyword research report", "keyword-strategy"];

    for (const token of forbidden) expect(runtimeSeoSources.join("\n")).not.toContain(token);
  });

  it("contains no unreachable panels or handlers beyond the five-tab cutover", () => {
    for (const token of [
      "PillarClustersPanel",
      "PageHealthPanel",
      "OpportunityClustersPanel",
      "promoteGaps",
      "promoteOnPage",
      "planStrategy",
      "tab === 5",
      "tab === 6",
      "tab === 7",
    ]) {
      expect(page).not.toContain(token);
    }
    for (const endpoint of ["/api/seo/health", "/api/seo/keywords", "/api/content-pilot/topic-clusters", "/api/topical-map/packages"]) {
      expect(dataHook).not.toContain(endpoint);
    }
  });

  it("rebuilds navigation around the five operator jobs", () => {
    expect(page).toContain('label: "Map overview"');
    expect(page).toContain('label: "Pages & ownership"');
    expect(page).toContain('label: "Content gaps"');
    expect(page).toContain('label: "Links & technical"');
    expect(page).toContain('label: "Search evidence"');
    expect(page).not.toContain("June 2026 keyword research report");
  });

  it("shows active identity, all eleven domains, labelled filters, and provenance", () => {
    expect(overview).toContain("Active package");
    for (const domain of ["clusters", "page_roles", "url_intent_ownership", "content_decisions", "prohibited_content", "internal_links", "redirects", "canonicalization", "indexation", "evidence_gates", "high_stakes_reviews"]) {
      expect(overview).toContain(domain);
    }
    for (const label of ["Filter by cluster", "Filter by priority", "Filter by rule family", "Filter by state", "Filter by blocker"]) {
      expect(pages + work).toContain(label);
    }
    expect(pages + work + gaps).toContain("Rule provenance");
    expect(pages + work + gaps).toContain("sourceReferences");
  });

  it("keeps governed actions capable and technical execution truthful", () => {
    expect(gaps).toContain("Select for proposal");
    expect(work).toContain("Select for proposal");
    expect(work).toContain("Managed in Store Pilot");
    expect(work).toContain("Store Pilot observation determines");
    expect(work).not.toContain("map.work.redirects.filter(row => visible");
    expect(work).toContain("Live execution prohibited");
    expect(work).toContain("canonical live execution is prohibited");
    expect(work).toContain("indexation live execution is prohibited");
    expect(work).toContain("conflicting source redirects remain advisory");
    expect(work).not.toContain("Execution blocked");
  });

  it("uses accurate gate and review terminology", () => {
    expect(overview).toContain("evidence gates");
    expect(overview).toContain("high-stakes review requirements");
    expect(overview).not.toContain("evidence blockers");
    expect(overview).not.toContain("review blockers");
  });

  it("separates raw observations and renders five distinct unavailable states", () => {
    expect(evidence).toContain("Search evidence observations");
    expect(evidence).toContain("No map rule association");
    expect(evidence).toContain("future map revision");
    for (const copy of ["Loading the active topical map", "No active topical map", "Strategy command center unavailable", "Analysis belongs to an earlier strategy", "No map-bound analysis yet"]) {
      expect(page + gaps).toContain(copy);
    }
  });
});
