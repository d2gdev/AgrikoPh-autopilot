import { expect, it, vi } from "vitest";
import { applySelectedProposalResults, selectVisibleCandidateIds, submitSelectedMapProposals } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/map-proposal-action";
import type { MapAwareSeoGap } from "@/lib/seo/analysis";
import { ContentGapsPanel } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/panels/ContentGapsPanel";

const identity = { strategyVersionId: "v3", packageSha256: "a".repeat(64) };
const content = { ...identity, candidateId: "1".repeat(64), kind: "content", state: "candidate", action: "create", ruleIds: ["content:1"], query: "mapped", suggestedTitle: "Mapped guide", page: "/mapped", priority: "high", mapEvidence: null, observedEvidence: [], observation: { source: "store", capturedAt: "2026-07-13T00:00:00.000Z", provenance: "ArticleRecord:absence:/mapped" } } satisfies MapAwareSeoGap;
const link = { ...identity, candidateId: "2".repeat(64), kind: "link", state: "candidate", action: "update", ruleIds: ["link:1"], query: "anchor", suggestedTitle: "Add internal link", page: "/from", fromUrl: "/from", toUrl: "/to", priority: "medium", mapEvidence: null, observedEvidence: [], observation: { source: "link_inspection", capturedAt: "2026-07-13T00:00:00.000Z", provenance: "ArticleRecord.linksData:/from" } } satisfies MapAwareSeoGap;

it("submits only candidate IDs and retains failed selections for retry", async () => {
  const results = [
    { candidateId: content.candidateId, status: "created" as const, proposalId: "proposal-1" },
    { candidateId: link.candidateId, status: "failed" as const },
  ];
  const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results, counts: { created: 1, already_existing: 0, stale_or_blocked: 0, failed: 1 } }), { status: 200 }));
  const analysisIdentity = { ...identity, analysisGeneratedAt: "2026-07-14T00:00:00.000Z" };
  await expect(submitSelectedMapProposals(authFetch, analysisIdentity, [content.candidateId, link.candidateId])).resolves.toEqual(expect.objectContaining({ results }));
  expect(authFetch).toHaveBeenCalledWith("/api/seo/gaps/promote-selected", expect.objectContaining({ body: JSON.stringify({ ...analysisIdentity, candidateIds: [content.candidateId, link.candidateId] }) }));
  expect(applySelectedProposalResults(new Set([content.candidateId, link.candidateId]), new Set(), results)).toEqual({
    selected: new Set([link.candidateId]),
    done: new Set([content.candidateId]),
  });
});

it("selects and clears all currently visible candidates without disturbing hidden selections", () => {
  expect(selectVisibleCandidateIds(new Set(["hidden"]), [content.candidateId, link.candidateId], true)).toEqual(new Set(["hidden", content.candidateId, link.candidateId]));
  expect(selectVisibleCandidateIds(new Set(["hidden", content.candidateId, link.candidateId]), [content.candidateId, link.candidateId], false)).toEqual(new Set(["hidden"]));
});

it("does not render a published-page refresh as a content gap", () => {
  const refresh = { ...content, action: "refresh" as const, page: "/blogs/news/mapped", currentArticleTitle: "Current Shopify article", observedEvidence: [{ query: "mapped", impressions: 20, position: 9 }] };
  const commandCenter = { identity: { versionId: "v3", strategyVersion: "3", contractRevision: "3", packageSha256: identity.packageSha256, activatedAt: null }, pages: [{ url: "/blogs/news/mapped", title: "Mapped guide", primaryKeywordOrTheme: "mapped target query", decision: "refresh body content", contentDecisionPolicy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }], provenance: { "content:1": { sourceArtifactId: "map", sourceReferences: [] } } } as any;
  const rendered = JSON.stringify(ContentGapsPanel({ mapState: { state: "ready", generatedAt: "now", commandCenter }, analysisState: { state: "ready", generatedAt: "now", analysis: { gaps: [refresh], observations: [], suppressed: [] } }, selected: new Set(), done: new Set(), onToggle: vi.fn(), onSelectVisible: vi.fn() }));
  expect(rendered).toContain("No governed content gaps remain");
  expect(rendered).not.toContain("Refresh content");
  expect(rendered).not.toContain("Select for proposal");
  expect(rendered).not.toContain("Current Shopify article");
});

it("does not render a gated published-page refresh as a content gap", () => {
  const commandCenter = {
    identity: { versionId: "v3", strategyVersion: "3", contractRevision: "3", packageSha256: identity.packageSha256, activatedAt: null },
    pages: [{
      url: "/blogs/news/medical",
      title: "Map-owned medical guide",
      primaryKeywordOrTheme: "medical rice evidence",
      decision: "refresh and expand existing owner; medical review",
      evidence: "Clinical review is required before changes.",
      priority: "P0",
      contentDecisionPolicy: { resolutionStatus: "manual_gate", conditions: [], evidenceRequirements: [], reviewRequirements: [] },
      ruleIds: ["content:medical"],
    }],
    provenance: { "content:medical": { sourceArtifactId: "map", sourceReferences: [] } },
  } as any;
  const rendered = JSON.stringify(ContentGapsPanel({
    mapState: { state: "ready", generatedAt: "now", commandCenter },
    analysisState: { state: "ready", generatedAt: "now", analysis: { gaps: [], observations: [], suppressed: [{ ...identity, page: "/blogs/news/medical", reason: "manual_gate", ruleIds: ["content:medical"], currentArticleTitle: "Current medical article", observation: { source: "store", capturedAt: "2026-07-13T00:00:00.000Z", provenance: "ArticleRecord:news/medical" } }] } },
    selected: new Set(), done: new Set(), onToggle: vi.fn(), onSelectVisible: vi.fn(),
  }));

  expect(rendered).toContain("No governed content gaps remain");
  expect(rendered).not.toContain("Map-owned medical guide");
  expect(rendered).not.toContain("Current medical article");
  expect(rendered).not.toContain("Select for proposal");
});
