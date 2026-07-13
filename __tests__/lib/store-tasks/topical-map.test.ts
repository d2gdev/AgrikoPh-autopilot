import { beforeEach, describe, expect, it, vi } from "vitest";

const { load, fetchResources, chat } = vi.hoisted(() => ({ load: vi.fn(), fetchResources: vi.fn(), chat: vi.fn() }));
vi.mock("@/lib/topical-map/command-center", () => ({ loadActiveTopicalMapCommandCenter: load }));
vi.mock("@/lib/shopify-governed-resources", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/shopify-governed-resources")>()), fetchGovernedStoreResources: fetchResources }));
vi.mock("@/lib/ai/client", () => ({ chatCompletionWithFailover: chat }));

import {
  TopicalMapStoreTaskProposedSchema,
  TopicalMapStoreTaskSourceSchema,
  syncTopicalMapStoreTasks,
} from "@/lib/store-tasks/topical-map";
import {
  cleanupTopicalMapAdvisories,
  selectAdvisoryDuplicateGroups,
  topicalMapAdvisorySemanticKey,
} from "@/lib/store-tasks/topical-map-advisories";

const observedAt = new Date("2026-07-13T02:00:00.000Z");
const advisoryIdentity = {
  strategyVersionId: "strategy-7",
  packageSha256: "A".repeat(64),
  targetUrl: "https://agrikoph.com/old/",
  advisoryReason: "redirect_execution_unsupported",
  ruleIds: ["r1", "r2"],
};
const advisorySource = (overrides: Record<string, unknown> = {}) => ({
  source: "topical-map",
  strategyVersionId: advisoryIdentity.strategyVersionId,
  packageSha256: advisoryIdentity.packageSha256,
  ruleIds: advisoryIdentity.ruleIds,
  ruleDomains: ["redirects"],
  sourceReferences: [{ kind: "rule", id: "r1" }],
  generationProvenance: "advisory_projection",
  targetType: "redirect",
  targetUrl: advisoryIdentity.targetUrl,
  executable: false,
  advisoryReason: advisoryIdentity.advisoryReason,
  ...overrides,
});
const resource = (type: "product" | "collection" | "page", url: string, title: string) => ({
  id: `gid://${url}`, type, url, handle: url.split("/").at(-1), title,
  seoTitle: `Old ${title}`, seoDescription: `Old description for ${title}`,
  bodyHtml: `<p>Existing ${title} body.</p>`, updatedAt: observedAt,
  stateHash: "b".repeat(64), internalTargets: [] as string[],
});
const center = () => ({
  identity: { versionId: "strategy-7", strategyVersion: "7", contractRevision: "3", packageSha256: "a".repeat(64), activatedAt: "2026-07-12T00:00:00.000Z" },
  domainCounts: {}, clusters: [{ name: "Philippine heirloom rice", memberUrls: [] }], prohibited: [], blockers: { evidence: [], reviews: [] }, provenance: {},
  pages: [
    { url: "/products/black-rice", ruleIds: ["decision:product", "role:product"], ruleDomains: { content_decisions: ["decision:product"] }, primaryKeywordOrTheme: "black rice Philippines", decision: "Improve SEO metadata", priority: "high" },
    { url: "/collections/rice", ruleIds: ["decision:collection"], ruleDomains: { content_decisions: ["decision:collection"] }, primaryKeywordOrTheme: "heirloom rice collection", decision: "Expand content", priority: "medium" },
    { url: "/pages/our-farm", ruleIds: ["decision:page"], ruleDomains: { content_decisions: ["decision:page"] }, primaryKeywordOrTheme: "Agriko farm story", decision: "Improve SEO metadata", priority: "low" },
    { url: "/products/missing", ruleIds: ["decision:missing"], ruleDomains: { content_decisions: ["decision:missing"] }, primaryKeywordOrTheme: "missing product", decision: "Improve SEO metadata", priority: "low" },
    { url: "/", ruleIds: ["decision:home"], ruleDomains: { content_decisions: ["decision:home"] }, decision: "Improve homepage", priority: "high" },
    { url: "/blogs/news", ruleIds: ["decision:blog-index"], ruleDomains: { content_decisions: ["decision:blog-index"] }, decision: "Improve blog index", priority: "medium" },
    { url: "/blogs/news/black-rice-guide", ruleIds: ["decision:article"], ruleDomains: { content_decisions: ["decision:article"] }, decision: "Improve SEO metadata", priority: "high" },
  ],
  work: {
    internalLinks: [
      { fromUrl: "/collections/rice", toUrl: "/products/black-rice", ruleIds: ["link:z", "link:a"], recommendedAnchor: "shop black rice", priority: "high" },
      { fromUrl: "/collections/rice", toUrl: "/products/brown-rice", ruleIds: ["link:brown"], recommendedAnchor: "shop brown rice", priority: "medium" },
      { fromUrl: "/collections/rice", toUrl: "/products/red-rice", ruleIds: ["link:red"], recommendedAnchor: "shop red rice", priority: "medium" },
      { fromUrl: "/blogs/news/black-rice-guide", toUrl: "/products/black-rice", ruleIds: ["link:article"], recommendedAnchor: "black rice", priority: "high" },
    ],
    redirects: [{ source: "/old", finalTarget: "/products/black-rice", ruleIds: ["redirect:1"] }],
    canonicalization: [{ currentUrl: "/products/black-rice", proposedCanonicalUrl: "/products/black-rice", ruleIds: ["canonical:1"] }],
    indexation: [{ currentUrl: "/products/black-rice", proposedCanonicalUrl: "/products/black-rice", ruleIds: ["index:1"] }],
  },
});

function client(existing: Record<string, { status: string; id?: string; createdAt?: Date; targetUrl?: string; sourceData?: unknown; executionReceipt?: unknown }> = {}) {
  const rows = new Map(Object.entries(existing).map(([dedupeKey, row]) => [dedupeKey, { dedupeKey, createdAt: new Date("2026-07-01T00:00:00Z"), ...row }]));
  let sequence = 0;
  const db: any = {
    topicalMapActivation: { findUnique: vi.fn() },
    storeTask: {
      findUnique: vi.fn(async ({ where }: any) => rows.get(where.dedupeKey) ?? null),
      findMany: vi.fn(async ({ where }: any) => [...rows.values()].filter((row: any) =>
        (where.targetUrl === undefined || row.targetUrl === where.targetUrl)
        && (where.status === undefined || where.status.in.includes(row.status))
        && (where.executionReceipt === undefined || row.executionReceipt == null))),
      upsert: vi.fn(async ({ where, create, update }: any) => { const prior = rows.get(where.dedupeKey) as any; rows.set(where.dedupeKey, { id: prior?.id ?? `task-${++sequence}`, createdAt: prior?.createdAt ?? new Date("2026-07-14T00:00:00Z"), ...create, ...update, status: "pending" }); return rows.get(where.dedupeKey); }),
      update: vi.fn(),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const ids = typeof where.id === "string" ? [where.id] : where.id?.in ?? [];
        const entries = [...rows.entries()].filter(([, row]: any) => ids.includes(row.id) && where.status.in.includes(row.status));
        for (const entry of entries) rows.set(entry[0], { ...entry[1], ...data });
        return { count: entries.length };
      }),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (run: any) => run(db)),
    rawSnapshot: { findFirst: vi.fn().mockResolvedValue({ id: "seo-snapshot-1" }) },
    recommendation: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async () => ({ id: `rec-${sequence}`, status: "pending" })), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(center());
  fetchResources.mockResolvedValue(new Map([
    ["/products/black-rice", resource("product", "/products/black-rice", "Black Rice")],
    ["/collections/rice", resource("collection", "/collections/rice", "Rice")],
    ["/pages/our-farm", resource("page", "/pages/our-farm", "Our Farm")],
  ]));
  chat.mockResolvedValue({ content: JSON.stringify({ drafts: [
    { url: "/products/black-rice", seoTitle: "Black Rice Philippines | Philippine Heirloom Rice", seoDescription: "Shop Agriko black rice from the Philippines, grounded in our Philippine heirloom rice collection." },
    { url: "/collections/rice", sectionText: "Explore Agriko's Philippine heirloom rice collection." },
    { url: "/pages/our-farm", seoTitle: "Our Farm | Agriko Philippine Heirloom Rice", seoDescription: "Learn about the Agriko farm story and our Philippine heirloom rice." },
  ] }), provider: "deepseek", model: "test" });
});

describe("topical-map advisory identity", () => {
  it("uses one semantic identity regardless of rule order", () => {
    expect(topicalMapAdvisorySemanticKey({ ...advisoryIdentity, ruleIds: ["r2", "r1", "r1"] }))
      .toBe(topicalMapAdvisorySemanticKey({ ...advisoryIdentity, ruleIds: ["r1", "r2"] }));
  });

  it("uses a different semantic identity when the advisory reason changes", () => {
    expect(topicalMapAdvisorySemanticKey(advisoryIdentity)).not.toBe(topicalMapAdvisorySemanticKey({
      ...advisoryIdentity,
      advisoryReason: "canonicalization_execution_prohibited",
    }));
  });

  it("keeps the newest pending advisory and dismisses only older pending or failed duplicates", () => {
    const rows = [
      { id: "older-pending", createdAt: new Date("2026-07-10T00:00:00Z"), status: "pending", sourceData: advisorySource() },
      { id: "older-failed", createdAt: new Date("2026-07-11T00:00:00Z"), status: "failed", sourceData: advisorySource() },
      { id: "newest-pending", createdAt: new Date("2026-07-12T00:00:00Z"), status: "pending", sourceData: advisorySource() },
      { id: "newest-failed", createdAt: new Date("2026-07-13T00:00:00Z"), status: "failed", sourceData: advisorySource() },
      { id: "completed", createdAt: new Date("2026-07-09T00:00:00Z"), status: "completed", sourceData: advisorySource() },
      { id: "dismissed", createdAt: new Date("2026-07-09T00:00:00Z"), status: "dismissed", sourceData: advisorySource() },
    ];

    expect(selectAdvisoryDuplicateGroups(rows)).toEqual([{
      semanticKey: expect.any(String),
      keepId: "newest-pending",
      dismissIds: ["newest-failed", "older-failed", "older-pending"],
    }]);
  });

  it("keeps cleanup dry-run read-only and applies duplicate groups transactionally", async () => {
    const db = client({
      older: {
        id: "older",
        createdAt: new Date("2026-07-10T00:00:00Z"),
        status: "failed",
        sourceData: advisorySource(),
      },
      newer: {
        id: "newer",
        createdAt: new Date("2026-07-12T00:00:00Z"),
        status: "pending",
        sourceData: advisorySource(),
      },
    });

    await expect(cleanupTopicalMapAdvisories(db, { apply: false, actor: "cleanup-test" })).resolves.toEqual({
      groups: 1,
      kept: 1,
      duplicates: 1,
      dismissed: 0,
      rejectedRecommendations: 0,
    });
    expect(db.$transaction).not.toHaveBeenCalled();

    await expect(cleanupTopicalMapAdvisories(db, { apply: true, actor: "cleanup-test" })).resolves.toEqual({
      groups: 1,
      kept: 1,
      duplicates: 1,
      dismissed: 1,
      rejectedRecommendations: 1,
    });
    expect(db.storeTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["older"] }, status: { in: ["pending", "failed"] } },
    }));
    expect(db.recommendation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ targetEntityId: { in: ["older"] }, status: { in: ["pending", "failed"] } }),
      data: expect.objectContaining({ status: "rejected", reviewedBy: "cleanup-test" }),
    }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      actor: "cleanup-test",
      action: "topical_map_advisory_superseded",
      entityId: "older",
    }) }));
  });

  it.each(["approved", "override_approved", "executing"])("does not clean up advisory work linked to a %s recommendation", async (status) => {
    const db = client({
      protected: {
        id: "protected",
        createdAt: new Date("2026-07-10T00:00:00Z"),
        status: "pending",
        sourceData: advisorySource(),
      },
      newer: {
        id: "newer",
        createdAt: new Date("2026-07-12T00:00:00Z"),
        status: "pending",
        sourceData: advisorySource(),
      },
    });
    db.recommendation.findMany.mockResolvedValue([{ targetEntityId: "protected", status }]);

    await expect(cleanupTopicalMapAdvisories(db, { apply: true, actor: "cleanup-test" })).resolves.toEqual({
      groups: 0,
      kept: 0,
      duplicates: 0,
      dismissed: 0,
      rejectedRecommendations: 0,
    });
    expect(db.storeTask.updateMany).not.toHaveBeenCalled();
  });
});

describe("syncTopicalMapStoreTasks", () => {
  it("groups internal links for one source into one deterministic section", async () => {
    const db = client();
    await syncTopicalMapStoreTasks(db as any);
    const links = db.storeTask.upsert.mock.calls
      .map((call: any) => call[0].create)
      .filter((task: any) => task.proposedState.action === "internal_link");
    expect(links).toHaveLength(1);
    expect(links[0].sourceData.ruleIds).toEqual(["link:a", "link:brown", "link:red", "link:z"]);
    expect(links[0].sourceData.links).toEqual([
      { toUrl: "/products/black-rice", anchor: "shop black rice" },
      { toUrl: "/products/brown-rice", anchor: "shop brown rice" },
      { toUrl: "/products/red-rice", anchor: "shop red rice" },
    ]);
    expect(links[0].proposedState.after.bodyHtml).toContain('<section class="ag-related-recipes"');
    expect(links[0].proposedState.after.bodyHtml.match(/<section/g)).toHaveLength(1);
    expect(links[0].proposedState.after.bodyHtml.match(/<li>/g)).toHaveLength(3);
  });

  it("removes rule IDs with destinations that already exist on the resource", async () => {
    const rice = resource("collection", "/collections/rice", "Rice");
    rice.internalTargets = ["/products/brown-rice"];
    fetchResources.mockResolvedValue(new Map([
      ["/products/black-rice", resource("product", "/products/black-rice", "Black Rice")],
      ["/collections/rice", rice],
      ["/pages/our-farm", resource("page", "/pages/our-farm", "Our Farm")],
    ]));
    const db = client();
    await syncTopicalMapStoreTasks(db as any);
    const link = db.storeTask.upsert.mock.calls.map((call: any) => call[0].create).find((task: any) => task.proposedState.action === "internal_link");
    expect(link.sourceData.links).toEqual([
      { toUrl: "/products/black-rice", anchor: "shop black rice" },
      { toUrl: "/products/red-rice", anchor: "shop red rice" },
    ]);
    expect(link.sourceData.ruleIds).toEqual(["link:a", "link:red", "link:z"]);
  });

  it("supersedes obsolete unapproved per-link tasks after creating the grouped replacement", async () => {
    const legacy = (status: string, id: string) => ({ status, id, targetUrl: "/collections/rice", sourceData: {
      source: "topical-map", strategyVersionId: "strategy-7", packageSha256: "a".repeat(64),
      ruleIds: ["link:legacy"], ruleDomains: ["internal_links"], sourceReferences: [{ kind: "rule", id: "link:legacy" }],
      generationProvenance: "deterministic", targetType: "collection", targetUrl: "/collections/rice", action: "internal_link",
      linkTargetUrl: "/products/black-rice", linkAnchor: "shop black rice", observedAt: observedAt.toISOString(), observedStateHash: "b".repeat(64), recommendationId: `rec-${id}`, executable: true,
    } });
    const grouped = { status: "pending", id: "old-grouped", targetUrl: "/collections/rice", sourceData: {
      source: "topical-map", strategyVersionId: "strategy-7", packageSha256: "a".repeat(64),
      ruleIds: ["link:old-grouped"], ruleDomains: ["internal_links"], sourceReferences: [{ kind: "rule", id: "link:old-grouped" }],
      generationProvenance: "deterministic", targetType: "collection", targetUrl: "/collections/rice", action: "internal_link",
      links: [{ toUrl: "/products/old", anchor: "old" }], observedAt: observedAt.toISOString(), observedStateHash: "b".repeat(64), executable: true,
    } };
    const db = client({ old_pending: legacy("pending", "old-pending"), old_failed: legacy("failed", "old-failed"), old_completed: legacy("completed", "old-completed"), old_grouped: grouped });
    db.recommendation.findUnique.mockImplementation(async ({ where }: any) => where.id.startsWith("rec-old-") ? { id: where.id, status: "pending" } : null);
    await syncTopicalMapStoreTasks(db as any);
    expect(db.storeTask.updateMany).toHaveBeenCalledTimes(3);
    expect(db.storeTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "old-pending", status: { in: ["pending", "failed"] } },
      data: expect.objectContaining({ status: "dismissed", completionNote: expect.stringContaining("Superseded by grouped topical-map internal-link task") }),
    }));
    expect(db.storeTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "old-grouped" }) }));
    expect(db.auditLog.create).toHaveBeenCalledTimes(5);
    expect(db.recommendation.updateMany).toHaveBeenCalledTimes(2);
    expect(db.recommendation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "rec-old-pending", status: { in: ["pending", "failed"] } },
      data: expect.objectContaining({ status: "rejected", reviewNote: expect.stringContaining("Superseded by grouped topical-map internal-link task") }),
    }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: "topical_map_recommendation_superseded", entityType: "recommendation", entityId: "rec-old-pending",
    }) }));
    expect(db.storeTask.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "old-completed" }) }));
  });

  it("projects only governed non-blog resources, keeps technical work advisory, and suppresses missing observations", async () => {
    const db = client();
    const result = await syncTopicalMapStoreTasks(db as any);
    expect(result).toEqual({ executable: 4, advisory: 5, unchanged: 0, suppressed: 1 });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(db.recommendation.create).toHaveBeenCalledTimes(4);
    expect(db.storeTask.update).toHaveBeenCalledWith(expect.objectContaining({ data: { sourceData: expect.objectContaining({ recommendationId: expect.stringMatching(/^rec-/) }) } }));
    const creates = db.storeTask.upsert.mock.calls.map((call: any) => call[0].create);
    expect(creates.filter((task: any) => task.sourceData.executable).map((task: any) => [task.targetType, task.proposedState.action])).toEqual([
      ["collection", "content_update"], ["collection", "internal_link"], ["page", "seo_update"], ["product", "seo_update"],
    ]);
    expect(creates.some((task: any) => task.targetUrl === "/blogs/news/black-rice-guide")).toBe(false);
    expect(creates.filter((task: any) => !task.sourceData.executable).map((task: any) => task.sourceData.advisoryReason).sort()).toEqual([
      "blog_index_not_governed", "canonicalization_execution_prohibited", "homepage_not_governed", "indexation_execution_prohibited", "redirect_execution_unsupported",
    ]);
    expect(creates.filter((task: any) => !task.sourceData.executable).every((task: any) => !("after" in task.proposedState))).toBe(true);
  });

  it("supersedes a historical-key advisory once and treats the retained semantic advisory as unchanged", async () => {
    const db = client({
      "store-task:topical-map:historical-key": {
        id: "historical-advisory",
        createdAt: new Date("2026-07-10T00:00:00Z"),
        status: "pending",
        targetUrl: "/old",
        sourceData: advisorySource({
          packageSha256: "a".repeat(64),
          ruleIds: ["redirect:1"],
          sourceReferences: [{ kind: "rule", id: "redirect:1" }],
          targetUrl: "/old",
        }),
      },
    });

    await syncTopicalMapStoreTasks(db as any);

    expect(db.storeTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["historical-advisory"] }, status: { in: ["pending", "failed"] } }),
      data: expect.objectContaining({ status: "dismissed" }),
    }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: "topical_map_advisory_superseded",
      entityId: "historical-advisory",
      after: expect.objectContaining({ replacementTaskId: expect.stringMatching(/^task-/) }),
    }) }));

    db.storeTask.updateMany.mockClear();
    db.auditLog.create.mockClear();
    const second = await syncTopicalMapStoreTasks(db as any);

    expect(second.unchanged).toBe(5);
    expect(db.storeTask.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "dismissed" }),
    }));
    expect(db.auditLog.create).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: "topical_map_advisory_superseded",
    }) }));
  });

  it("persists exact provenance/current state and deterministic sanitized internal-link output", async () => {
    const db = client();
    await syncTopicalMapStoreTasks(db as any);
    const tasks = db.storeTask.upsert.mock.calls.map((call: any) => call[0].create);
    const link = tasks.find((task: any) => task.proposedState.action === "internal_link");
    expect(link.sourceData).toEqual({ source: "topical-map", strategyVersionId: "strategy-7", packageSha256: "a".repeat(64), ruleIds: ["link:a", "link:brown", "link:red", "link:z"], ruleDomains: ["internal_links"], sourceReferences: [{ kind: "rule", id: "link:a" }, { kind: "rule", id: "link:brown" }, { kind: "rule", id: "link:red" }, { kind: "rule", id: "link:z" }], generationProvenance: "deterministic", targetType: "collection", targetUrl: "/collections/rice", action: "internal_link", links: [{ toUrl: "/products/black-rice", anchor: "shop black rice" }, { toUrl: "/products/brown-rice", anchor: "shop brown rice" }, { toUrl: "/products/red-rice", anchor: "shop red rice" }], observedAt: observedAt.toISOString(), observedStateHash: "b".repeat(64), executable: true });
    expect(link.proposedState).toEqual({ action: "internal_link", before: { bodyHtml: "<p>Existing Rice body.</p>" }, after: { bodyHtml: '<p>Existing Rice body.</p><section class="ag-related-recipes" aria-labelledby="ag-related-recipes-title"><h2 id="ag-related-recipes-title">Explore Related Resources</h2><ul><li><a href="/products/black-rice">shop black rice</a></li><li><a href="/products/brown-rice">shop brown rice</a></li><li><a href="/products/red-rice">shop red rice</a></li></ul></section>' } });
    expect(link.dedupeKey).toMatch(/^store-task:topical-map:[a-f0-9]{64}$/);
    expect(TopicalMapStoreTaskSourceSchema.parse(link.sourceData)).toEqual(link.sourceData);
    expect(TopicalMapStoreTaskProposedSchema.parse(link.proposedState)).toEqual(link.proposedState);
  });

  it("does not reopen completed or dismissed history and updates pending/failed rows", async () => {
    const first = client();
    await syncTopicalMapStoreTasks(first as any);
    const keys = first.storeTask.upsert.mock.calls.map((call: any) => call[0].where.dedupeKey);
    const db = client({ [keys[0]]: { status: "completed" }, [keys[1]]: { status: "dismissed" }, [keys[2]]: { status: "pending" }, [keys[3]]: { status: "failed" } });
    const result = await syncTopicalMapStoreTasks(db as any);
    expect(result.unchanged).toBe(2);
    expect(db.storeTask.upsert.mock.calls.some((call: any) => [keys[0], keys[1]].includes(call[0].where.dedupeKey))).toBe(false);
    expect(db.storeTask.upsert.mock.calls.some((call: any) => call[0].where.dedupeKey === keys[2])).toBe(true);
    expect(db.storeTask.upsert.mock.calls.some((call: any) => call[0].where.dedupeKey === keys[3])).toBe(true);
  });

  it.each(["approved", "override_approved", "executing"])("does not overwrite bytes linked to a %s recommendation", async (status) => {
    const seed = client(); await syncTopicalMapStoreTasks(seed as any);
    const call = seed.storeTask.upsert.mock.calls.find((item: any) => item[0].create.sourceData.executable)!;
    const frozenSource = { ...call[0].create.sourceData, recommendationId: "rec-frozen" };
    const db = client({ [call[0].where.dedupeKey]: { id: "task-frozen", status: "pending", sourceData: frozenSource } });
    db.recommendation.findUnique.mockResolvedValue({ id: "rec-frozen", status });
    await syncTopicalMapStoreTasks(db as any);
    expect(db.storeTask.upsert.mock.calls.some((item: any) => item[0].where.dedupeKey === call[0].where.dedupeKey)).toBe(false);
  });

  it("normalizes identity inputs so rule order and absolute target URLs produce the same dedupe key", async () => {
    const db = client();
    await syncTopicalMapStoreTasks(db as any);
    const first = db.storeTask.upsert.mock.calls.map((call: any) => call[0].create).find((task: any) => task.proposedState.action === "internal_link").dedupeKey;
    const changed = center();
    changed.work.internalLinks[0]!.ruleIds.reverse();
    changed.work.internalLinks[0]!.fromUrl = "https://agrikoph.com/collections/rice/";
    load.mockResolvedValue(changed);
    const again = client();
    await syncTopicalMapStoreTasks(again as any);
    const second = again.storeTask.upsert.mock.calls.map((call: any) => call[0].create).find((task: any) => task.proposedState.action === "internal_link").dedupeKey;
    expect(second).toBe(first);
  });

  it.each([
    ["invented fields", { drafts: [{ url: "/products/black-rice", seoTitle: "Black Rice Philippines", seoDescription: "Agriko black rice Philippines", handle: "invented", published: true }] }],
    ["overlong metadata", { drafts: [{ url: "/products/black-rice", seoTitle: "x".repeat(71), seoDescription: "x".repeat(161) }] }],
    ["ungrounded copy", { drafts: [{ url: "/products/black-rice", seoTitle: "Generic Store Product", seoDescription: "Buy a great item online today." }] }],
  ])("falls back to advisory for invalid AI output: %s", async (_name, response) => {
    chat.mockResolvedValue({ content: JSON.stringify(response), provider: "deepseek", model: "test" });
    const db = client();
    const result = await syncTopicalMapStoreTasks(db as any);
    expect(result.executable).toBe(1);
    const creates = db.storeTask.upsert.mock.calls.map((call: any) => call[0].create);
    expect(creates.filter((task: any) => task.sourceData.advisoryReason === "draft_unavailable")).toHaveLength(3);
  });

  it("uses no more than one AI call and falls back to advisory when AI is unavailable", async () => {
    chat.mockRejectedValue(new Error("offline"));
    const db = client();
    const result = await syncTopicalMapStoreTasks(db as any);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ executable: 1, advisory: 8, unchanged: 0, suppressed: 1 });
  });

  it("rejects empty and action-mismatched executable proposed states", () => {
    expect(TopicalMapStoreTaskProposedSchema.safeParse({ action: "seo_update", before: {}, after: {} }).success).toBe(false);
    expect(TopicalMapStoreTaskProposedSchema.safeParse({ action: "seo_update", before: { seoTitle: null }, after: { bodyHtml: "no" } }).success).toBe(false);
    expect(TopicalMapStoreTaskProposedSchema.safeParse({ action: "content_update", before: { bodyHtml: "old" }, after: { seoTitle: "no" } }).success).toBe(false);
    expect(TopicalMapStoreTaskProposedSchema.safeParse({ action: "internal_link", before: { bodyHtml: "old" }, after: {} }).success).toBe(false);
    expect(TopicalMapStoreTaskProposedSchema.safeParse({ action: "seo_update", before: { seoTitle: null, seoDescription: null }, after: { seoTitle: "Valid" } }).success).toBe(true);
  });

  it("rejects arbitrary advisory source types, reasons, domains, hashes, and URLs", () => {
    const valid = { source: "topical-map", strategyVersionId: "strategy-7", packageSha256: "a".repeat(64), ruleIds: ["rule:1"], ruleDomains: ["redirects"], sourceReferences: [{ kind: "rule", id: "rule:1" }], generationProvenance: "advisory_projection", targetType: "redirect", targetUrl: "/old", executable: false, advisoryReason: "redirect_execution_unsupported" };
    expect(TopicalMapStoreTaskSourceSchema.safeParse(valid).success).toBe(true);
    for (const bad of [{ ...valid, targetType: "anything" }, { ...valid, advisoryReason: "anything" }, { ...valid, ruleDomains: ["anything"] }, { ...valid, packageSha256: "short" }, { ...valid, targetUrl: "javascript:alert(1)" }]) {
      expect(TopicalMapStoreTaskSourceSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("treats AI content as plain text and escapes script, javascript, events, ampersands, and quotes", async () => {
    chat.mockResolvedValue({ content: JSON.stringify({ drafts: [
      { url: "/products/black-rice", seoTitle: "Black Rice Philippines", seoDescription: "Agriko black rice Philippines" },
      { url: "/collections/rice", sectionText: 'Philippine heirloom rice <script>alert("x")</script> javascript: onerror="run" & safe' },
      { url: "/pages/our-farm", seoTitle: "Agriko Farm Story", seoDescription: "Agriko farm story Philippines" },
    ] }), provider: "deepseek", model: "test" });
    const db = client();
    await syncTopicalMapStoreTasks(db as any);
    const content = db.storeTask.upsert.mock.calls.map((call: any) => call[0].create).find((task: any) => task.proposedState.action === "content_update");
    expect(content.proposedState.after.bodyHtml).toBe('<p>Existing Rice body.</p><section><p>Philippine heirloom rice &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; javascript: onerror=&quot;run&quot; &amp; safe</p></section>');
    expect(content.proposedState.after.bodyHtml).not.toContain("<script>");
  });
});
