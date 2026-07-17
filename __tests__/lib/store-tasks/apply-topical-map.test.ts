import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const adapter = vi.hoisted(() => ({ fetch: vi.fn(), apply: vi.fn(), fetchRedirects: vi.fn(), createRedirect: vi.fn(), updateRedirect: vi.fn(), deleteRedirect: vi.fn() }));
const command = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/shopify-governed-resources", async (original) => ({ ...(await original<typeof import("@/lib/shopify-governed-resources")>()), fetchGovernedStoreResource: adapter.fetch, applyGovernedStoreResourceChange: adapter.apply, fetchGovernedRedirects: adapter.fetchRedirects, createGovernedRedirect: adapter.createRedirect, updateGovernedRedirect: adapter.updateRedirect, deleteGovernedRedirect: adapter.deleteRedirect }));
vi.mock("@/lib/topical-map/command-center", () => ({ loadActiveTopicalMapCommandCenter: command.load }));
import { approveTopicalMapStoreTask, dispatchClaimedTopicalMapStoreTask, reobserveTopicalMapReceipt, TopicalMapApplyError } from "@/lib/store-tasks/apply-topical-map";
import { hashTopicalMapProposedState } from "@/lib/store-tasks/topical-map";

const source = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["rule-1"], ruleDomains: ["content_decisions"], sourceReferences: [{ kind: "rule", id: "rule-1" }], generationProvenance: "bounded_ai_draft", targetType: "product", targetUrl: "/products/rice", action: "seo_update", observedAt: "2026-07-13T00:00:00.000Z", observedStateHash: "b".repeat(64), recommendationId: "rec-1", executable: true };
const proposed = { action: "seo_update", before: { seoTitle: "Old", seoDescription: "Old desc" }, after: { seoTitle: "New", seoDescription: "New desc" } };
const task = { id: "task-1", status: "pending", sourceData: source, proposedState: proposed };
const resource = { id: "gid://shopify/Product/1", type: "product", url: "/products/rice", handle: "rice", title: "Rice", seoTitle: "Old", seoDescription: "Old desc", bodyHtml: "body", updatedAt: new Date(source.observedAt), stateHash: source.observedStateHash, internalTargets: [] };
const rec = { id: "rec-1", platform: "shopify", actionType: "apply_topical_map_store_task", targetEntityId: "task-1", status: "executing", proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(proposed) }) };
function db() {
  const tx = { recommendation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, storeTask: { update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, storeTaskExecutionLock: { deleteMany: vi.fn(), create: vi.fn() }, auditLog: { create: vi.fn() } };
  return { storeTask: { findUnique: vi.fn().mockResolvedValue(task) }, $transaction: vi.fn(async (fn) => fn(tx)), _tx: tx };
}
beforeEach(() => { vi.clearAllMocks(); adapter.fetch.mockReset(); adapter.apply.mockReset(); adapter.fetchRedirects.mockReset(); adapter.createRedirect.mockReset(); adapter.updateRedirect.mockReset(); adapter.deleteRedirect.mockReset(); command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [{ url: "/products/rice", decision: "Improve SEO metadata", contentDecisionPolicy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] }, ruleDomains: { content_decisions: ["rule-1"] } }], work: { internalLinks: [], redirects: [] } }); adapter.fetch.mockResolvedValue(resource); adapter.apply.mockResolvedValue({ ...resource, seoTitle: "New", seoDescription: "New desc", stateHash: "c".repeat(64) }); adapter.fetchRedirects.mockResolvedValue(new Map()); });
afterEach(() => vi.unstubAllEnvs());

describe("topical-map approval and internal dispatch", () => {
  it("creates only a still-absent exact governed redirect", async () => {
    const redirectSource = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["redirect:1"], ruleDomains: ["redirects"], sourceReferences: [{ kind: "rule", id: "redirect:1" }], generationProvenance: "deterministic", targetType: "redirect", targetUrl: "/old", action: "redirect_create", redirectTarget: "/products/rice", observedAt: "2026-07-14T00:00:00.000Z", observedStateHash: "d".repeat(64), recommendationId: "rec-1", executable: true };
    const redirectProposed = { action: "redirect_create", before: { state: "absent" }, after: { target: "/products/rice" } };
    const redirectRec = { ...rec, proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(redirectProposed) }) };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: redirectSource, proposedState: redirectProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [], redirects: [{ source: "/old", finalTarget: "/products/rice", ruleIds: ["redirect:1"], policy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }] } });
    adapter.createRedirect.mockResolvedValue({ id: "gid://shopify/UrlRedirect/1", source: "/old", target: "/products/rice", capturedAt: new Date(), stateHash: "e".repeat(64) });

    const receipt = await dispatchClaimedTopicalMapStoreTask(client as any, redirectRec as any);

    expect(adapter.fetchRedirects).toHaveBeenCalledWith(["/old"]);
    expect(adapter.createRedirect).toHaveBeenCalledWith("/old", "/products/rice");
    expect(receipt).toMatchObject({ targetType: "redirect", targetUrl: "/old", action: "redirect_create", changedFields: ["target"] });
  });

  it("blocks a redirect when its source appeared before execution", async () => {
    const redirectSource = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["redirect:1"], ruleDomains: ["redirects"], sourceReferences: [{ kind: "rule", id: "redirect:1" }], generationProvenance: "deterministic", targetType: "redirect", targetUrl: "/old", action: "redirect_create", redirectTarget: "/products/rice", observedAt: "2026-07-14T00:00:00.000Z", observedStateHash: "d".repeat(64), recommendationId: "rec-1", executable: true };
    const redirectProposed = { action: "redirect_create", before: { state: "absent" }, after: { target: "/products/rice" } };
    const redirectRec = { ...rec, proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(redirectProposed) }) };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: redirectSource, proposedState: redirectProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [], redirects: [{ source: "/old", finalTarget: "/products/rice", ruleIds: ["redirect:1"], policy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }] } });
    adapter.fetchRedirects.mockResolvedValue(new Map([["/old", { id: "existing", source: "/old", target: "/pages/conflict", capturedAt: new Date(), stateHash: "f".repeat(64) }]]));

    await expect(dispatchClaimedTopicalMapStoreTask(client as any, redirectRec as any)).rejects.toMatchObject({ code: "OBSERVATION_CHANGED" });
    expect(adapter.createRedirect).not.toHaveBeenCalled();
  });
  it("updates only the exact observed redirect after revalidating its rule and state", async () => {
    const redirectSource = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["redirect:update"], ruleDomains: ["redirects"], sourceReferences: [{ kind: "rule", id: "redirect:update" }], generationProvenance: "deterministic", targetType: "redirect", targetUrl: "/old", action: "redirect_update", redirectId: "redirect-1", observedRedirectTarget: "/middle", redirectTarget: "/final", observedAt: "2026-07-14T00:00:00.000Z", observedStateHash: "d".repeat(64), recommendationId: "rec-1", executable: true, resolutionStatus: "resolved" };
    const redirectProposed = { action: "redirect_update", before: { id: "redirect-1", target: "/middle" }, after: { target: "/final" } };
    const redirectRec = { ...rec, proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(redirectProposed) }) };
    const observed = { id: "redirect-1", source: "/old", target: "/middle", capturedAt: new Date(), stateHash: "d".repeat(64) };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: redirectSource, proposedState: redirectProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [], redirects: [{ source: "/old", finalTarget: "/final", requiredAction: "replace with one-hop target", ruleIds: ["redirect:update"], policy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }] } });
    adapter.fetchRedirects.mockResolvedValue(new Map([["/old", observed]]));
    adapter.updateRedirect.mockResolvedValue({ ...observed, target: "/final", stateHash: "e".repeat(64) });

    await expect(dispatchClaimedTopicalMapStoreTask(client as any, redirectRec as any)).resolves.toMatchObject({ action: "redirect_update", changedFields: ["target"] });
    expect(adapter.updateRedirect).toHaveBeenCalledWith(observed, "/final");
  });
  it("blocks a redirect update when the exact observed ID or state changed", async () => {
    const redirectSource = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["redirect:update"], ruleDomains: ["redirects"], sourceReferences: [{ kind: "rule", id: "redirect:update" }], generationProvenance: "deterministic", targetType: "redirect", targetUrl: "/old", action: "redirect_update", redirectId: "redirect-1", observedRedirectTarget: "/middle", redirectTarget: "/final", observedAt: "2026-07-14T00:00:00.000Z", observedStateHash: "d".repeat(64), recommendationId: "rec-1", executable: true, resolutionStatus: "resolved" };
    const redirectProposed = { action: "redirect_update", before: { id: "redirect-1", target: "/middle" }, after: { target: "/final" } };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: redirectSource, proposedState: redirectProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [], redirects: [{ source: "/old", finalTarget: "/final", requiredAction: "replace with one-hop target", ruleIds: ["redirect:update"], policy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }] } });
    adapter.fetchRedirects.mockResolvedValue(new Map([["/old", { id: "redirect-2", source: "/old", target: "/middle", capturedAt: new Date(), stateHash: "f".repeat(64) }]]));
    const redirectRec = { ...rec, proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(redirectProposed) }) };

    await expect(dispatchClaimedTopicalMapStoreTask(client as any, redirectRec as any)).rejects.toMatchObject({ code: "OBSERVATION_CHANGED" });
    expect(adapter.updateRedirect).not.toHaveBeenCalled();
  });
  it("recovers a redirect update when the mutation response is uncertain but exact read-back matches", async () => {
    const redirectSource = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["redirect:update"], ruleDomains: ["redirects"], sourceReferences: [{ kind: "rule", id: "redirect:update" }], generationProvenance: "deterministic", targetType: "redirect", targetUrl: "/old", action: "redirect_update", redirectId: "redirect-1", observedRedirectTarget: "/middle", redirectTarget: "/final", observedAt: "2026-07-14T00:00:00.000Z", observedStateHash: "d".repeat(64), recommendationId: "rec-1", executable: true, resolutionStatus: "resolved" };
    const redirectProposed = { action: "redirect_update", before: { id: "redirect-1", target: "/middle" }, after: { target: "/final" } };
    const before = { id: "redirect-1", source: "/old", target: "/middle", capturedAt: new Date(), stateHash: "d".repeat(64) };
    const after = { ...before, target: "/final", stateHash: "e".repeat(64) };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: redirectSource, proposedState: redirectProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [], redirects: [{ source: "/old", finalTarget: "/final", requiredAction: "replace with one-hop target", ruleIds: ["redirect:update"], policy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }] } });
    adapter.fetchRedirects.mockResolvedValueOnce(new Map([["/old", before]])).mockResolvedValueOnce(new Map([["/old", after]]));
    adapter.updateRedirect.mockRejectedValue(new Error("response lost"));
    const redirectRec = { ...rec, proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(redirectProposed) }) };

    await expect(dispatchClaimedTopicalMapStoreTask(client as any, redirectRec as any)).resolves.toMatchObject({ action: "redirect_update", shopifyReturnedStateHash: "e".repeat(64) });
  });
  it("deletes only the exact redirect shadowing a governed live owner page", async () => {
    const redirectSource = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["redirect:delete"], ruleDomains: ["redirects"], sourceReferences: [{ kind: "rule", id: "redirect:delete" }], generationProvenance: "deterministic", targetType: "redirect", targetUrl: "/pages/red-rice-recipes", action: "redirect_delete", redirectId: "redirect-1", observedRedirectTarget: "/blogs/recipes/tagged/red-rice", liveOwnerUrl: "/pages/red-rice-recipes", observedAt: "2026-07-14T00:00:00.000Z", observedStateHash: "d".repeat(64), recommendationId: "rec-1", executable: true, resolutionStatus: "resolved" };
    const redirectProposed = { action: "redirect_delete", before: { id: "redirect-1", target: "/blogs/recipes/tagged/red-rice" }, after: { state: "absent" } };
    const redirectRec = { ...rec, proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(redirectProposed) }) };
    const observed = { id: "redirect-1", source: "/pages/red-rice-recipes", target: "/blogs/recipes/tagged/red-rice", capturedAt: new Date(), stateHash: "d".repeat(64) };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: redirectSource, proposedState: redirectProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [], redirects: [{ source: "/pages/red-rice-recipes", finalTarget: "/blogs/recipes/tagged/red-rice", requiredAction: "retain live page as owner; remove redirect record", ruleIds: ["redirect:delete"], policy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }] } });
    adapter.fetchRedirects
      .mockResolvedValueOnce(new Map([["/pages/red-rice-recipes", observed]]))
      .mockResolvedValueOnce(new Map());
    adapter.fetch.mockResolvedValue({ ...resource, id: "page-1", type: "page", url: "/pages/red-rice-recipes" });
    adapter.deleteRedirect.mockResolvedValue({ id: "redirect-1", source: "/pages/red-rice-recipes", previousTarget: "/blogs/recipes/tagged/red-rice", verifiedAt: new Date() });

    await expect(dispatchClaimedTopicalMapStoreTask(client as any, redirectRec as any)).resolves.toMatchObject({ action: "redirect_delete", changedFields: ["redirect"] });
    expect(adapter.deleteRedirect).toHaveBeenCalledWith(observed);
  });
  it("blocks a previously approved redirect when its active rule is now manual-gated", async () => {
    const redirectSource = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["redirect:1"], ruleDomains: ["redirects"], sourceReferences: [{ kind: "rule", id: "redirect:1" }], generationProvenance: "deterministic", targetType: "redirect", targetUrl: "/old", action: "redirect_create", redirectTarget: "/products/rice", observedAt: "2026-07-14T00:00:00.000Z", observedStateHash: "d".repeat(64), recommendationId: "rec-1", executable: true };
    const redirectProposed = { action: "redirect_create", before: { state: "absent" }, after: { target: "/products/rice" } };
    const redirectRec = { ...rec, proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(redirectProposed) }) };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: redirectSource, proposedState: redirectProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [], redirects: [{ source: "/old", finalTarget: "/products/rice", ruleIds: ["redirect:1"], policy: { resolutionStatus: "manual_gate", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }] } });

    await expect(dispatchClaimedTopicalMapStoreTask(client as any, redirectRec as any)).rejects.toMatchObject({ code: "RULE_CHANGED" });
    expect(adapter.fetchRedirects).not.toHaveBeenCalled();
    expect(adapter.createRedirect).not.toHaveBeenCalled();
  });
  it("reports an uncertain redirect result when create fails and exact reobservation is absent", async () => {
    const redirectSource = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["redirect:1"], ruleDomains: ["redirects"], sourceReferences: [{ kind: "rule", id: "redirect:1" }], generationProvenance: "deterministic", targetType: "redirect", targetUrl: "/old", action: "redirect_create", redirectTarget: "/products/rice", observedAt: "2026-07-14T00:00:00.000Z", observedStateHash: "d".repeat(64), recommendationId: "rec-1", executable: true };
    const redirectProposed = { action: "redirect_create", before: { state: "absent" }, after: { target: "/products/rice" } };
    const redirectRec = { ...rec, proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(redirectProposed) }) };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: redirectSource, proposedState: redirectProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [], redirects: [{ source: "/old", finalTarget: "/products/rice", ruleIds: ["redirect:1"], policy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }] } });
    adapter.fetchRedirects.mockResolvedValueOnce(new Map()).mockResolvedValueOnce(new Map());
    adapter.createRedirect.mockRejectedValue(new Error("transport outcome unknown\nsecret"));

    await expect(dispatchClaimedTopicalMapStoreTask(client as any, redirectRec as any)).rejects.toMatchObject({
      code: "SHOPIFY_VERIFICATION_UNCERTAIN",
      diagnostic: { mutationSent: true, shopifyMessage: "transport outcome unknown secret", reobservation: "unavailable" },
    });
  });
  it("freezes the exact proposed-state hash in approval evidence without Shopify", async () => {
    const client = db();
    await approveTopicalMapStoreTask(client as any, { id: "task-1", actor: "operator" });
    expect(client._tx.recommendation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(proposed) }) }) }));
    expect(adapter.fetch).not.toHaveBeenCalled(); expect(adapter.apply).not.toHaveBeenCalled();
  });
  it("rejects changed bytes before lock, observation, or Shopify", async () => {
    const client = db(); client.storeTask.findUnique.mockResolvedValue({ ...task, proposedState: { ...proposed, after: { seoTitle: "Changed", seoDescription: "New desc" } } });
    await expect(dispatchClaimedTopicalMapStoreTask(client as any, rec as any)).rejects.toMatchObject({ code: "APPROVED_BYTES_CHANGED" });
    expect(client._tx.storeTaskExecutionLock.create).not.toHaveBeenCalled(); expect(adapter.apply).not.toHaveBeenCalled();
  });
  it("blocks a previously approved page update when its active rule is now manual-gated", async () => {
    const client = db();
    command.load.mockResolvedValue({
      identity: { versionId: "v1", packageSha256: "a".repeat(64) },
      pages: [{ url: "/products/rice", decision: "Improve SEO metadata", contentDecisionPolicy: { resolutionStatus: "manual_gate", conditions: [], evidenceRequirements: [], reviewRequirements: [] }, ruleDomains: { content_decisions: ["rule-1"] } }],
      work: { internalLinks: [], redirects: [] },
    });

    await expect(dispatchClaimedTopicalMapStoreTask(client as any, rec as any)).rejects.toMatchObject({ code: "RULE_CHANGED" });
    expect(adapter.fetch).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
  });
  it("returns only a minimal verified receipt and leaves terminal finalization to execute-approved", async () => {
    const client = db(); const receipt = await dispatchClaimedTopicalMapStoreTask(client as any, rec as any);
    expect(receipt).toMatchObject({ taskId: "task-1", recommendationId: "rec-1", changedFields: ["seoDescription", "seoTitle"], targetId: resource.id });
    expect(receipt).not.toHaveProperty("before"); expect(receipt).not.toHaveProperty("after");
    expect(client._tx.storeTask.update).not.toHaveBeenCalled();
  });
  it("requires the mandatory target lock", async () => {
    const client = db(); client._tx.storeTaskExecutionLock.create.mockRejectedValue(new Error("unique"));
    await expect(dispatchClaimedTopicalMapStoreTask(client as any, rec as any)).rejects.toBeInstanceOf(TopicalMapApplyError);
    expect(adapter.apply).not.toHaveBeenCalled();
  });
  it("preserves only bounded Shopify diagnostics and reobserves after a mutation error", async () => {
    const client = db();
    const secretLookingError = Object.assign(new Error("Title is too long\n"), {
      token: "shpat_secret",
      variables: { input: "private bytes" },
    });
    adapter.apply.mockRejectedValue(secretLookingError);
    adapter.fetch.mockResolvedValueOnce(resource).mockResolvedValueOnce({ ...resource, seoTitle: "Different" });

    let thrown: TopicalMapApplyError | undefined;
    try { await dispatchClaimedTopicalMapStoreTask(client as any, rec as any); }
    catch (error) { thrown = error as TopicalMapApplyError; }
    expect(thrown).toMatchObject({
      code: "SHOPIFY_VERIFICATION_UNCERTAIN",
      diagnostic: {
        mutationSent: true,
        shopifyMessage: "Title is too long",
        reobservation: "different_state",
      },
    });
    expect(JSON.stringify(thrown?.diagnostic)).not.toContain("shpat_secret");
    expect(JSON.stringify(thrown?.diagnostic)).not.toContain("private bytes");
  });
  it("revalidates and applies every rule in a grouped internal-link task", async () => {
    const bodyHtml = '<p>Existing.</p><section class="ag-related-recipes" aria-labelledby="ag-related-recipes-title"><h2 id="ag-related-recipes-title">Explore Related Resources</h2><ul><li><a href="/products/black-rice">black rice</a></li><li><a href="/products/red-rice">red rice</a></li></ul></section>';
    const groupedSource = { ...source, targetType: "collection", targetUrl: "/collections/rice", action: "internal_link", ruleDomains: ["internal_links"], ruleIds: ["link:black", "link:red"], sourceReferences: [{ kind: "rule", id: "link:black" }, { kind: "rule", id: "link:red" }], generationProvenance: "deterministic", links: [{ toUrl: "/products/black-rice", anchor: "black rice" }, { toUrl: "/products/red-rice", anchor: "red rice" }] };
    const groupedProposed = { action: "internal_link", before: { bodyHtml: "<p>Existing.</p>" }, after: { bodyHtml } };
    const groupedResource = { ...resource, type: "collection", url: "/collections/rice", bodyHtml: "<p>Existing.</p>" };
    const groupedRec = { ...rec, proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(groupedProposed) }) };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: groupedSource, proposedState: groupedProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [
      { fromUrl: "/collections/rice", toUrl: "/products/black-rice", recommendedAnchor: "black rice", requiredAction: "add exact link", ruleIds: ["link:black"], policy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } },
      { fromUrl: "/collections/rice", toUrl: "/products/red-rice", recommendedAnchor: "red rice", requiredAction: "ensure exact link", ruleIds: ["link:red"], policy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } },
    ] } });
    adapter.fetch.mockResolvedValue(groupedResource);
    adapter.apply.mockResolvedValue({ ...groupedResource, bodyHtml, stateHash: "c".repeat(64) });
    await dispatchClaimedTopicalMapStoreTask(client as any, groupedRec as any);
    expect(adapter.apply).toHaveBeenCalledWith(groupedResource, { bodyHtml });
  });
  it("recomputes an exact approved legacy-link replacement from the fresh article body", async () => {
    const bodyBefore = '<p><a href="/products/black-rice">Black rice</a></p>';
    const bodyAfter = '<p><a href="/products/philippines-organic-black-rice">Black rice</a></p>';
    const replacementSource = { ...source, targetType: "article", targetUrl: "/blogs/news/source", action: "internal_link_replace", ruleDomains: ["internal_links", "redirects"], ruleIds: ["link:black", "redirect:black"], sourceReferences: [{ kind: "rule", id: "link:black" }, { kind: "rule", id: "redirect:black" }], generationProvenance: "deterministic", resolutionStatus: "resolved", replacements: [{ fromUrl: "/products/black-rice", toUrl: "/products/philippines-organic-black-rice" }] };
    const replacementProposed = { action: "internal_link_replace", before: { bodyHtml: bodyBefore }, after: { bodyHtml: bodyAfter } };
    const replacementRec = { ...rec, proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(replacementProposed) }) };
    const article = { ...resource, id: "article-1", type: "article", url: "/blogs/news/source", blogHandle: "news", bodyHtml: bodyBefore };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: replacementSource, proposedState: replacementProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: {
      redirects: [{ source: "/products/black-rice", finalTarget: "/products/philippines-organic-black-rice", requiredAction: "retain unless source is still internally linked", ruleIds: ["redirect:black"], policy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }],
      internalLinks: [{ fromUrl: "/blogs/news/source", toUrl: "/products/philippines-organic-black-rice", currentBodyState: "legacy target present", requiredAction: "replace legacy target with this current product URL", ruleIds: ["link:black"], policy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }],
    } });
    adapter.fetch.mockResolvedValue(article);
    adapter.fetchRedirects.mockResolvedValue(new Map([["/products/black-rice", { id: "redirect-black", source: "/products/black-rice", target: "/products/philippines-organic-black-rice", capturedAt: new Date(), stateHash: "d".repeat(64) }]]));
    adapter.apply.mockResolvedValue({ ...article, bodyHtml: bodyAfter, stateHash: "c".repeat(64) });

    await dispatchClaimedTopicalMapStoreTask(client as any, replacementRec as any);
    expect(adapter.apply).toHaveBeenCalledWith(article, { bodyHtml: bodyAfter });
  });
  it("blocks legacy-link replacement when its current redirect no longer reaches the exact final target", async () => {
    const bodyBefore = '<p><a href="/products/black-rice">Black rice</a></p>';
    const bodyAfter = '<p><a href="/products/philippines-organic-black-rice">Black rice</a></p>';
    const replacementSource = { ...source, targetType: "article", targetUrl: "/blogs/news/source", action: "internal_link_replace", ruleDomains: ["internal_links", "redirects"], ruleIds: ["link:black", "redirect:black"], sourceReferences: [{ kind: "rule", id: "link:black" }, { kind: "rule", id: "redirect:black" }], generationProvenance: "deterministic", resolutionStatus: "resolved", replacements: [{ fromUrl: "/products/black-rice", toUrl: "/products/philippines-organic-black-rice" }] };
    const replacementProposed = { action: "internal_link_replace", before: { bodyHtml: bodyBefore }, after: { bodyHtml: bodyAfter } };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: replacementSource, proposedState: replacementProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: {
      redirects: [{ source: "/products/black-rice", finalTarget: "/products/philippines-organic-black-rice", requiredAction: "retain unless source is still internally linked", ruleIds: ["redirect:black"], policy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }],
      internalLinks: [{ fromUrl: "/blogs/news/source", toUrl: "/products/philippines-organic-black-rice", requiredAction: "replace legacy target with this current product URL", ruleIds: ["link:black"], policy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }],
    } });
    adapter.fetchRedirects.mockResolvedValue(new Map());
    const replacementRec = { ...rec, proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(replacementProposed) }) };

    await expect(dispatchClaimedTopicalMapStoreTask(client as any, replacementRec as any)).rejects.toMatchObject({ code: "OBSERVATION_CHANGED" });
    expect(adapter.fetch).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
  });
  it("blocks a previously approved internal-link task when its active rule is now manual-gated", async () => {
    const bodyHtml = '<p>Existing.</p><a href="/products/black-rice">black rice</a>';
    const groupedSource = { ...source, targetType: "collection", targetUrl: "/collections/rice", action: "internal_link", ruleDomains: ["internal_links"], ruleIds: ["link:black"], sourceReferences: [{ kind: "rule", id: "link:black" }], generationProvenance: "deterministic", links: [{ toUrl: "/products/black-rice", anchor: "black rice" }] };
    const groupedProposed = { action: "internal_link", before: { bodyHtml: "<p>Existing.</p>" }, after: { bodyHtml } };
    const groupedRec = { ...rec, proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(groupedProposed) }) };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: groupedSource, proposedState: groupedProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { redirects: [], internalLinks: [{ fromUrl: "/collections/rice", toUrl: "/products/black-rice", recommendedAnchor: "black rice", requiredAction: "add exact link", ruleIds: ["link:black"], policy: { resolutionStatus: "manual_gate", conditions: [], evidenceRequirements: [], reviewRequirements: [] } }] } });

    await expect(dispatchClaimedTopicalMapStoreTask(client as any, groupedRec as any)).rejects.toMatchObject({ code: "RULE_CHANGED" });
    expect(adapter.fetch).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
  });
  it("reconciles Shopify HTML that differs only by inter-tag formatting", async () => {
    const bodyHtml = '<p>Existing.</p><section><h2>Explore More Red Rice Recipes</h2><ul><li><a href="/blogs/recipes/red-rice">Red Rice</a></li></ul></section>';
    const groupedSource = { ...source, targetType: "page", targetUrl: "/pages/red-rice-recipes", action: "internal_link", ruleDomains: ["internal_links"], ruleIds: ["link:red"], sourceReferences: [{ kind: "rule", id: "link:red" }], generationProvenance: "deterministic", links: [{ toUrl: "/blogs/recipes/red-rice", anchor: "Red Rice" }] };
    const groupedProposed = { action: "internal_link", before: { bodyHtml: "<p>Existing.</p>" }, after: { bodyHtml } };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, status: "reconciliation_needed", sourceData: groupedSource, proposedState: groupedProposed });
    adapter.fetch.mockResolvedValue({ ...resource, type: "page", url: "/pages/red-rice-recipes", bodyHtml: bodyHtml.replace(/></g, ">\n<"), stateHash: "c".repeat(64) });
    await expect(reobserveTopicalMapReceipt(client as any, rec as any)).resolves.toMatchObject({ taskId: "task-1", action: "internal_link" });
  });
  it("reobserves already-applied redirect update and deletion states", async () => {
    const updateSource = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["redirect:update"], ruleDomains: ["redirects"], sourceReferences: [{ kind: "rule", id: "redirect:update" }], generationProvenance: "deterministic", targetType: "redirect", targetUrl: "/old", action: "redirect_update", redirectId: "redirect-1", observedRedirectTarget: "/middle", redirectTarget: "/final", observedAt: "2026-07-14T00:00:00.000Z", observedStateHash: "d".repeat(64), recommendationId: "rec-1", executable: true, resolutionStatus: "resolved" };
    const updateProposed = { action: "redirect_update", before: { id: "redirect-1", target: "/middle" }, after: { target: "/final" } };
    const client = db();
    client.storeTask.findUnique.mockResolvedValueOnce({ ...task, status: "reconciliation_needed", sourceData: updateSource, proposedState: updateProposed });
    adapter.fetchRedirects.mockResolvedValueOnce(new Map([["/old", { id: "redirect-1", source: "/old", target: "/final", capturedAt: new Date(), stateHash: "e".repeat(64) }]]));
    await expect(reobserveTopicalMapReceipt(client as any, rec as any)).resolves.toMatchObject({ action: "redirect_update", targetId: "redirect-1" });

    const { redirectTarget: _redirectTarget, ...sharedRedirectSource } = updateSource;
    const deleteSource = { ...sharedRedirectSource, ruleIds: ["redirect:delete"], sourceReferences: [{ kind: "rule", id: "redirect:delete" }], targetUrl: "/pages/red-rice-recipes", action: "redirect_delete", observedRedirectTarget: "/blogs/recipes/tagged/red-rice", liveOwnerUrl: "/pages/red-rice-recipes" };
    const deleteProposed = { action: "redirect_delete", before: { id: "redirect-1", target: "/blogs/recipes/tagged/red-rice" }, after: { state: "absent" } };
    client.storeTask.findUnique.mockResolvedValueOnce({ ...task, status: "reconciliation_needed", sourceData: deleteSource, proposedState: deleteProposed });
    adapter.fetchRedirects.mockResolvedValueOnce(new Map());
    await expect(reobserveTopicalMapReceipt(client as any, rec as any)).resolves.toMatchObject({ action: "redirect_delete", changedFields: ["redirect"] });
  });
});
