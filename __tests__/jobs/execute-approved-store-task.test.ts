import { beforeEach, describe, expect, it, vi } from "vitest";
const adapter = vi.hoisted(() => ({ fetch: vi.fn(), apply: vi.fn() }));
const command = vi.hoisted(() => ({ load: vi.fn() }));
const db = vi.hoisted(() => ({
  recommendation: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() }, storeTask: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() }, storeTaskExecutionLock: { deleteMany: vi.fn(), create: vi.fn() }, auditLog: { create: vi.fn() }, jobRun: { create: vi.fn(), update: vi.fn() }, $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/topical-map/command-center", () => ({ loadActiveTopicalMapCommandCenter: command.load }));
vi.mock("@/lib/shopify-governed-resources", async (original) => ({ ...(await original<typeof import("@/lib/shopify-governed-resources")>()), fetchGovernedStoreResource: adapter.fetch, applyGovernedStoreResourceChange: adapter.apply }));
vi.mock("@/lib/executor", () => ({ isSupportedAction: vi.fn().mockReturnValue(true), executeRecommendation: vi.fn() }));
vi.mock("@/lib/dashboard/jobs-status", () => ({ materializeJobsStatusSnapshot: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/alerts", () => ({ sendOperatorAlert: vi.fn() }));
import { executeApprovedHandler } from "@/jobs/execute-approved";
import { hashTopicalMapProposedState } from "@/lib/store-tasks/topical-map";

const proposed = { action: "seo_update", before: { seoTitle: "Old", seoDescription: "Old desc" }, after: { seoTitle: "New", seoDescription: "New desc" } };
const source = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["rule-1"], ruleDomains: ["content_decisions"], sourceReferences: [{ kind: "rule", id: "rule-1" }], generationProvenance: "bounded_ai_draft", targetType: "product", targetUrl: "/products/rice", action: "seo_update", observedAt: "2026-07-13T00:00:00.000Z", observedStateHash: "b".repeat(64), recommendationId: "rec-1", executable: true };
const rec = { id: "rec-1", platform: "shopify", actionType: "apply_topical_map_store_task", targetEntityId: "task-1", targetEntityType: "store_task", targetEntityName: "/products/rice", status: "approved", guardStatus: "clear", proposedValue: JSON.stringify({ taskId: "task-1", approvedProposedStateHash: hashTopicalMapProposedState(proposed) }), updatedAt: new Date(), reviewedAt: new Date() };
const resource = { id: "gid://shopify/Product/1", type: "product", url: "/products/rice", handle: "rice", title: "Rice", seoTitle: "Old", seoDescription: "Old desc", bodyHtml: "body", updatedAt: new Date(source.observedAt), stateHash: source.observedStateHash, internalTargets: [] };
beforeEach(() => {
  vi.clearAllMocks(); process.env.EXECUTE_APPROVED_LIVE_ENABLED = "true";
  db.jobRun.create.mockResolvedValue({ id: "run-1" }); db.jobRun.update.mockResolvedValue({}); db.recommendation.updateMany.mockResolvedValue({ count: 1 }); db.storeTask.updateMany.mockResolvedValue({ count: 1 }); db.storeTask.findUnique.mockResolvedValue({ id: "task-1", status: "pending", sourceData: source, proposedState: proposed });
  db.recommendation.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([rec]);
  db.$transaction.mockImplementation(async (value) => typeof value === "function" ? value(db) : Promise.all(value));
  command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [{ url: "/products/rice", decision: "Improve SEO metadata", contentDecisionPolicy: { resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] }, ruleDomains: { content_decisions: ["rule-1"] } }], work: { internalLinks: [] } });
  adapter.fetch.mockResolvedValue(resource); adapter.apply.mockResolvedValue({ ...resource, seoTitle: "New", seoDescription: "New desc", stateHash: "c".repeat(64) });
});
describe("execute-approved governed Store Task integration", () => {
  it("selects and recovers only the explicitly requested recommendation", async () => {
    const selected = { ...rec, id: "selected-rec" };
    const unrelatedApproved = { ...rec, id: "other-rec", targetEntityId: "task-2" };
    const unrelatedStale = { ...rec, id: "stale-rec", status: "executing", updatedAt: new Date(0) };
    db.recommendation.findMany.mockReset();
    db.recommendation.findMany.mockImplementation(async ({ where }: any) => {
      if (where.status === "executing") return where.id === "selected-rec" ? [] : [unrelatedStale];
      return where.id === "selected-rec" ? [selected] : [selected, unrelatedApproved];
    });
    db.storeTask.findUnique.mockResolvedValue({ id: "task-1", status: "pending", sourceData: { ...source, recommendationId: "selected-rec" }, proposedState: proposed });

    await executeApprovedHandler({
      liveRequested: true,
      triggeredBy: "store-pilot:operator-1",
      recommendationId: "selected-rec",
    });

    expect(db.recommendation.findMany).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({ status: "executing", id: "selected-rec" }),
    });
    expect(db.recommendation.findMany).toHaveBeenNthCalledWith(2, {
      where: { status: { in: ["approved", "override_approved"] }, id: "selected-rec" },
      take: 1,
      orderBy: { reviewedAt: "asc" },
    });
    expect(adapter.apply).toHaveBeenCalledTimes(1);
    expect(db.recommendation.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "stale-rec" }),
    }));
  });

  it("mutates only approved hash-matching work and jointly finalizes minimal receipts", async () => {
    await executeApprovedHandler({ liveRequested: true });
    expect(adapter.apply).toHaveBeenCalledWith(resource, { seoTitle: "New", seoDescription: "New desc" });
    expect(db.storeTask.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed", executionReceipt: expect.not.objectContaining({ before: expect.anything(), after: expect.anything() }) }) }));
    expect(db.recommendation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "executed" }) }));
  });
  it("rejects a post-approval byte change before Shopify", async () => {
    db.storeTask.findUnique.mockResolvedValue({ id: "task-1", status: "pending", sourceData: source, proposedState: { ...proposed, after: { seoTitle: "Changed", seoDescription: "New desc" } } });
    await executeApprovedHandler({ liveRequested: true });
    expect(adapter.fetch).not.toHaveBeenCalled(); expect(adapter.apply).not.toHaveBeenCalled();
    expect(db.recommendation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "rejected" }) }));
  });

  it.each(["APPROVED_BYTES_CHANGED", "OBSERVATION_CHANGED", "STRATEGY_CHANGED", "RULE_CHANGED"])(
    "classifies %s as superseded instead of failed",
    async (code) => {
      if (code === "APPROVED_BYTES_CHANGED") {
        db.storeTask.findUnique.mockResolvedValue({ id: "task-1", status: "pending", sourceData: source, proposedState: { ...proposed, after: { seoTitle: "Changed", seoDescription: "New desc" } } });
      } else if (code === "OBSERVATION_CHANGED") {
        adapter.fetch.mockResolvedValue({ ...resource, stateHash: "d".repeat(64) });
      } else if (code === "STRATEGY_CHANGED") {
        command.load.mockResolvedValue({ identity: { versionId: "v2", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [] } });
      } else {
        command.load.mockResolvedValue({ identity: { versionId: "v1", packageSha256: "a".repeat(64) }, pages: [], work: { internalLinks: [] } });
      }

      const result = await executeApprovedHandler({ liveRequested: true });

      expect(result.summary).toMatchObject({ superseded: 1, failed: 0 });
      expect(db.storeTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "dismissed", completionNote: expect.stringContaining(`Superseded (${code})`) }) }));
      expect(db.recommendation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "rejected" }) }));
      expect(db.storeTaskExecutionLock.deleteMany).toHaveBeenCalledWith({ where: { taskId: "task-1", ownerId: "rec-1" } });
      expect(db.$transaction).toHaveBeenCalledWith(expect.arrayContaining([
        expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      ]));
    },
  );
  it("keeps genuine Shopify uncertainty in reconciliation with bounded durable diagnostics", async () => {
    adapter.apply.mockRejectedValue(Object.assign(new Error("Title is too long"), {
      token: "shpat_secret",
      variables: { input: "private bytes" },
    }));

    const result = await executeApprovedHandler({ liveRequested: true });

    expect(result.summary).toMatchObject({ superseded: 0, failed: 1 });
    expect(db.storeTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "reconciliation_needed" }) }));
    expect(db.recommendation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      executionResult: expect.objectContaining({ code: "SHOPIFY_VERIFICATION_UNCERTAIN", mutationSent: true, shopifyMessage: "Title is too long", reobservation: "different_state" }),
    }) }));
    const durableAudit = db.auditLog.create.mock.calls.find(([arg]: any[]) => arg.data.action === "execution_failed");
    expect(durableAudit?.[0].data.after).toMatchObject({ code: "SHOPIFY_VERIFICATION_UNCERTAIN", mutationSent: true, shopifyMessage: "Title is too long", reobservation: "different_state" });
    expect(JSON.stringify(durableAudit)).not.toContain("shpat_secret");
    expect(JSON.stringify(durableAudit)).not.toContain("private bytes");
  });
  it("does not mutate when live execution is disabled", async () => {
    process.env.EXECUTE_APPROVED_LIVE_ENABLED = "false";
    await executeApprovedHandler({ liveRequested: true });
    expect(adapter.apply).not.toHaveBeenCalled();
  });
});
