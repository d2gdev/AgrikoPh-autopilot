import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { NextRequest } from "next/server";
import {
  createMapAnalysisEnvelope,
  mapCandidateId,
  type MapAwareSeoGap,
} from "@/lib/seo/analysis";

const mockAuth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  requirePermission: vi.fn(),
  getSessionShop: vi.fn(),
  getSessionUser: vi.fn(),
}));

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  articleRecord: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  contentProposal: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    findUnique: vi.fn(),
  },
  rawSnapshot: {
    upsert: vi.fn(),
  },
  topicalMapActivation: { findUnique: vi.fn() },
  auditLog: {
    create: vi.fn(),
  },
  keywordResearchResult: {
    findMany: vi.fn(),
  },
  marketKeyword: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
}));

const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockSeoData = vi.hoisted(() => ({
  getLatestGscData: vi.fn(),
  getLatestGa4Data: vi.fn(),
  getPreviousGscQueries: vi.fn(),
  getPreviousGscData: vi.fn(),
  getSeoHistoryTrend: vi.fn(),
}));
const mockGroundSeoBriefContext = vi.hoisted(() => vi.fn(async (content: string) => content));
const mockGetAiClient = vi.hoisted(() => vi.fn());
const mockChatCompletion = vi.hoisted(() => vi.fn());
const mockJobs = vi.hoisted(() => ({
  fetchSeoDataHandler: vi.fn(),
  fetchGscDataHandler: vi.fn(),
  snapshotSeoHistoryHandler: vi.fn(),
  acquireJobLock: vi.fn(),
  releaseJobLock: vi.fn(),
}));
const mockEnqueueJob = vi.hoisted(() => vi.fn());
const mockMaterializeJobsStatusSnapshot = vi.hoisted(() => vi.fn());
const mockSyncTopicalMapStoreTasks = vi.hoisted(() => vi.fn());
const mockSyncTopicalMapSeoTasks = vi.hoisted(() => vi.fn());
const mockCreateGovernedContentProposal = vi.hoisted(() => vi.fn());
const mockGetLatestSnapshot = vi.hoisted(() => vi.fn());
const mockGetBlockingMapContentProposals = vi.hoisted(() => vi.fn());
const mockHasReadyMappedContentTask = vi.hoisted(() => vi.fn());
const mockGetActionableMapContentCandidateIds = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  requireAppAuth: mockAuth.requireAppAuth,
  requirePermission: mockAuth.requirePermission,
  getSessionShop: mockAuth.getSessionShop,
  getSessionUser: mockAuth.getSessionUser,
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/seo/snapshot", () => ({ getLatestSnapshot: mockGetLatestSnapshot }));
vi.mock("@/lib/topical-map/compliance-store", () => ({
  createGovernedContentProposal: mockCreateGovernedContentProposal,
  createGovernedContentProposalInTransaction: mockCreateGovernedContentProposal,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/seo/data", () => mockSeoData);
vi.mock("@/lib/ai/client", () => ({ getAiClient: mockGetAiClient, chatCompletionWithFailover: mockChatCompletion }));
vi.mock("@/lib/seo/brief-grounding", () => ({ groundSeoBriefContext: mockGroundSeoBriefContext }));
vi.mock("@/jobs/fetch-seo-data", () => ({ fetchSeoDataHandler: mockJobs.fetchSeoDataHandler }));
vi.mock("@/jobs/fetch-gsc-data", () => ({ fetchGscDataHandler: mockJobs.fetchGscDataHandler }));
vi.mock("@/jobs/snapshot-seo-history", () => ({ snapshotSeoHistoryHandler: mockJobs.snapshotSeoHistoryHandler }));
vi.mock("@/lib/job-lock", () => ({
  acquireJobLock: mockJobs.acquireJobLock,
  releaseJobLock: mockJobs.releaseJobLock,
}));
vi.mock("@/lib/jobs/orchestrator", () => ({
  enqueueJob: (...args: Parameters<typeof mockEnqueueJob>) => mockEnqueueJob(...args),
}));
vi.mock("@/lib/dashboard/jobs-status", () => ({
  materializeJobsStatusSnapshot: (...args: Parameters<typeof mockMaterializeJobsStatusSnapshot>) => mockMaterializeJobsStatusSnapshot(...args),
}));
vi.mock("@/lib/store-tasks/topical-map", () => ({
  syncTopicalMapStoreTasks: mockSyncTopicalMapStoreTasks,
}));
vi.mock("@/lib/seo-tasks/topical-map-scheduler", () => ({
  syncTopicalMapSeoTasks: mockSyncTopicalMapSeoTasks,
}));
vi.mock("@/lib/content-pilot/map-candidate-history", () => ({
  getActionableMapContentCandidateIds: mockGetActionableMapContentCandidateIds,
  getBlockingMapContentProposals: mockGetBlockingMapContentProposals,
  hasReadyMappedContentTask: mockHasReadyMappedContentTask,
}));

function jsonRequest(path: string, body: Record<string, unknown>, method = "POST") {
  return new Request(`http://test.local${path}`, {
    method,
    body: JSON.stringify(body),
  }) as NextRequest;
}

const strategyIdentity = { strategyVersionId: "v3", packageSha256: "a".repeat(64) };
const makeGap = (input: Omit<MapAwareSeoGap, "candidateId">): MapAwareSeoGap => ({
  ...input,
  candidateId: mapCandidateId(input),
});

describe("SEO Pilot route regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.requirePermission.mockResolvedValue(null);
    mockAuth.getSessionShop.mockResolvedValue(null);
    mockAuth.getSessionUser.mockResolvedValue("api-key");
    mockCheckRateLimit.mockReturnValue(true);
    mockPrisma.$transaction.mockImplementation(async (cb) => cb(mockPrisma));
    mockCreateGovernedContentProposal.mockImplementation(async (_db, { data }) => ({
      created: true,
      proposal: await mockPrisma.contentProposal.create({ data }),
      compliance: { result: "compliant", executionAuthorized: false },
    }));
    mockPrisma.contentProposal.findMany.mockResolvedValue([]);
    mockPrisma.contentProposal.createMany.mockImplementation(async ({ data }) => { const p = await mockPrisma.contentProposal.create({ data: data[0] }); mockPrisma.contentProposal.findUnique.mockResolvedValue(p); return { count: 1 }; });
    mockPrisma.contentProposal.findUnique.mockResolvedValue({ id: "proposal-1" });
    mockPrisma.articleRecord.findMany.mockResolvedValue([]);
    mockPrisma.articleRecord.findUnique.mockResolvedValue({ updatedAt: new Date(), linksData: { internal: [] } });
    mockPrisma.topicalMapActivation.findUnique.mockResolvedValue({ strategyVersion: {
      id: "v3", strategyVersion: "3", contractRevision: 3, packageSha256: "a".repeat(64), activatedAt: new Date("2026-07-13T00:00:00Z"), lifecycle: "active", validationStatus: "valid",
      compiledRules: [...[
        ["rule:mapped", "/blogs/news/mapped", "create"], ["rule:black", "/blogs/news/black-rice-benefits", "update"],
        ["rule:ghost", "/blogs/news/ghost-handle", "update"], ["rule:target", "/blogs/news/target-article", "update"],
        ["rule:collection", "/collections/black-rice", "update"],
      ].map(([ruleId, currentUrl, decision]) => ({ ruleId, ruleType: "content_decisions", sourceArtifactId: "map", compiledPayload: { payload: { currentUrl, decision, priority: "high", primaryKeywordOrTheme: ruleId === "rule:mapped" ? "mapped topic" : "black rice benefits", secondaryVariants: "variant one; variant two", contentKind: "article", publishingState: "published", exactTargetIfAny: currentUrl, ...(ruleId === "rule:mapped" ? { title: "Active Map Article Title" } : {}), ...(ruleId === "rule:black" ? { title: "Active Black Rice Map Title", evidence: "Refresh using current search performance." } : {}) }, sourceReferences: [], resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } })),
        { ruleId: "rule:link", ruleType: "internal_links", sourceArtifactId: "internal-links", compiledPayload: { payload: { fromUrl: "/blogs/news/source", toUrl: "/blogs/news/mapped", currentBodyState: "absent", requiredAction: "add", recommendedAnchor: "mapped topic", linkPurpose: "supporting context", priority: "high", verification: "Exact href is present" }, sourceReferences: [], resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } },
      ],
    } });
    mockPrisma.rawSnapshot.upsert.mockResolvedValue({});
    mockGetLatestSnapshot.mockResolvedValue(null);
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.keywordResearchResult.findMany.mockResolvedValue([]);
    mockPrisma.marketKeyword.findFirst.mockResolvedValue(null);
    mockPrisma.marketKeyword.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.marketKeyword.create.mockResolvedValue({});
    mockPrisma.marketKeyword.update.mockResolvedValue({});
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [],
      pages: [],
      queryPagePairs: [],
      fetchedAt: null,
      source: "none",
      window: null,
    });
    mockSeoData.getSeoHistoryTrend.mockResolvedValue([]);
    mockSeoData.getPreviousGscQueries.mockResolvedValue([{ query: "previous", clicks: 1, impressions: 2, ctr: "50%", position: "5" }]);
    mockSeoData.getLatestGa4Data.mockResolvedValue({
      pages: [],
      fetchedAt: null,
      source: "none",
      window: null,
    });
    mockSeoData.getPreviousGscQueries.mockResolvedValue([]);
    mockSeoData.getPreviousGscData.mockImplementation(async () => {
      const queries = await mockSeoData.getPreviousGscQueries();
      return queries ? { queries, fetchedAt: new Date("2026-06-01T00:00:00.000Z"), dateRangeStart: new Date("2026-05-01T00:00:00.000Z"), dateRangeEnd: new Date("2026-05-31T00:00:00.000Z"), source: "rawSnapshot" } : null;
    });
    mockGetAiClient.mockResolvedValue({
      model: "test-model",
      client: {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: "- Improve titles on high-impression pages." } }],
            }),
          },
        },
      },
    });
    mockChatCompletion.mockResolvedValue({
      content: "- Improve titles on high-impression pages.",
      provider: "deepseek",
      model: "test-model",
    });
    mockJobs.acquireJobLock.mockResolvedValue(true);
    mockJobs.releaseJobLock.mockResolvedValue(undefined);
    mockSyncTopicalMapStoreTasks.mockResolvedValue({ executable: 3, advisory: 4, unchanged: 5, suppressed: 6 });
    mockSyncTopicalMapSeoTasks.mockResolvedValue({
      status: "synced",
      strategyVersionId: "v3",
      projected: 1,
      created: 1,
      existing: 0,
      superseded: 0,
    });
    mockHasReadyMappedContentTask.mockResolvedValue(true);
    mockGetActionableMapContentCandidateIds.mockImplementation(
      async (_client, input: { gaps: MapAwareSeoGap[] }) =>
        new Set(input.gaps.filter((gap) => gap.kind === "content").map((gap) => gap.candidateId)),
    );
    mockEnqueueJob.mockResolvedValue({
      created: true,
      runId: "dashboard-run",
      status: "queued",
    });
    mockMaterializeJobsStatusSnapshot.mockResolvedValue(undefined);
    mockGetBlockingMapContentProposals.mockResolvedValue(new Map());
  });

  it("signals a stale strategy analysis without returning its content", async () => {
    mockGetLatestSnapshot.mockResolvedValue({
      fetchedAt: new Date("2026-07-12T00:00:00.000Z"),
      payload: {
        schemaVersion: "2",
        strategy: { versionId: "v2", packageSha256: "b".repeat(64) },
        generatedAt: "2026-07-12T00:00:00.000Z",
        analysis: { gaps: [{ secret: "stale finding" }], observations: [], suppressed: [] },
      },
    });
    const { GET } = await import("@/app/api/seo/analysis/route");

    const res = await GET(new Request("http://test.local/api/seo/analysis") as NextRequest);
    const body = await res.json();

    expect(body).toEqual({
      state: "strategy_identity_stale",
      analysis: null,
      generatedAt: null,
      strategy: expect.objectContaining({ versionId: "v3", packageSha256: "a".repeat(64) }),
      cachedStrategy: { versionId: "v2", packageSha256: "b".repeat(64) },
    });
    expect(JSON.stringify(body)).not.toContain("stale finding");
  });

  it("hides content gaps that are not current Ready mapped work", async () => {
    const capturedAt = new Date();
    const ready = makeGap({
      strategyVersionId: "v3",
      packageSha256: "a".repeat(64),
      kind: "content",
      state: "candidate",
      action: "refresh",
      ruleIds: ["rule:black"],
      query: "black rice benefits",
      suggestedTitle: "Black Rice Benefits",
      page: "/blogs/news/black-rice-benefits",
      priority: "high",
      mapEvidence: null,
      observedEvidence: [],
      observation: {
        source: "store",
        capturedAt: capturedAt.toISOString(),
        provenance: "ArticleRecord:news/black-rice-benefits",
      },
    });
    const handled = makeGap({
      ...ready,
      ruleIds: ["rule:ghost"],
      query: "ghost",
      suggestedTitle: "Handled Ghost",
      page: "/blogs/news/ghost-handle",
      observation: {
        source: "store",
        capturedAt: capturedAt.toISOString(),
        provenance: "ArticleRecord:news/ghost-handle",
      },
    });
    const payload = createMapAnalysisEnvelope({
      strategy: { versionId: "v3", packageSha256: "a".repeat(64) },
      generatedAt: capturedAt,
      analysis: { gaps: [ready, handled], observations: [], suppressed: [] },
      evidence: {
        gscCapturedAt: capturedAt.toISOString(),
        storeCapturedAt: null,
        linkCapturedAt: null,
        requiredObservationFamilies: [],
        storeInspection: { required: 0, inspected: 0 },
        linkInspection: { required: 0, inspected: 0 },
        maxAgeHours: 72,
      },
    });
    mockGetLatestSnapshot.mockResolvedValue({ payload, fetchedAt: capturedAt });
    mockGetActionableMapContentCandidateIds.mockResolvedValue(new Set([ready.candidateId]));

    const { GET } = await import("@/app/api/seo/analysis/route");
    const response = await GET(new Request("http://test.local/api/seo/analysis") as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.analysis.gaps).toEqual([ready]);
  });

  it("hides link candidates whose observed article state is no longer current", async () => {
    const capturedAt = new Date();
    const currentHash = "b".repeat(64);
    const stale = makeGap({
      strategyVersionId: "v3",
      packageSha256: "a".repeat(64),
      kind: "link",
      state: "candidate",
      action: "update",
      ruleIds: ["rule:link"],
      query: "mapped topic",
      suggestedTitle: "Add stale link",
      page: "/blogs/news/source",
      fromUrl: "/blogs/news/source",
      toUrl: "/blogs/news/mapped",
      type: "internal-link",
      priority: "high",
      mapEvidence: null,
      observedEvidence: [],
      observation: {
        source: "link_inspection",
        capturedAt: capturedAt.toISOString(),
        provenance: "ArticleRecord.linksData:/blogs/news/source",
        stateHash: "c".repeat(64),
      },
    });
    const current = makeGap({
      ...stale,
      ruleIds: ["rule:current-link"],
      suggestedTitle: "Add current link",
      page: "/blogs/news/current-source",
      fromUrl: "/blogs/news/current-source",
      observation: {
        source: "link_inspection",
        capturedAt: capturedAt.toISOString(),
        provenance: "ArticleRecord.linksData:/blogs/news/current-source",
        stateHash: currentHash,
      },
    });
    const payload = createMapAnalysisEnvelope({
      strategy: { versionId: "v3", packageSha256: "a".repeat(64) },
      generatedAt: capturedAt,
      analysis: { gaps: [stale, current], observations: [], suppressed: [] },
      evidence: {
        gscCapturedAt: capturedAt.toISOString(),
        storeCapturedAt: null,
        linkCapturedAt: capturedAt.toISOString(),
        requiredObservationFamilies: ["link_inspection"],
        storeInspection: { required: 0, inspected: 0 },
        linkInspection: { required: 2, inspected: 2 },
        maxAgeHours: 72,
      },
    });
    mockGetLatestSnapshot.mockResolvedValue({ payload, fetchedAt: capturedAt });
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        blogHandle: "news",
        handle: "source",
        contentHash: "d".repeat(64),
        updatedAt: capturedAt,
      },
      {
        blogHandle: "news",
        handle: "current-source",
        contentHash: currentHash,
        updatedAt: capturedAt,
      },
    ]);

    const { GET } = await import("@/app/api/seo/analysis/route");
    const response = await GET(new Request("http://test.local/api/seo/analysis") as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.analysis.gaps).toEqual([current]);
  });

  it("round-trips the POST schema-v2 map analysis through the GET reader", async () => {
    const active = await mockPrisma.topicalMapActivation.findUnique();
    mockPrisma.topicalMapActivation.findUnique.mockResolvedValue({ strategyVersion: { ...active.strategyVersion, compiledRules: active.strategyVersion.compiledRules.filter((rule: { ruleId: string }) => rule.ruleId !== "rule:collection") } });
    const capturedAt = new Date();
    mockSeoData.getLatestGscData.mockResolvedValue({ queries: [{ query: "mapped topic", clicks: 0, impressions: 40, ctr: "0%", position: "8" }], pages: [], queryPagePairs: [], fetchedAt: capturedAt, source: "normalized", window: null });
    mockPrisma.articleRecord.findMany.mockResolvedValue([{ blogHandle: "news", handle: "source", title: "Source", contentHash: "e".repeat(64), wordCount: 500, internalLinkCount: 0, seoData: {}, linksData: { internal: [] }, updatedAt: capturedAt }]);
    const { POST } = await import("@/app/api/seo/analyze/route");
    const post = await POST(jsonRequest("/api/seo/analyze", {}));
    expect(post.status).toBe(200);
    const posted = await post.json();
    expect(mockPrisma.articleRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: expect.arrayContaining([
      { blogHandle: "news", handle: "mapped" },
      { blogHandle: "news", handle: "black-rice-benefits" },
      { blogHandle: "news", handle: "source" },
    ]) } }));
    const payload = mockPrisma.rawSnapshot.upsert.mock.calls.at(-1)?.[0]?.update?.payload;
    expect(payload.analysis).toEqual(posted.mapAnalysis);
    expect(payload.analysis).toEqual({ gaps: expect.any(Array), observations: expect.any(Array), suppressed: expect.any(Array) });
    mockGetLatestSnapshot.mockResolvedValue({ payload, fetchedAt: new Date(posted.generatedAt) });
    const { GET } = await import("@/app/api/seo/analysis/route");
    const get = await GET(new Request("http://test.local/api/seo/analysis") as NextRequest);
    expect(await get.json()).toEqual(expect.objectContaining({ state: "ready", analysis: posted.mapAnalysis }));
  });

  it("round-trips a fully inspected zero-gap map as ready with empty gaps", async () => {
    const active = await mockPrisma.topicalMapActivation.findUnique();
    mockPrisma.topicalMapActivation.findUnique.mockResolvedValue({ strategyVersion: { ...active.strategyVersion, compiledRules: active.strategyVersion.compiledRules.filter((rule: { ruleId: string }) => rule.ruleId !== "rule:collection") } });
    const capturedAt = new Date();
    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    mockSeoData.getLatestGscData.mockResolvedValue({ queries: [{ query: "mapped topic", clicks: 1, impressions: 40, ctr: "2%", position: "8" }], pages: [], queryPagePairs: [], fetchedAt: capturedAt, source: "normalized", window: null });
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      { handle: "mapped", title: "Mapped", wordCount: 500, internalLinkCount: 1, seoData: {}, linksData: {}, indexedAt: createdAt, updatedAt: capturedAt },
      { handle: "source", title: "Source", wordCount: 500, internalLinkCount: 1, seoData: {}, linksData: { internal: [{ href: "/blogs/news/mapped" }] }, indexedAt: createdAt, updatedAt: capturedAt },
    ]);
    const { POST } = await import("@/app/api/seo/analyze/route");
    const post = await POST(jsonRequest("/api/seo/analyze", {}));
    expect(post.status).toBe(200);
    const posted = await post.json();
    expect(posted.mapAnalysis.gaps).toEqual([]);
    const payload = mockPrisma.rawSnapshot.upsert.mock.calls.at(-1)?.[0]?.update?.payload;
    expect(payload.evidence).toEqual(expect.objectContaining({ requiredObservationFamilies: ["store", "link_inspection"], storeInspection: { required: 4, inspected: 4 }, linkInspection: { required: 1, inspected: 1 }, storeCapturedAt: capturedAt.toISOString(), linkCapturedAt: capturedAt.toISOString() }));
    mockGetLatestSnapshot.mockResolvedValue({ payload, fetchedAt: capturedAt });
    const { GET } = await import("@/app/api/seo/analysis/route");
    const get = await GET(new Request("http://test.local/api/seo/analysis") as NextRequest);
    expect(await get.json()).toEqual(expect.objectContaining({ state: "ready", analysis: expect.objectContaining({ gaps: [] }) }));
  });

  it("uses exact blogHandle plus handle identity for recipe analysis", async () => {
    const active = await mockPrisma.topicalMapActivation.findUnique();
    const exactRules = [
      { ruleId: "rule:news-shared", ruleType: "content_decisions", sourceArtifactId: "map", compiledPayload: { payload: { currentUrl: "/blogs/news/shared", decision: "update", priority: "high" }, sourceReferences: [], resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } },
      { ruleId: "rule:recipe", ruleType: "content_decisions", sourceArtifactId: "map", compiledPayload: { payload: { currentUrl: "/blogs/recipes/shared", decision: "update", priority: "high" }, sourceReferences: [], resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } },
    ];
    mockPrisma.topicalMapActivation.findUnique.mockResolvedValue({ strategyVersion: { ...active.strategyVersion, compiledRules: [...active.strategyVersion.compiledRules, ...exactRules] } });
    const capturedAt = new Date();
    mockSeoData.getLatestGscData.mockResolvedValue({ queries: [{ query: "shared recipe", clicks: 1, impressions: 40, ctr: "2%", position: "8" }], pages: [], queryPagePairs: [], fetchedAt: capturedAt, source: "normalized", window: null });
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      { blogHandle: "news", handle: "shared", title: "News Shared", wordCount: 500, internalLinkCount: 1, seoData: {}, linksData: {}, updatedAt: capturedAt },
      { blogHandle: "recipes", handle: "shared", title: "Recipe Shared", wordCount: 500, internalLinkCount: 1, seoData: {}, linksData: {}, updatedAt: capturedAt },
    ]);

    const { POST } = await import("@/app/api/seo/analyze/route");
    const response = await POST(jsonRequest("/api/seo/analyze", {}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mapAnalysis.gaps).toContainEqual(expect.objectContaining({ page: "/blogs/news/shared", action: "refresh", ruleIds: ["rule:news-shared"] }));
    expect(body.mapAnalysis.gaps).toContainEqual(expect.objectContaining({ page: "/blogs/recipes/shared", action: "refresh", ruleIds: ["rule:recipe"] }));
    expect(body.mapAnalysis.gaps.find((gap: any) => gap.page === "/blogs/recipes/shared")?.observation.provenance).toBe("ArticleRecord:recipes/shared");
  });

  it("withholds a persisted zero-gap map when a required link inspection is missing", async () => {
    const capturedAt = new Date();
    mockSeoData.getLatestGscData.mockResolvedValue({ queries: [{ query: "mapped topic", clicks: 1, impressions: 40, ctr: "2%", position: "8" }], pages: [], queryPagePairs: [], fetchedAt: capturedAt, source: "normalized", window: null });
    mockPrisma.articleRecord.findMany.mockResolvedValue([{ handle: "mapped", title: "Mapped", wordCount: 500, internalLinkCount: 1, seoData: {}, linksData: {}, updatedAt: capturedAt }]);
    const { POST } = await import("@/app/api/seo/analyze/route");
    const post = await POST(jsonRequest("/api/seo/analyze", {}));
    expect(post.status).toBe(200);
    const payload = mockPrisma.rawSnapshot.upsert.mock.calls.at(-1)?.[0]?.update?.payload;
    expect(payload.evidence.linkInspection).toEqual({ required: 1, inspected: 0 });
    mockGetLatestSnapshot.mockResolvedValue({ payload, fetchedAt: capturedAt });
    const { GET } = await import("@/app/api/seo/analysis/route");
    const get = await GET(new Request("http://test.local/api/seo/analysis") as NextRequest);
    expect(await get.json()).toEqual(expect.objectContaining({ state: "observation_unavailable", analysis: null }));
  });

  it("does not let intentionally unsupported non-blog map pages block inspected blog actions", async () => {
    const active = await mockPrisma.topicalMapActivation.findUnique();
    mockPrisma.topicalMapActivation.findUnique.mockResolvedValue({ strategyVersion: {
      ...active.strategyVersion,
      compiledRules: [
        ...active.strategyVersion.compiledRules.filter((rule: { ruleId: string }) => rule.ruleId !== "rule:collection"),
        { ruleId: "rule:product", ruleType: "content_decisions", sourceArtifactId: "map", compiledPayload: { payload: { currentUrl: "/products/pure-ginger", decision: "update", priority: "high" }, sourceReferences: [], resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } },
      ],
    } });
    const capturedAt = new Date();
    mockSeoData.getLatestGscData.mockResolvedValue({ queries: [{ query: "mapped topic", clicks: 1, impressions: 40, ctr: "2%", position: "8" }], pages: [], queryPagePairs: [], fetchedAt: capturedAt, source: "normalized", window: null });
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      { handle: "mapped", title: "Mapped", wordCount: 500, internalLinkCount: 1, seoData: {}, linksData: {}, updatedAt: capturedAt },
      { handle: "source", title: "Source", wordCount: 500, internalLinkCount: 1, seoData: {}, linksData: { internal: [{ href: "/blogs/news/mapped" }] }, updatedAt: capturedAt },
    ]);

    const { POST } = await import("@/app/api/seo/analyze/route");
    const post = await POST(jsonRequest("/api/seo/analyze", {}));
    expect(post.status).toBe(200);
    const posted = await post.json();
    expect(posted.mapAnalysis.suppressed).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: "/products/pure-ginger", reason: expect.stringContaining("observation_unavailable") }),
    ]));
    const payload = mockPrisma.rawSnapshot.upsert.mock.calls.at(-1)?.[0]?.update?.payload;
    expect(payload.evidence.storeInspection.inspected).toBe(payload.evidence.storeInspection.required);
    mockGetLatestSnapshot.mockResolvedValue({ payload, fetchedAt: capturedAt });
    const { GET } = await import("@/app/api/seo/analysis/route");
    const get = await GET(new Request("http://test.local/api/seo/analysis") as NextRequest);
    expect(await get.json()).toEqual(expect.objectContaining({ state: "ready", analysis: expect.any(Object) }));
  });

  it("rejects arbitrary non-SEO history sources", async () => {
    const { GET } = await import("@/app/api/seo/history/route");
    const res = await GET(new Request("http://test.local/api/seo/history?source=meta_ads") as NextRequest);
    expect(res.status).toBe(400);
    expect(mockSeoData.getSeoHistoryTrend).not.toHaveBeenCalled();
  });

  it("promotes missing meta as a publishable seo-fix proposal", async () => {
    mockPrisma.articleRecord.findUnique.mockResolvedValue({
      handle: "black-rice",
      title: "Black Rice Benefits",
      wordCount: 760,
    });
    mockPrisma.contentProposal.findFirst.mockResolvedValue(null);
    mockPrisma.contentProposal.create.mockResolvedValue({ id: "proposal-1" });
    const { POST } = await import("@/app/api/seo/promote/route");

    const res = await POST(jsonRequest("/api/seo/promote", {
      handle: "black-rice",
      title: "Client title ignored",
      issue: "missing-meta",
      targetUrl: "/blogs/news/black-rice",
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ id: "proposal-1", existed: false });
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        articleHandle: "black-rice",
        proposalType: "seo-fix",
        title: "Fix meta: Black Rice Benefits",
        proposedState: expect.objectContaining({
          articleTitle: "Black Rice Benefits",
          targetQuery: "Black Rice Benefits",
        }),
      }),
    });
  });

  it("promotes missing H1 as a body refresh with add_h1 intent", async () => {
    mockPrisma.articleRecord.findUnique.mockResolvedValue({
      handle: "moringa",
      title: "Moringa Benefits",
      wordCount: 420,
    });
    mockPrisma.contentProposal.findFirst.mockResolvedValue(null);
    mockPrisma.contentProposal.create.mockResolvedValue({ id: "proposal-2" });
    const { POST } = await import("@/app/api/seo/promote/route");

    const res = await POST(jsonRequest("/api/seo/promote", {
      handle: "moringa",
      title: "Moringa Benefits",
      wordCount: 9_999,
      issue: "missing-h1",
      targetUrl: "/blogs/news/moringa",
    }));

    expect(res.status).toBe(200);
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        articleHandle: "moringa",
        proposalType: "content-refresh",
        title: "Add heading structure: Moringa Benefits",
        proposedState: expect.objectContaining({
          action: "add_h1",
          issue: "missing-h1",
          currentWordCount: 420,
          targetWordCount: 500,
        }),
      }),
    });
  });

  it("builds keyword status from normalized GSC data", async () => {
    mockPrisma.marketKeyword.findMany.mockResolvedValue([{ keyword: "black rice benefits" }]);
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [{ query: "black rice benefits", clicks: 12, impressions: 400, ctr: "3.0%", position: "8.1" }],
      pages: [],
      queryPagePairs: [],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    mockSeoData.getPreviousGscQueries.mockResolvedValue([
      { query: "black rice benefits", clicks: 8, impressions: 300, ctr: "2.7%", position: "12.5" },
    ]);
    const { GET } = await import("@/app/api/seo/keywords/route");

    const res = await GET(new Request("http://test.local/api/seo/keywords") as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.keywords).toEqual([
      expect.objectContaining({
        keyword: "black rice benefits",
        position: 8.1,
        clicks: 12,
        impressions: 400,
        status: "improved",
      }),
    ]);
    expect(mockSeoData.getLatestGscData).toHaveBeenCalled();
  });

  it("retires body-authored topical-map promotion after authentication and permission checks", async () => {
    const { POST } = await import("@/app/api/seo/gaps/promote/route");

    const res = await POST(jsonRequest("/api/seo/gaps/promote", {
      gaps: [{ query: "x", suggestedTitle: "short" }],
    }));

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "This endpoint is retired. Use persisted candidate selection.", code: "ENDPOINT_RETIRED" });
    expect(mockPrisma.contentProposal.create).not.toHaveBeenCalled();
    expect(mockCreateGovernedContentProposal).not.toHaveBeenCalled();
  });

  it("creates selected persisted candidates independently and returns exact per-candidate outcomes", async () => {
    const capturedAt = new Date().toISOString();
    const makeGap = (input: Omit<MapAwareSeoGap, "candidateId">): MapAwareSeoGap => ({ ...input, candidateId: mapCandidateId(input) });
    const createGap = makeGap({ ...strategyIdentity, kind: "content", state: "candidate", action: "create", ruleIds: ["rule:mapped"], query: "mapped topic", suggestedTitle: "Mapped topic guide", page: "/blogs/news/mapped", priority: "high", mapEvidence: null, observedEvidence: [], observation: { source: "store", capturedAt, provenance: "ArticleRecord:absence:/blogs/news/mapped" } });
    const refreshGap = makeGap({ ...strategyIdentity, kind: "content", state: "candidate", action: "refresh", ruleIds: ["rule:black"], query: "black rice benefits", suggestedTitle: "Black Rice Benefits", page: "/blogs/news/black-rice-benefits", priority: "high", mapEvidence: "Refresh using current search performance.", observedEvidence: [], observation: { source: "store", capturedAt, provenance: "ArticleRecord:news/black-rice-benefits" } });
    mockGetLatestSnapshot.mockResolvedValue({ payload: { schemaVersion: "2", strategy: { versionId: "v3", packageSha256: strategyIdentity.packageSha256 }, generatedAt: capturedAt, analysis: { gaps: [createGap, refreshGap], observations: [], suppressed: [] }, evidence: { gscCapturedAt: capturedAt, storeCapturedAt: capturedAt, linkCapturedAt: null, requiredObservationFamilies: ["store"], storeInspection: { required: 2, inspected: 2 }, linkInspection: { required: 0, inspected: 0 }, maxAgeHours: 72 } }, fetchedAt: new Date(capturedAt) });
    mockPrisma.articleRecord.findFirst.mockImplementation(async ({ where }) => where.handle === "mapped" ? null : { blogHandle: "news", handle: "black-rice-benefits", title: "Black Rice Benefits", wordCount: 400, updatedAt: new Date(capturedAt), linksData: { internal: [] } });
    mockCreateGovernedContentProposal
      .mockResolvedValueOnce({ created: true, proposal: { id: "created-1", title: "Mapped topic guide" }, compliance: { result: "compliant" } })
      .mockRejectedValueOnce(new Error("isolated persistence failure"));
    const { POST } = await import("@/app/api/seo/gaps/promote-selected/route");

    const response = await POST(jsonRequest("/api/seo/gaps/promote-selected", { ...strategyIdentity, analysisGeneratedAt: capturedAt, candidateIds: [createGap.candidateId, refreshGap.candidateId, "f".repeat(64)] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toEqual([
      { candidateId: createGap.candidateId, status: "created", proposalId: "created-1" },
      { candidateId: refreshGap.candidateId, status: "failed" },
      { candidateId: "f".repeat(64), status: "stale_or_blocked" },
    ]);
    expect(body.counts).toEqual({ created: 1, already_existing: 0, stale_or_blocked: 1, failed: 1 });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "seo_map_candidate_promoted", entityId: "created-1", meta: expect.objectContaining({ candidateId: createGap.candidateId }) }) });
    expect(mockCreateGovernedContentProposal.mock.calls[0]![1].data).toMatchObject({
      title: "Active Map Article Title",
      proposedState: { title: "Active Map Article Title", targetKeyword: "mapped topic", targetUrl: "/blogs/news/mapped" },
      sourceData: {
        mapTitle: "Active Map Article Title", targetKeyword: "mapped topic", targetUrl: "/blogs/news/mapped", currentArticleTitle: null,
        mapDecision: "create", originalPriority: "high", secondaryVariants: "variant one; variant two", contentKind: "article",
        publishingState: "published", exactTargetIfAny: "/blogs/news/mapped", resolutionStatus: "resolved",
        observation: { capturedAt, provenance: "ArticleRecord:absence:/blogs/news/mapped" },
      },
    });
    expect(mockCreateGovernedContentProposal.mock.calls[1]![1].data).toMatchObject({
      title: "Refresh content: Active Black Rice Map Title",
      proposedState: { articleTitle: "Active Black Rice Map Title", targetUrl: "/blogs/news/black-rice-benefits" },
      sourceData: { mapTitle: "Active Black Rice Map Title", targetKeyword: "black rice benefits", targetUrl: "/blogs/news/black-rice-benefits", currentArticleTitle: "Black Rice Benefits", mapDecision: "update", mapEvidence: "Refresh using current search performance.", originalPriority: "high", resolutionStatus: "resolved", observation: { capturedAt, provenance: "ArticleRecord:news/black-rice-benefits" } },
    });

    const staleAnalysis = await POST(jsonRequest("/api/seo/gaps/promote-selected", { ...strategyIdentity, analysisGeneratedAt: "2026-01-01T00:00:00.000Z", candidateIds: [createGap.candidateId] }));
    expect(staleAnalysis.status).toBe(409);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("promotes an unchanged refresh when routine indexing only changed updatedAt", async () => {
    const capturedAt = new Date().toISOString();
    const stateHash = "b".repeat(64);
    const gap = makeGap({
      ...strategyIdentity,
      kind: "content",
      state: "candidate",
      action: "refresh",
      ruleIds: ["rule:black"],
      query: "black rice benefits",
      suggestedTitle: "Black Rice Benefits",
      page: "/blogs/news/black-rice-benefits",
      priority: "high",
      mapEvidence: "Refresh using current search performance.",
      observedEvidence: [],
      observation: {
        source: "store",
        capturedAt,
        provenance: "ArticleRecord:news/black-rice-benefits",
        stateHash,
      },
    });
    mockGetLatestSnapshot.mockResolvedValue({
      payload: {
        schemaVersion: "2",
        strategy: { versionId: "v3", packageSha256: strategyIdentity.packageSha256 },
        generatedAt: capturedAt,
        analysis: { gaps: [gap], observations: [], suppressed: [] },
        evidence: {
          gscCapturedAt: capturedAt,
          storeCapturedAt: capturedAt,
          linkCapturedAt: null,
          requiredObservationFamilies: ["store"],
          storeInspection: { required: 1, inspected: 1 },
          linkInspection: { required: 0, inspected: 0 },
          maxAgeHours: 72,
        },
      },
      fetchedAt: new Date(capturedAt),
    });
    mockPrisma.articleRecord.findFirst.mockResolvedValue({
      handle: "black-rice-benefits",
      title: "Black Rice Benefits",
      wordCount: 400,
      contentHash: stateHash,
      updatedAt: new Date(Date.now() + 60_000),
    });
    mockCreateGovernedContentProposal.mockResolvedValue({
      created: true,
      proposal: { id: "refresh-created" },
      compliance: { result: "compliant" },
    });
    const { POST } = await import("@/app/api/seo/gaps/promote-selected/route");

    const response = await POST(jsonRequest("/api/seo/gaps/promote-selected", {
      ...strategyIdentity,
      analysisGeneratedAt: capturedAt,
      candidateIds: [gap.candidateId],
    }));

    expect(await response.json()).toMatchObject({
      results: [{ candidateId: gap.candidateId, status: "created", proposalId: "refresh-created" }],
    });
    expect(mockCreateGovernedContentProposal.mock.calls[0]![1].data.sourceData.observation).toEqual({
      capturedAt,
      provenance: "ArticleRecord:news/black-rice-benefits",
      stateHash,
    });

    mockPrisma.articleRecord.findFirst.mockResolvedValue({
      handle: "black-rice-benefits",
      title: "Black Rice Benefits",
      wordCount: 400,
      contentHash: "c".repeat(64),
      updatedAt: new Date(capturedAt),
    });
    const changedResponse = await POST(jsonRequest("/api/seo/gaps/promote-selected", {
      ...strategyIdentity,
      analysisGeneratedAt: capturedAt,
      candidateIds: [gap.candidateId],
    }));

    expect(await changedResponse.json()).toMatchObject({
      results: [{ candidateId: gap.candidateId, status: "stale_or_blocked" }],
    });
    expect(mockCreateGovernedContentProposal).toHaveBeenCalledTimes(1);
  });

  it("revalidates rule status and rejects a persisted manual-gate candidate", async () => {
    const capturedAt = new Date().toISOString();
    const input = { ...strategyIdentity, kind: "content" as const, state: "candidate" as const, action: "create" as const, ruleIds: ["rule:mapped"], query: "mapped topic", suggestedTitle: "Mapped topic guide", page: "/blogs/news/mapped", priority: "high", mapEvidence: null, observedEvidence: [], observation: { source: "store" as const, capturedAt, provenance: "ArticleRecord:absence:/blogs/news/mapped" } };
    const gap = { ...input, candidateId: mapCandidateId(input) };
    const activation = await mockPrisma.topicalMapActivation.findUnique();
    activation.strategyVersion.compiledRules[0].compiledPayload.resolutionStatus = "manual_gate";
    mockPrisma.topicalMapActivation.findUnique.mockResolvedValue(activation);
    mockGetLatestSnapshot.mockResolvedValue({ payload: { schemaVersion: "2", strategy: { versionId: "v3", packageSha256: strategyIdentity.packageSha256 }, generatedAt: capturedAt, analysis: { gaps: [gap], observations: [], suppressed: [] }, evidence: { gscCapturedAt: capturedAt, storeCapturedAt: capturedAt, linkCapturedAt: null, requiredObservationFamilies: ["store"], storeInspection: { required: 1, inspected: 1 }, linkInspection: { required: 0, inspected: 0 }, maxAgeHours: 72 } }, fetchedAt: new Date(capturedAt) });
    mockPrisma.articleRecord.findFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/seo/gaps/promote-selected/route");

    const response = await POST(jsonRequest("/api/seo/gaps/promote-selected", { ...strategyIdentity, analysisGeneratedAt: capturedAt, candidateIds: [gap.candidateId] }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ results: [{ candidateId: gap.candidateId, status: "stale_or_blocked" }] });
    expect(mockCreateGovernedContentProposal).not.toHaveBeenCalled();
  });

  it("does not queue mapped content with legacy completed history", async () => {
    const capturedAt = new Date().toISOString();
    const input = { ...strategyIdentity, kind: "content" as const, state: "candidate" as const, action: "refresh" as const, ruleIds: ["rule:black"], query: "black rice benefits", suggestedTitle: "Black Rice Benefits", page: "/blogs/news/black-rice-benefits", priority: "high", mapEvidence: null, observedEvidence: [], observation: { source: "store" as const, capturedAt, provenance: "ArticleRecord:news/black-rice-benefits" } };
    const gap = { ...input, candidateId: mapCandidateId(input) };
    mockGetLatestSnapshot.mockResolvedValue({ payload: { schemaVersion: "2", strategy: { versionId: "v3", packageSha256: strategyIdentity.packageSha256 }, generatedAt: capturedAt, analysis: { gaps: [gap], observations: [], suppressed: [] }, evidence: { gscCapturedAt: capturedAt, storeCapturedAt: capturedAt, linkCapturedAt: null, requiredObservationFamilies: ["store"], storeInspection: { required: 1, inspected: 1 }, linkInspection: { required: 0, inspected: 0 }, maxAgeHours: 72 } }, fetchedAt: new Date(capturedAt) });
    mockPrisma.articleRecord.findFirst.mockResolvedValue({ handle: "black-rice-benefits", title: "Black Rice Benefits", wordCount: 400, updatedAt: new Date(capturedAt) });
    mockGetBlockingMapContentProposals.mockResolvedValue(new Map([[gap.candidateId, "published-1"]]));
    const { POST } = await import("@/app/api/seo/gaps/promote-selected/route");

    const response = await POST(jsonRequest("/api/seo/gaps/promote-selected", { ...strategyIdentity, analysisGeneratedAt: capturedAt, candidateIds: [gap.candidateId] }));

    expect(await response.json()).toMatchObject({
      results: [{ candidateId: gap.candidateId, status: "already_existing", proposalId: "published-1" }],
    });
    expect(mockCreateGovernedContentProposal).not.toHaveBeenCalled();
  });

  it.each([
    ["P0", "P1"],
    ["P1", "P1"],
    ["P2", "P2"],
    ["P3", "P3"],
  ])("persists map priority %s in operational band %s", async (mapPriority, proposalPriority) => {
    const capturedAt = new Date().toISOString();
    const input = { ...strategyIdentity, kind: "content" as const, state: "candidate" as const, action: "create" as const, ruleIds: ["rule:mapped"], query: "mapped topic", suggestedTitle: "Mapped topic guide", page: "/blogs/news/mapped", priority: mapPriority === "P0" ? "P3" : mapPriority, mapEvidence: null, observedEvidence: [], observation: { source: "store" as const, capturedAt, provenance: "ArticleRecord:absence:/blogs/news/mapped" } };
    const gap = { ...input, candidateId: mapCandidateId(input) };
    const activation = await mockPrisma.topicalMapActivation.findUnique();
    activation.strategyVersion.compiledRules[0].compiledPayload.payload.priority = mapPriority;
    mockPrisma.topicalMapActivation.findUnique.mockResolvedValue(activation);
    mockGetLatestSnapshot.mockResolvedValue({ payload: { schemaVersion: "2", strategy: { versionId: "v3", packageSha256: strategyIdentity.packageSha256 }, generatedAt: capturedAt, analysis: { gaps: [gap], observations: [], suppressed: [] }, evidence: { gscCapturedAt: capturedAt, storeCapturedAt: capturedAt, linkCapturedAt: null, requiredObservationFamilies: ["store"], storeInspection: { required: 1, inspected: 1 }, linkInspection: { required: 0, inspected: 0 }, maxAgeHours: 72 } }, fetchedAt: new Date(capturedAt) });
    mockPrisma.articleRecord.findFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/seo/gaps/promote-selected/route");

    const response = await POST(jsonRequest("/api/seo/gaps/promote-selected", { ...strategyIdentity, analysisGeneratedAt: capturedAt, candidateIds: [gap.candidateId] }));

    expect(response.status).toBe(200);
    expect(mockCreateGovernedContentProposal.mock.calls[0]![1].data).toMatchObject({
      priority: proposalPriority,
      sourceData: { originalPriority: mapPriority },
    });
  });

  it("persists exact internal-link review context from the active map", async () => {
    const capturedAt = new Date().toISOString();
    const stateHash = "c".repeat(64);
    const input = { ...strategyIdentity, kind: "link" as const, state: "candidate" as const, action: "update" as const, ruleIds: ["rule:link"], query: "mapped topic", suggestedTitle: "Add exact link", page: "/blogs/news/source", fromUrl: "/blogs/news/source", toUrl: "/blogs/news/mapped", priority: "P3", mapEvidence: null, observedEvidence: [], observation: { source: "link_inspection" as const, capturedAt, provenance: "ArticleRecord.linksData:/blogs/news/source", stateHash } };
    const gap = { ...input, candidateId: mapCandidateId(input) };
    mockGetLatestSnapshot.mockResolvedValue({ payload: { schemaVersion: "2", strategy: { versionId: "v3", packageSha256: strategyIdentity.packageSha256 }, generatedAt: capturedAt, analysis: { gaps: [gap], observations: [], suppressed: [] }, evidence: { gscCapturedAt: capturedAt, storeCapturedAt: null, linkCapturedAt: capturedAt, requiredObservationFamilies: ["link_inspection"], storeInspection: { required: 0, inspected: 0 }, linkInspection: { required: 1, inspected: 1 }, maxAgeHours: 72 } }, fetchedAt: new Date(capturedAt) });
    mockPrisma.articleRecord.findFirst.mockResolvedValue({ contentHash: stateHash, updatedAt: new Date(capturedAt), linksData: { internal: [] } });
    mockPrisma.contentProposal.findMany.mockResolvedValue([{
      id: "published-link",
      status: "approved",
      draftStatus: "published",
      proposedState: { fromUrl: "/blogs/news/source", toUrl: "/blogs/news/mapped" },
    }]);
    mockCreateGovernedContentProposal.mockResolvedValue({ created: true, proposal: { id: "link-proposal" }, compliance: { result: "compliant" } });
    const { POST } = await import("@/app/api/seo/gaps/promote-selected/route");

    const response = await POST(jsonRequest("/api/seo/gaps/promote-selected", { ...strategyIdentity, analysisGeneratedAt: capturedAt, candidateIds: [gap.candidateId] }));

    expect(response.status).toBe(200);
    expect(mockCreateGovernedContentProposal.mock.calls[0]![1].data).toMatchObject({
      priority: "P1",
      proposedState: { fromUrl: "/blogs/news/source", toUrl: "/blogs/news/mapped", suggestedAnchorText: "mapped topic", observationStateHash: stateHash },
      sourceData: { fromUrl: "/blogs/news/source", toUrl: "/blogs/news/mapped", recommendedAnchor: "mapped topic", currentBodyState: "absent", linkPurpose: "supporting context", requiredAction: "add", verification: "Exact href is present", originalPriority: "high", resolutionStatus: "resolved", observation: { capturedAt, provenance: "ArticleRecord.linksData:/blogs/news/source", stateHash }, ruleIds: ["rule:link"], strategyVersionId: "v3" },
    });
  });

  it("keeps legacy non-published internal-link history blocking a duplicate repair", async () => {
    const capturedAt = new Date().toISOString();
    const stateHash = "d".repeat(64);
    const input = { ...strategyIdentity, kind: "link" as const, state: "candidate" as const, action: "update" as const, ruleIds: ["rule:link"], query: "mapped topic", suggestedTitle: "Add exact link", page: "/blogs/news/source", fromUrl: "/blogs/news/source", toUrl: "/blogs/news/mapped", priority: "P3", mapEvidence: null, observedEvidence: [], observation: { source: "link_inspection" as const, capturedAt, provenance: "ArticleRecord.linksData:/blogs/news/source", stateHash } };
    const gap = { ...input, candidateId: mapCandidateId(input) };
    mockGetLatestSnapshot.mockResolvedValue({ payload: { schemaVersion: "2", strategy: { versionId: "v3", packageSha256: strategyIdentity.packageSha256 }, generatedAt: capturedAt, analysis: { gaps: [gap], observations: [], suppressed: [] }, evidence: { gscCapturedAt: capturedAt, storeCapturedAt: null, linkCapturedAt: capturedAt, requiredObservationFamilies: ["link_inspection"], storeInspection: { required: 0, inspected: 0 }, linkInspection: { required: 1, inspected: 1 }, maxAgeHours: 72 } }, fetchedAt: new Date(capturedAt) });
    mockPrisma.articleRecord.findFirst.mockResolvedValue({ contentHash: stateHash, updatedAt: new Date(capturedAt), linksData: { internal: [] } });
    mockPrisma.contentProposal.findMany.mockResolvedValue([{
      id: "legacy-active-link",
      draftStatus: "ready",
      proposedState: {},
      sourceData: {
        strategyCandidate: {
          fromUrl: "/blogs/news/source",
          toUrl: "/blogs/news/mapped",
        },
      },
    }]);
    const { POST } = await import("@/app/api/seo/gaps/promote-selected/route");

    const response = await POST(jsonRequest("/api/seo/gaps/promote-selected", { ...strategyIdentity, analysisGeneratedAt: capturedAt, candidateIds: [gap.candidateId] }));

    expect(await response.json()).toMatchObject({
      results: [{ candidateId: gap.candidateId, status: "already_existing", proposalId: "legacy-active-link" }],
    });
    expect(mockCreateGovernedContentProposal).not.toHaveBeenCalled();
  });

  it("bounds selected candidate requests at 100 IDs before database work", async () => {
    const { POST } = await import("@/app/api/seo/gaps/promote-selected/route");
    const response = await POST(jsonRequest("/api/seo/gaps/promote-selected", { ...strategyIdentity, analysisGeneratedAt: new Date().toISOString(), candidateIds: Array.from({ length: 101 }, (_, index) => index.toString(16).padStart(64, "0")) }));
    expect(response.status).toBe(400);
    expect(mockGetLatestSnapshot).not.toHaveBeenCalled();
  });

  it("processes the current 92-candidate selection without truncation and retries idempotently", async () => {
    const capturedAt = new Date().toISOString();
    const gaps = Array.from({ length: 92 }, (_, index) => {
      const input = { ...strategyIdentity, kind: "content" as const, state: "candidate" as const, action: "create" as const, ruleIds: [`rule:batch:${index}`], query: `mapped topic ${index}`, suggestedTitle: `Mapped topic guide ${index}`, page: `/blogs/news/mapped-${index}`, priority: "high", mapEvidence: null, observedEvidence: [], observation: { source: "store" as const, capturedAt, provenance: `ArticleRecord:absence:/blogs/news/mapped-${index}` } };
      return { ...input, candidateId: mapCandidateId(input) };
    });
    const active = await mockPrisma.topicalMapActivation.findUnique();
    mockPrisma.topicalMapActivation.findUnique.mockResolvedValue({ strategyVersion: { ...active.strategyVersion, compiledRules: gaps.map((gap) => ({ ruleId: gap.ruleIds[0], ruleType: "content_decisions", sourceArtifactId: "map", compiledPayload: { payload: { currentUrl: gap.page, decision: "create", priority: "high" }, sourceReferences: [], resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } })) } });
    mockGetLatestSnapshot.mockResolvedValue({ payload: { schemaVersion: "2", strategy: { versionId: "v3", packageSha256: strategyIdentity.packageSha256 }, generatedAt: capturedAt, analysis: { gaps, observations: [], suppressed: [] }, evidence: { gscCapturedAt: capturedAt, storeCapturedAt: capturedAt, linkCapturedAt: null, requiredObservationFamilies: ["store"], storeInspection: { required: 92, inspected: 92 }, linkInspection: { required: 0, inspected: 0 }, maxAgeHours: 72 } }, fetchedAt: new Date(capturedAt) });
    mockPrisma.articleRecord.findFirst.mockResolvedValue(null);
    mockCreateGovernedContentProposal.mockResolvedValue({ created: false, proposal: { id: "existing" }, compliance: { result: "compliant" } }).mockResolvedValueOnce({ created: true, proposal: { id: "created-first" }, compliance: { result: "compliant" } });
    const { POST } = await import("@/app/api/seo/gaps/promote-selected/route");

    const response = await POST(jsonRequest("/api/seo/gaps/promote-selected", { ...strategyIdentity, analysisGeneratedAt: capturedAt, candidateIds: gaps.map(gap => gap.candidateId) }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(92);
    expect(body.counts).toEqual({ created: 1, already_existing: 91, stale_or_blocked: 0, failed: 0 });

    const retry = await POST(jsonRequest("/api/seo/gaps/promote-selected", { ...strategyIdentity, analysisGeneratedAt: capturedAt, candidateIds: gaps.map(gap => gap.candidateId) }));
    expect((await retry.json()).counts).toEqual({ created: 0, already_existing: 92, stale_or_blocked: 0, failed: 0 });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(184);
  });

  it("does not report already-covered GSC queries as new content gaps", async () => {
    mockSyncTopicalMapStoreTasks.mockResolvedValue({
      executable: 3, advisory: 4, unchanged: 5, suppressed: 6,
      secret: "must-not-cross-route-boundary",
      sourceBytes: "raw topical-map source",
      detail: { providerToken: "hidden" },
    } as any);
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [
        { query: "black rice benefits", clicks: 3, impressions: 320, ctr: "0.9%", position: "8.0" },
        { query: "moringa tea recipe", clicks: 1, impressions: 180, ctr: "0.6%", position: "12.0" },
      ],
      pages: [],
      queryPagePairs: [
        {
          query: "black rice benefits",
          page: "https://agrikoph.com/blogs/news/black-rice-benefits",
          clicks: 3,
          impressions: 320,
          position: "8.0",
        },
      ],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "black-rice-benefits",
        title: "Black Rice Benefits",
        wordCount: 900,
        internalLinkCount: 2,
        seoData: { seoTitle: "Black Rice Benefits", seoDescription: "A complete guide." },
      },
    ]);
    const { POST } = await import("@/app/api/seo/analyze/route");

    const res = await POST(new Request("http://test.local/api/seo/analyze", { method: "POST" }) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.analysis.limits).toEqual({
      queriesTotal: 2,
      queriesAnalyzed: 2,
      articlesTotalLowerBound: 1,
      articlesAnalyzed: 1,
      articlesTruncated: false,
    });
    expect(body.analysis.contentGaps).toEqual(expect.arrayContaining([expect.objectContaining({ page: "/blogs/news/mapped", ruleIds: ["rule:mapped"] })]));
    expect(body.analysis.suppressedGaps).toContainEqual(expect.objectContaining({ page: "/blogs/news/source", reason: expect.stringContaining("observation_unavailable"), ruleIds: ["rule:link"] }));
    expect(body.analysis.observations).toEqual([expect.objectContaining({ query: "moringa tea recipe" })]);
    expect(body.analysis.contentGaps).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ query: "black rice benefits" })])
    );
    expect(mockPrisma.rawSnapshot.upsert).toHaveBeenCalledBefore(mockSyncTopicalMapStoreTasks);
    expect(mockSyncTopicalMapStoreTasks).toHaveBeenCalledWith(mockPrisma);
    expect(body.storeTaskSync).toEqual({ status: "complete", executable: 3, advisory: 4, unchanged: 5, suppressed: 6 });
  });

  it("keeps SEO analysis source isolated from Shopify mutation boundaries", () => {
    const source = readFileSync("app/api/seo/analyze/route.ts", "utf8");
    expect(source).not.toMatch(/\b(?:applyGovernedStoreResourceChange|applyTopicalMapStoreTask|shopifyFetch)\b/);
    expect(source).not.toMatch(/from\s+["'][^"']*(?:apply-topical-map|shopify-admin)[^"']*["']/);
  });

  it("keeps a persisted analysis available when topical-map Store Task synchronization fails", async () => {
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [{ query: "black rice benefits", clicks: 3, impressions: 320, ctr: "0.9%", position: "8.0" }],
      pages: [], queryPagePairs: [], fetchedAt: new Date("2026-06-01T00:00:00Z"), source: "normalized", window: null,
    });
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      { handle: "black-rice-benefits", title: "Black Rice Benefits", wordCount: 900, internalLinkCount: 2, seoData: { seoTitle: "Black Rice Benefits", seoDescription: "A complete guide." } },
    ]);
    mockSyncTopicalMapStoreTasks.mockRejectedValue(new Error("provider credentials leaked here"));
    const { POST } = await import("@/app/api/seo/analyze/route");

    const res = await POST(new Request("http://test.local/api/seo/analyze", { method: "POST" }) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockPrisma.rawSnapshot.upsert).toHaveBeenCalledOnce();
    expect(body.analysis).toEqual(expect.objectContaining({ contentGaps: expect.any(Array) }));
    expect(body.storeTaskSync).toEqual({ status: "partial", executable: 0, advisory: 0, unchanged: 0, suppressed: 0 });
    expect(JSON.stringify(body)).not.toContain("credentials leaked");
  });

  it("filters AI strategy bullets to grounded items and returns evidence for each visible item", async () => {
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [
        { query: "black rice benefits", clicks: 3, impressions: 320, ctr: "0.9%", position: "8.0" },
      ],
      pages: [],
      queryPagePairs: [],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "black-rice-benefits",
        title: "Black Rice Benefits",
        wordCount: 220,
        internalLinkCount: 0,
        seoData: { seoTitle: "", seoDescription: "" },
      },
    ]);
    mockChatCompletion.mockResolvedValue({ content: JSON.stringify({
                    summary: "Black Rice Benefits needs basic SEO cleanup.",
                    quickWins: [
                      "Expand Black Rice Benefits and fix its missing meta description.",
                      "Launch a celebrity recipe hub for keto smoothies.",
                    ],
                    recommendations: [
                      "Target the black rice benefits query with a better SERP snippet.",
                      "Build an unrelated backlink campaign for luxury watches.",
                    ],
                  }), provider: "deepseek", model: "test-model" });
    const { POST } = await import("@/app/api/seo/analyze/route");

    const res = await POST(new Request("http://test.local/api/seo/analyze", { method: "POST" }) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.analysis.quickWins).toEqual([
      "Expand Black Rice Benefits and fix its missing meta description.",
    ]);
    expect(body.analysis.quickWinEvidence).toEqual([
      expect.stringContaining("Black Rice Benefits"),
    ]);
    expect(body.analysis.recommendations).toEqual([
      "Target the black rice benefits query with a better SERP snippet.",
    ]);
    expect(body.analysis.recommendationEvidence).toEqual([
      expect.stringContaining("black rice benefits"),
    ]);
    expect(JSON.stringify(body.analysis)).not.toContain("celebrity recipe hub");
    expect(JSON.stringify(body.analysis)).not.toContain("luxury watches");
  });

  it("preserves deterministic meta, thin-content, and internal-link findings when AI fails", async () => {
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [{ query: "black rice benefits", clicks: 3, impressions: 320, ctr: "0.9%", position: "8.0" }],
      pages: [],
      queryPagePairs: [],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      { handle: "black-rice", title: "Black Rice", wordCount: 220, internalLinkCount: 0, seoData: { seoTitle: "", seoDescription: "" } },
    ]);
    mockChatCompletion.mockRejectedValue(new Error("network unavailable"));
    const { POST } = await import("@/app/api/seo/analyze/route");

    const res = await POST(new Request("http://test.local/api/seo/analyze", { method: "POST" }) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.analysis.aiStatus).toBe("partial");
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(body.analysis.quickWins).toEqual(expect.arrayContaining([
      expect.stringMatching(/missing meta/i),
      expect.stringMatching(/thin content/i),
      expect.stringMatching(/internal link/i),
    ]));
    expect(body.analysis.quickWinEvidence).toHaveLength(body.analysis.quickWins.length);
    expect(mockPrisma.rawSnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ payload: expect.objectContaining({ schemaVersion: "2", strategy: { versionId: "v3", packageSha256: "a".repeat(64) }, analysis: expect.objectContaining({ gaps: expect.any(Array), observations: expect.any(Array), suppressed: expect.any(Array) }), presentation: expect.objectContaining({ aiStatus: "partial" }) }), fetchedAt: new Date(body.generatedAt) }),
      create: expect.objectContaining({ fetchedAt: new Date(body.generatedAt) }),
    }));
  });

  it("retains landing-page attribution when the matching pair is beyond the display limit", async () => {
    const filler = Array.from({ length: 50 }, (_, index) => ({
      query: `filler ${index}`,
      page: `https://agrikoph.com/blogs/news/filler-${index}`,
      clicks: 0,
      impressions: 1000 - index,
      position: "8.0",
    }));
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [{ query: "target query", clicks: 0, impressions: 200, ctr: "0%", position: "8.0" }],
      pages: [],
      queryPagePairs: [...filler, {
        query: "target query",
        page: "https://agrikoph.com/blogs/news/target-article",
        clicks: 0,
        impressions: 200,
        position: "8.0",
      }],
      fetchedAt: new Date("2026-06-01T00:00:00Z"),
      source: "normalized",
      window: null,
    });
    const { GET } = await import("@/app/api/seo/route");

    const res = await GET(new Request("http://test.local/api/seo") as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.trends.previousFetchedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(body.opportunities.find((row: { query: string }) => row.query === "target query"))
      .toEqual(expect.objectContaining({
        page: "https://agrikoph.com/blogs/news/target-article",
      }));
    expect(body.limits).toEqual({
      queryPagePairsTotal: 51,
      queryPagePairsReturned: 50,
      queryPagePairsTruncated: true,
    });
  });

  it("returns complete GSC freshness in summary and full SEO responses", async () => {
    const freshness = {
      selectedSource: "rawSnapshot",
      selectedCapturedAt: new Date("2026-07-10T03:00:00.000Z"),
      selectedDateRangeStart: new Date("2026-06-10T00:00:00.000Z"),
      selectedDateRangeEnd: new Date("2026-07-08T00:00:00.000Z"),
      normalizedCapturedAt: new Date("2026-07-08T03:00:00.000Z"),
      normalizedDateRangeStart: new Date("2026-06-08T00:00:00.000Z"),
      normalizedDateRangeEnd: new Date("2026-07-06T00:00:00.000Z"),
      rawCapturedAt: new Date("2026-07-10T03:00:00.000Z"),
      rawDateRangeStart: new Date("2026-06-10T00:00:00.000Z"),
      rawDateRangeEnd: new Date("2026-07-08T00:00:00.000Z"),
      fallbackReason: "raw_newer_than_normalized",
    };
    mockSeoData.getLatestGscData.mockResolvedValue({
      queries: [],
      pages: [],
      queryPagePairs: [],
      fetchedAt: freshness.selectedCapturedAt,
      source: "rawSnapshot",
      window: null,
      freshness,
    });
    mockSeoData.getLatestGa4Data.mockResolvedValue({
      pages: [],
      fetchedAt: null,
      source: "none",
      freshness: {
        selectedSource: "none",
        selectedCapturedAt: null,
        normalizedCapturedAt: null,
        rawCapturedAt: null,
        fallbackReason: null,
      },
    });
    const { GET } = await import("@/app/api/seo/route");

    const summary = await GET(new Request("http://test.local/api/seo?view=summary&refresh=1") as NextRequest);
    const full = await GET(new Request("http://test.local/api/seo") as NextRequest);

    expect((await summary.json()).gscFreshness).toEqual(JSON.parse(JSON.stringify(freshness)));
    expect((await full.json()).gscFreshness).toEqual(JSON.parse(JSON.stringify(freshness)));
  });

  it("keeps raw search opportunities observational after the governed-map cutover", () => {
    const pageSource = readFileSync("app/(embedded)/(seo-pillar)/seo-pillar/page.tsx", "utf8");

    expect(pageSource).toContain("const visibleOpportunities = data?.opportunities ?? []");
    expect(pageSource).toContain("No map rule association");
    expect(pageSource).not.toContain("promoteOpportunity");
    expect(pageSource).not.toContain("opportunityKey(o)");
  });

  it("retires the unguided SEO brief and points operators to mapped Content Pilot briefs", async () => {
    const { POST } = await import("@/app/api/seo/brief/route");

    const res = await POST(new Request("http://test.local/api/seo/brief", { method: "POST" }) as NextRequest);

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      error: "Unguided SEO briefs have been retired.",
      replacement: "/content-pilot?tab=brief",
    });
    expect(mockSeoData.getLatestGscData).not.toHaveBeenCalled();
    expect(mockSeoData.getLatestGa4Data).not.toHaveBeenCalled();
    expect(mockGroundSeoBriefContext).not.toHaveBeenCalled();
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it("blocks a user without CONTENT_REVIEW before SEO keyword persistence", async () => {
    mockAuth.requirePermission.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const { POST } = await import("@/app/api/seo/keywords/route");

    const res = await POST(jsonRequest("/api/seo/keywords", { keyword: "black rice" }));

    expect(res.status).toBe(403);
    expect(mockPrisma.marketKeyword.create).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("blocks a user without CONTENT_REVIEW before SEO keyword deletion", async () => {
    mockAuth.requirePermission.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const { DELETE } = await import("@/app/api/seo/keywords/route");

    const res = await DELETE(jsonRequest("/api/seo/keywords", { keyword: "black rice" }, "DELETE"));

    expect(res.status).toBe(403);
    expect(mockPrisma.marketKeyword.updateMany).not.toHaveBeenCalled();
  });

  it("blocks a user without CONTENT_REVIEW before queueing an SEO refresh", async () => {
    mockAuth.requirePermission.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const { POST } = await import("@/app/api/seo/refresh/route");

    const res = await POST(new Request("http://test.local/api/seo/refresh", { method: "POST" }) as NextRequest);

    expect(res.status).toBe(403);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("blocks a user without CONTENT_REVIEW before SEO brief data or AI work", async () => {
    mockAuth.requirePermission.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const { POST } = await import("@/app/api/seo/brief/route");

    const res = await POST(new Request("http://test.local/api/seo/brief", { method: "POST" }) as NextRequest);

    expect(res.status).toBe(403);
    expect(mockSeoData.getLatestGscData).not.toHaveBeenCalled();
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });


  it("bulk-decomposes stale missing-meta records using analyze-compatible meta signals", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "stale-meta-fields",
        title: "Stale Meta Fields",
        wordCount: 700,
        seoData: {
          metaTitle: "Legacy title",
          metaDescription: "Legacy description",
          seoTitle: "",
          seoDescription: "",
        },
      },
      {
        handle: "missing-meta-code",
        title: "Missing Meta Code",
        wordCount: 650,
        seoData: {
          metaTitle: "Legacy title",
          metaDescription: "Legacy description",
          issues: ["missing_meta"],
        },
      },
      {
        handle: "complete-meta",
        title: "Complete Meta",
        wordCount: 800,
        seoData: {
          metaTitle: "Complete meta title",
          metaDescription: "Complete meta description",
          seoTitle: "Complete meta title",
          seoDescription: "Complete meta description",
        },
      },
    ]);
    mockPrisma.contentProposal.create.mockImplementation(async ({ data }) => ({
      id: `proposal-${String(data.articleHandle)}`,
      title: data.title,
      proposalType: data.proposalType,
    }));
    const { POST } = await import("@/app/api/seo/recommendations/decompose/route");

    const res = await POST(jsonRequest("/api/seo/recommendations/decompose", {
      recommendation: "Create systematic meta titles and descriptions for all articles",
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ created: 2, skipped: 0, dropped: 0 }));
    expect(mockPrisma.articleRecord.findMany).toHaveBeenCalledWith(expect.not.objectContaining({ take: expect.anything() }));
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposalType: "seo-fix",
        articleHandle: "stale-meta-fields",
        title: "Fix meta: Stale Meta Fields",
      }),
    });
    expect(mockPrisma.contentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposalType: "seo-fix",
        articleHandle: "missing-meta-code",
        title: "Fix meta: Missing Meta Code",
      }),
    });
  });

  it("does not recreate rejected decomposed recommendations for the same article action under a new title", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        handle: "black-rice-benefits",
        title: "Black Rice Benefits",
        wordCount: 700,
        seoData: { seoTitle: "", seoDescription: "" },
      },
    ]);
    mockChatCompletion.mockResolvedValue({ content: JSON.stringify([
                    {
                      type: "seo-fix",
                      title: "Improve the Black Rice Benefits SERP snippet",
                      articleHandle: "black-rice-benefits",
                      targetQuery: "black rice benefits",
                    },
                  ]), provider: "deepseek", model: "test-model" });
    mockPrisma.contentProposal.findMany.mockResolvedValue([
      {
        articleHandle: "black-rice-benefits",
        proposalType: "seo-fix",
        title: "Rejected previous meta task",
        proposedState: { targetQuery: "black rice benefits" },
      },
    ]);
    const { POST } = await import("@/app/api/seo/recommendations/decompose/route");

    const res = await POST(jsonRequest("/api/seo/recommendations/decompose", {
      recommendation: "Improve the Black Rice Benefits SERP metadata",
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ created: 0, skipped: 1 }));
    expect(mockPrisma.contentProposal.create).not.toHaveBeenCalled();
  });

  it("normalizes tracked keywords before persistence", async () => {
    const { POST } = await import("@/app/api/seo/keywords/route");

    const res = await POST(jsonRequest("/api/seo/keywords", { keyword: "  Black   Rice Benefits  " }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.keyword).toBe("black rice benefits");
    expect(mockPrisma.marketKeyword.create).toHaveBeenCalledWith({ data: { keyword: "black rice benefits", category: "seo", languageCode: "en", active: true } });
  });

  it("deactivates matching tracked keywords on DELETE", async () => {
    const { DELETE } = await import("@/app/api/seo/keywords/route");

    const res = await DELETE(jsonRequest("/api/seo/keywords", { keyword: "  Black   Rice Benefits  " }, "DELETE"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, keyword: "black rice benefits" });
    expect(mockPrisma.marketKeyword.updateMany).toHaveBeenCalledWith({
      where: {
        keyword: { equals: "black rice benefits", mode: "insensitive" },
        category: "seo",
        languageCode: "en",
        locationName: null,
        active: true,
      },
      data: { active: false },
    });
  });

  it("returns 404 when no active SEO keyword exists to untrack", async () => {
    mockPrisma.marketKeyword.updateMany.mockResolvedValue({ count: 0 });
    const { DELETE } = await import("@/app/api/seo/keywords/route");

    const res = await DELETE(jsonRequest("/api/seo/keywords", { keyword: "missing keyword" }, "DELETE"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Keyword not currently tracked" });
  });

  it("recovers concurrent tracked-keyword inserts", async () => {
    const { POST } = await import("@/app/api/seo/keywords/route");
    mockPrisma.marketKeyword.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    mockPrisma.marketKeyword.findFirst.mockResolvedValue({ id: "winner" });
    const res = await POST(jsonRequest("/api/seo/keywords", { keyword: " Black   Rice Benefits " }));
    expect(await res.json()).toEqual({ ok: true, keyword: "black rice benefits" });
    expect(mockPrisma.marketKeyword.update).toHaveBeenCalledWith({ where: { id: "winner" }, data: { active: true, category: "seo" } });
  });

  it("queues SEO refresh work instead of running fetch handlers inline", async () => {
    const { POST } = await import("@/app/api/seo/refresh/route");

    const res = await POST(new Request("http://test.local/api/seo/refresh", { method: "POST" }) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      queued: true,
      alreadyQueued: false,
      runId: "dashboard-run",
      status: "queued",
      jobName: "dashboard-refresh",
    }));
    expect(mockCheckRateLimit).toHaveBeenCalledWith("seo-refresh:api-key", 3, 60_000);
    expect(mockEnqueueJob).toHaveBeenCalledWith({ jobName: "dashboard-refresh", triggeredBy: "api-key" });
    expect(mockJobs.fetchSeoDataHandler).not.toHaveBeenCalled();
    expect(mockJobs.fetchGscDataHandler).not.toHaveBeenCalled();
    expect(mockJobs.snapshotSeoHistoryHandler).not.toHaveBeenCalled();
  });
});
