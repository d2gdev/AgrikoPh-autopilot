import { describe, expect, it, vi } from "vitest";
import { applySelectedProposalResults, selectVisibleCandidateIds, submitMapProposal, submitSelectedMapProposals } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/map-proposal-action";
import type { MapAwareSeoGap } from "@/lib/seo/analysis";
import { ContentGapsPanel } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/panels/ContentGapsPanel";

const identity = { strategyVersionId: "v3", packageSha256: "a".repeat(64) };
const content = { ...identity, candidateId: "1".repeat(64), kind: "content", state: "candidate", action: "create", ruleIds: ["content:1"], query: "mapped", suggestedTitle: "Mapped guide", page: "/mapped", priority: "high", mapEvidence: null, observedEvidence: [], observation: { source: "store", capturedAt: "2026-07-13T00:00:00.000Z", provenance: "ArticleRecord:absence:/mapped" } } satisfies MapAwareSeoGap;
const link = { ...identity, candidateId: "2".repeat(64), kind: "link", state: "candidate", action: "update", ruleIds: ["link:1"], query: "anchor", suggestedTitle: "Add internal link", page: "/from", fromUrl: "/from", toUrl: "/to", priority: "medium", mapEvidence: null, observedEvidence: [], observation: { source: "link_inspection", capturedAt: "2026-07-13T00:00:00.000Z", provenance: "ArticleRecord.linksData:/from" } } satisfies MapAwareSeoGap;

describe.each([["content", content], ["internal link", link]])("map proposal action: %s", (_label, gap) => {
  it("submits exact strategy identity and reports created feedback", async () => {
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ created: 1, skipped: 0 }), { status: 200 }));
    const result = await submitMapProposal(authFetch, gap);
    expect(authFetch).toHaveBeenCalledWith("/api/seo/gaps/promote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...identity, gaps: [gap] }) });
    expect(result).toEqual({ resolved: true, message: "Created governed proposal in Content Pilot." });
  });
  it("reports already-handled and failed responses truthfully", async () => {
    const skipped = vi.fn().mockResolvedValue(new Response(JSON.stringify({ created: 0, skipped: 1 }), { status: 200 }));
    await expect(submitMapProposal(skipped, gap)).resolves.toEqual({ resolved: true, message: "This governed proposal is already handled." });
    const failed = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Active strategy changed" }), { status: 409 }));
    await expect(submitMapProposal(failed, gap)).resolves.toEqual({ resolved: false, message: "Active strategy changed" });
  });
});

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

it("renders a mapped refresh candidate as an actionable refresh", () => {
  const refresh = { ...content, action: "refresh" as const, page: "/blogs/news/mapped", observedEvidence: [{ query: "mapped", impressions: 20, position: 9 }] };
  const commandCenter = { identity: { versionId: "v3", strategyVersion: "3", contractRevision: "3", packageSha256: identity.packageSha256, activatedAt: null }, provenance: { "content:1": { sourceArtifactId: "map", sourceReferences: [] } } } as any;
  const rendered = JSON.stringify(ContentGapsPanel({ mapState: { state: "ready", generatedAt: "now", commandCenter }, analysisState: { state: "ready", generatedAt: "now", analysis: { gaps: [refresh], observations: [], suppressed: [] } }, selected: new Set(), done: new Set(), onToggle: vi.fn(), onSelectVisible: vi.fn() }));
  expect(rendered).toContain("Refresh content");
  expect(rendered).toContain("Select for proposal");
  expect(rendered).toContain("20 impressions");
  expect(rendered).toContain("Mapped guide");
  expect(rendered).toContain("Target keyword:");
  expect(rendered).toContain("mapped");
  expect(rendered).toContain("Governed target URL:");
  expect(rendered).toContain("/blogs/news/mapped");
});
