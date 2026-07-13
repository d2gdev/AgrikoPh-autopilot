import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapter = vi.hoisted(() => ({ fetch: vi.fn(), apply: vi.fn() }));
const command = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/shopify-governed-resources", async (original) => ({ ...(await original<typeof import("@/lib/shopify-governed-resources")>()), fetchGovernedStoreResource: adapter.fetch, applyGovernedStoreResourceChange: adapter.apply }));
vi.mock("@/lib/topical-map/command-center", () => ({ loadActiveTopicalMapCommandCenter: command.load }));

import { applyTopicalMapStoreTask, TopicalMapApplyError } from "@/lib/store-tasks/apply-topical-map";

const source = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["rule-1"], ruleDomains: ["content_decisions"], targetType: "product", targetUrl: "/products/rice", action: "seo_update", observedAt: "2026-07-13T00:00:00.000Z", observedStateHash: "b".repeat(64), executable: true };
const proposed = { action: "seo_update", before: { seoTitle: "Old", seoDescription: "Old desc" }, after: { seoTitle: "New", seoDescription: "New desc" } };
const task = { id: "task-1", status: "pending", taskType: "topical_map", sourceData: source, proposedState: proposed };
const resource = { id: "gid://shopify/Product/1", type: "product", url: "/products/rice", handle: "rice", title: "Rice", seoTitle: "Old", seoDescription: "Old desc", bodyHtml: "body", updatedAt: new Date(source.observedAt), stateHash: source.observedStateHash, internalTargets: [] };

function db(overrides: Record<string, unknown> = {}) {
  const tx = { storeTask: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn(async ({ data }) => ({ ...task, ...data })) }, auditLog: { create: vi.fn() } };
  return Object.assign({ storeTask: { findUnique: vi.fn().mockResolvedValue(task) }, topicalMapActivation: { findUnique: vi.fn() }, $transaction: vi.fn(async (fn) => fn(tx)), _tx: tx }, overrides);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EXECUTE_APPROVED_LIVE_ENABLED", "true");
  command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [{ url: "/products/rice", decision: "Improve SEO metadata", ruleDomains: { content_decisions: ["rule-1"] } }], work: { internalLinks: [] } });
  adapter.fetch.mockResolvedValue(resource);
  adapter.apply.mockResolvedValue({ ...resource, seoTitle: "New", seoDescription: "New desc", stateHash: "c".repeat(64) });
});
afterEach(() => vi.unstubAllEnvs());

describe("applyTopicalMapStoreTask", () => {
  it("claims once, performs one allowlisted mutation, verifies returned fields, and records a safe receipt", async () => {
    const client = db();
    const result = await applyTopicalMapStoreTask(client as any, { id: "task-1", actor: "operator-1" });
    expect(client._tx.storeTask.updateMany).toHaveBeenCalledWith({ where: { id: "task-1", status: "pending" }, data: { status: "applying", reviewedBy: "operator-1", reviewedAt: expect.any(Date) } });
    expect(adapter.apply).toHaveBeenCalledTimes(1);
    expect(adapter.apply).toHaveBeenCalledWith(resource, { seoTitle: "New", seoDescription: "New desc" });
    expect(result.task.status).toBe("completed");
    expect(result.receipt).toMatchObject({ strategyVersionId: "v1", ruleIds: ["rule-1"], before: { seoTitle: "Old" }, after: { seoTitle: "New" } });
    expect(client._tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "topical_map_store_task_applied", actor: "operator-1", entityId: "task-1" }) });
  });

  it.each([
    ["LIVE_DISABLED", () => vi.stubEnv("EXECUTE_APPROVED_LIVE_ENABLED", "false")],
    ["TASK_NOT_PENDING", (client: any) => client.storeTask.findUnique.mockResolvedValue({ ...task, status: "completed" })],
    ["TASK_NOT_EXECUTABLE", (client: any) => client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: { ...source, executable: false } })],
    ["STRATEGY_CHANGED", () => command.load.mockResolvedValue({ identity: { versionId: "other", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [] } })],
    ["RULE_CHANGED", () => command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [{ url: "/products/rice", decision: "Improve SEO metadata", ruleDomains: { content_decisions: ["other"] } }], work: { internalLinks: [] } })],
    ["OBSERVATION_CHANGED", () => adapter.fetch.mockResolvedValue({ ...resource, stateHash: "d".repeat(64) })],
  ])("fails closed with %s before mutation", async (code, setup) => {
    const client = db(); setup(client);
    await expect(applyTopicalMapStoreTask(client as any, { id: "task-1", actor: "operator-1" })).rejects.toMatchObject({ code });
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it("rejects a duplicate atomic claim without mutating Shopify", async () => {
    const client = db(); client._tx.storeTask.updateMany.mockResolvedValue({ count: 0 });
    await expect(applyTopicalMapStoreTask(client as any, { id: "task-1", actor: "operator-1" })).rejects.toMatchObject({ code: "TASK_NOT_PENDING" });
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it.each([
    ["forged target type", { sourceData: { ...source, targetType: "page" } }],
    ["cross-schema source/action", { sourceData: source, proposedState: { action: "content_update", before: { bodyHtml: "body" }, after: { bodyHtml: "changed" } } }],
  ])("rejects %s before claim and mutation", async (_name, changed) => {
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, ...changed });
    await expect(applyTopicalMapStoreTask(client as any, { id: "task-1", actor: "operator-1" })).rejects.toMatchObject({ code: "RULE_CHANGED" });
    expect(client._tx.storeTask.updateMany).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it.each([
    ["destination", { toUrl: "/products/changed", recommendedAnchor: "shop rice" }],
    ["anchor", { toUrl: "/products/target", recommendedAnchor: "changed anchor" }],
  ])("rejects an internal link whose active %s changed", async (_name, activeLink) => {
    const linkSource = { ...source, action: "internal_link", ruleDomains: ["internal_links"], linkTargetUrl: "/products/target", linkAnchor: "shop rice" };
    const linkProposed = { action: "internal_link", before: { bodyHtml: "body" }, after: { bodyHtml: 'body<p><a href="/products/target">shop rice</a></p>' } };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: linkSource, proposedState: linkProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [{ fromUrl: "/products/rice", ruleIds: ["rule-1"], ...activeLink }] } });
    await expect(applyTopicalMapStoreTask(client as any, { id: "task-1", actor: "operator-1" })).rejects.toMatchObject({ code: "RULE_CHANGED" });
    expect(client._tx.storeTask.updateMany).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it("rejects a schema-valid internal-link body that is not the exact governed link", async () => {
    const linkSource = { ...source, action: "internal_link", ruleDomains: ["internal_links"], linkTargetUrl: "/products/target", linkAnchor: "shop rice" };
    const forged = { action: "internal_link", before: { bodyHtml: "body" }, after: { bodyHtml: "body<p>unbound content</p>" } };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: linkSource, proposedState: forged });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [{ fromUrl: "/products/rice", toUrl: "/products/target", recommendedAnchor: "shop rice", ruleIds: ["rule-1"] }] } });
    await expect(applyTopicalMapStoreTask(client as any, { id: "task-1", actor: "operator-1" })).rejects.toMatchObject({ code: "OBSERVATION_CHANGED" });
    expect(adapter.fetch).toHaveBeenCalledTimes(1);
    expect(client._tx.storeTask.updateMany).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it("rejects forged matching internal-link before/after bodies against the fresh resource", async () => {
    const linkSource = { ...source, action: "internal_link", ruleDomains: ["internal_links"], linkTargetUrl: "/products/target", linkAnchor: "shop rice" };
    const forged = { action: "internal_link", before: { bodyHtml: "forged" }, after: { bodyHtml: 'forged<p><a href="/products/target">shop rice</a></p>' } };
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: linkSource, proposedState: forged });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [{ fromUrl: "/products/rice", toUrl: "/products/target", recommendedAnchor: "shop rice", ruleIds: ["rule-1"] }] } });
    await expect(applyTopicalMapStoreTask(client as any, { id: "task-1", actor: "operator-1" })).rejects.toMatchObject({ code: "OBSERVATION_CHANGED" });
    expect(adapter.fetch).toHaveBeenCalledTimes(1);
    expect(client._tx.storeTask.updateMany).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it.each([
    ["SEO metadata", source, { ...proposed, before: { seoTitle: "forged", seoDescription: "Old desc" } }, "Improve SEO metadata"],
    ["content body", { ...source, action: "content_update" }, { action: "content_update", before: { bodyHtml: "forged" }, after: { bodyHtml: "changed" } }, "Expand content"],
  ])("rejects stale or forged %s before state against the fresh resource", async (_name, changedSource, changedProposed, decision) => {
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: changedSource, proposedState: changedProposed });
    command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [{ url: "/products/rice", decision, ruleDomains: { content_decisions: ["rule-1"] } }], work: { internalLinks: [] } });
    await expect(applyTopicalMapStoreTask(client as any, { id: "task-1", actor: "operator-1" })).rejects.toMatchObject({ code: "OBSERVATION_CHANGED" });
    expect(client._tx.storeTask.updateMany).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it("rejects a runtime-unsupported target as non-executable before Shopify or claim", async () => {
    const client = db();
    client.storeTask.findUnique.mockResolvedValue({ ...task, sourceData: { ...source, targetType: "home", targetUrl: "/" } as any });
    await expect(applyTopicalMapStoreTask(client as any, { id: "task-1", actor: "operator-1" })).rejects.toMatchObject({ code: "TASK_NOT_EXECUTABLE" });
    expect(adapter.fetch).not.toHaveBeenCalled();
    expect(client._tx.storeTask.updateMany).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it.each([
    ["Shopify user error", () => adapter.apply.mockRejectedValue(new Error("secret Shopify detail"))],
    ["returned-state mismatch", () => adapter.apply.mockResolvedValue({ ...resource, seoTitle: "Wrong", seoDescription: "New desc" })],
  ])("marks a claimed task failed and audits safely on %s", async (_name, setup) => {
    setup(); const client = db();
    await expect(applyTopicalMapStoreTask(client as any, { id: "task-1", actor: "operator-1" })).rejects.toBeInstanceOf(TopicalMapApplyError);
    expect(client._tx.storeTask.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", completionNote: "Shopify update could not be verified." }) }));
    expect(client._tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "topical_map_store_task_failed", meta: expect.not.objectContaining({ error: expect.stringContaining("secret") }) }) });
  });
});
