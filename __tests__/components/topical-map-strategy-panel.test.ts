import { describe, expect, it } from "vitest";
import { StrategyPackagePanel, type StrategyPackageOverview } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/StrategyPackagePanel";
import { readFileSync } from "node:fs";

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
    expect(gaps).toContain("Create proposal");
    expect(work).toContain("Create link proposal");
    expect(work).toContain("Live execution prohibited");
    expect(work).toContain("canonical live execution is prohibited");
    expect(work).toContain("indexation live execution is prohibited");
    expect(work).toContain("Redirect proposal persistence is not supported by Content Pilot");
    expect(work).not.toContain("Execution blocked");
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
