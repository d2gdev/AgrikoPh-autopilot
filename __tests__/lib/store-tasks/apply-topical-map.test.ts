import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const adapter = vi.hoisted(() => ({ fetch: vi.fn(), apply: vi.fn() }));
const command = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/shopify-governed-resources", async (original) => ({ ...(await original<typeof import("@/lib/shopify-governed-resources")>()), fetchGovernedStoreResource: adapter.fetch, applyGovernedStoreResourceChange: adapter.apply }));
vi.mock("@/lib/topical-map/command-center", () => ({ loadActiveTopicalMapCommandCenter: command.load }));
import { approveTopicalMapStoreTask, dispatchClaimedTopicalMapStoreTask, TopicalMapApplyError } from "@/lib/store-tasks/apply-topical-map";
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
beforeEach(() => { vi.clearAllMocks(); command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [{ url: "/products/rice", decision: "Improve SEO metadata", ruleDomains: { content_decisions: ["rule-1"] } }], work: { internalLinks: [] } }); adapter.fetch.mockResolvedValue(resource); adapter.apply.mockResolvedValue({ ...resource, seoTitle: "New", seoDescription: "New desc", stateHash: "c".repeat(64) }); });
afterEach(() => vi.unstubAllEnvs());

describe("topical-map approval and internal dispatch", () => {
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
});
