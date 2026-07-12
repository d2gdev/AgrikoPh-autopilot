import { describe, expect, it } from "vitest";
import { StrategyPackagePanel, type StrategyPackageOverview } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/StrategyPackagePanel";

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
