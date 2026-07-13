import { describe, expect, it, vi } from "vitest";
import { submitMapProposal } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/map-proposal-action";
import type { MapAwareSeoGap } from "@/lib/seo/analysis";

const identity = { strategyVersionId: "v3", packageSha256: "a".repeat(64) };
const content = { ...identity, kind: "content", state: "candidate", action: "create", ruleIds: ["content:1"], query: "mapped", suggestedTitle: "Mapped guide", page: "/mapped", priority: "high", observedEvidence: [] } satisfies MapAwareSeoGap;
const link = { ...identity, kind: "link", state: "candidate", action: "update", ruleIds: ["link:1"], query: "anchor", suggestedTitle: "Add internal link", page: "/from", fromUrl: "/from", toUrl: "/to", priority: "medium", observedEvidence: [] } satisfies MapAwareSeoGap;

describe.each([["content", content], ["internal link", link]])("map proposal action: %s", (_label, gap) => {
  it("submits exact strategy identity and reports created feedback", async () => {
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ created: 1, skipped: 0 }), { status: 200 }));
    const result = await submitMapProposal(authFetch, gap);
    expect(authFetch).toHaveBeenCalledWith("/api/seo/gaps/promote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...identity, gaps: [gap] }) });
    expect(result).toEqual({ resolved: true, message: "Created governed proposal in Content Pilot." });
  });
});
