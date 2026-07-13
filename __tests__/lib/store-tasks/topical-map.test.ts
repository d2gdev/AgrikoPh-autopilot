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

const observedAt = new Date("2026-07-13T02:00:00.000Z");
const resource = (type: "product" | "collection" | "page", url: string, title: string) => ({
  id: `gid://${url}`, type, url, handle: url.split("/").at(-1), title,
  seoTitle: `Old ${title}`, seoDescription: `Old description for ${title}`,
  bodyHtml: `<p>Existing ${title} body.</p>`, updatedAt: observedAt,
  stateHash: `hash:${url}`, internalTargets: [],
});
const center = () => ({
  identity: { versionId: "strategy-7", strategyVersion: "7", contractRevision: "3", packageSha256: "package-sha", activatedAt: "2026-07-12T00:00:00.000Z" },
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
      { fromUrl: "/blogs/news/black-rice-guide", toUrl: "/products/black-rice", ruleIds: ["link:article"], recommendedAnchor: "black rice", priority: "high" },
    ],
    redirects: [{ source: "/old", finalTarget: "/products/black-rice", ruleIds: ["redirect:1"] }],
    canonicalization: [{ currentUrl: "/products/black-rice", proposedCanonicalUrl: "/products/black-rice", ruleIds: ["canonical:1"] }],
    indexation: [{ currentUrl: "/products/black-rice", proposedCanonicalUrl: "/products/black-rice", ruleIds: ["index:1"] }],
  },
});

function client(existing: Record<string, { status: string }> = {}) {
  const rows = new Map(Object.entries(existing));
  return {
    topicalMapActivation: { findUnique: vi.fn() },
    storeTask: {
      findUnique: vi.fn(async ({ where }: any) => rows.get(where.dedupeKey) ?? null),
      upsert: vi.fn(async ({ where, create, update }: any) => { rows.set(where.dedupeKey, { ...create, ...update, status: "pending" }); return rows.get(where.dedupeKey); }),
    },
  };
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
    { url: "/collections/rice", sectionHtml: "<h2>Philippine heirloom rice</h2><p>Explore Agriko's heirloom rice collection.</p>" },
    { url: "/pages/our-farm", seoTitle: "Our Farm | Agriko Philippine Heirloom Rice", seoDescription: "Learn about the Agriko farm story and our Philippine heirloom rice." },
  ] }), provider: "deepseek", model: "test" });
});

describe("syncTopicalMapStoreTasks", () => {
  it("projects only governed non-blog resources, keeps technical work advisory, and suppresses missing observations", async () => {
    const db = client();
    const result = await syncTopicalMapStoreTasks(db as any);
    expect(result).toEqual({ executable: 4, advisory: 5, unchanged: 0, suppressed: 1 });
    expect(chat).toHaveBeenCalledTimes(1);
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

  it("persists exact provenance/current state and deterministic sanitized internal-link output", async () => {
    const db = client();
    await syncTopicalMapStoreTasks(db as any);
    const tasks = db.storeTask.upsert.mock.calls.map((call: any) => call[0].create);
    const link = tasks.find((task: any) => task.proposedState.action === "internal_link");
    expect(link.sourceData).toEqual({ source: "topical-map", strategyVersionId: "strategy-7", packageSha256: "package-sha", ruleIds: ["link:a", "link:z"], ruleDomains: ["internal_links"], targetType: "collection", targetUrl: "/collections/rice", observedAt: observedAt.toISOString(), observedStateHash: "hash:/collections/rice", executable: true });
    expect(link.proposedState).toEqual({ action: "internal_link", before: { bodyHtml: "<p>Existing Rice body.</p>" }, after: { bodyHtml: '<p>Existing Rice body.</p><p><a href="/products/black-rice">shop black rice</a></p>' } });
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
});
