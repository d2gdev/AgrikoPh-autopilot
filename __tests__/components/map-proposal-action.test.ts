import { describe, expect, it, vi } from "vitest";
import { submitMapProposal } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/map-proposal-action";
import type { MapAwareSeoGap } from "@/lib/seo/analysis";
import { ContentGapsPanel } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/panels/ContentGapsPanel";

const identity = { strategyVersionId: "v3", packageSha256: "a".repeat(64) };
const content = { ...identity, kind: "content", state: "candidate", action: "create", ruleIds: ["content:1"], query: "mapped", suggestedTitle: "Mapped guide", page: "/mapped", priority: "high", mapEvidence: null, observedEvidence: [] } satisfies MapAwareSeoGap;
const link = { ...identity, kind: "link", state: "candidate", action: "update", ruleIds: ["link:1"], query: "anchor", suggestedTitle: "Add internal link", page: "/from", fromUrl: "/from", toUrl: "/to", priority: "medium", mapEvidence: null, observedEvidence: [] } satisfies MapAwareSeoGap;

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

it("renders a mapped refresh candidate as an actionable refresh", () => {
  const refresh = { ...content, action: "refresh" as const, page: "/blogs/news/mapped", observedEvidence: [{ query: "mapped", impressions: 20, position: 9 }] };
  const commandCenter = { identity: { versionId: "v3", strategyVersion: "3", contractRevision: "3", packageSha256: identity.packageSha256, activatedAt: null }, provenance: { "content:1": { sourceArtifactId: "map", sourceReferences: [] } } } as any;
  const rendered = JSON.stringify(ContentGapsPanel({ mapState: { state: "ready", generatedAt: "now", commandCenter }, analysisState: { state: "ready", analysis: { gaps: [refresh], observations: [], suppressed: [] } }, busy: new Set(), done: new Set(), onPropose: vi.fn() }));
  expect(rendered).toContain("Refresh content");
  expect(rendered).toContain("Create proposal");
  expect(rendered).toContain("20 impressions");
});
