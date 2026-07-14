import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractSeoScore,
  maybeCreateArticleSnapshot,
  shouldCreateArticleSnapshot,
} from "@/lib/content-pilot/article-snapshots";

const now = new Date("2026-06-24T12:00:00.000Z");

function state(overrides: Record<string, unknown> = {}) {
  return {
    articleRecordId: "article-1",
    shopifyId: "shopify-1",
    handle: "organic-rice-guide",
    title: "Organic Rice Guide",
    contentHash: "hash-current",
    wordCount: 900,
    imageCount: 2,
    headingCount: 4,
    ctaCount: 1,
    internalLinkCount: 5,
    inboundCount: 3,
    seoData: { score: 82, issues: [] },
    linksData: { internal: [], external: [], cta: [] },
    topicsData: [{ topic: "rice", confidence: 0.8 }],
    ...overrides,
  };
}

const mockPrisma = {
  articleSnapshot: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.articleSnapshot.create.mockResolvedValue({ id: "snapshot-1" });
});

describe("shouldCreateArticleSnapshot", () => {
  it("creates a snapshot when content hash changed", () => {
    const latest = {
      contentHash: "hash-old",
      capturedAt: new Date("2026-06-24T10:00:00.000Z"),
    };

    expect(shouldCreateArticleSnapshot(latest, "hash-current", now)).toBe(true);
  });

  it("does not create a duplicate snapshot for unchanged recent content", () => {
    const latest = {
      contentHash: "hash-current",
      capturedAt: new Date("2026-06-23T12:00:00.000Z"),
    };

    expect(shouldCreateArticleSnapshot(latest, "hash-current", now)).toBe(false);
  });

  it("creates a periodic snapshot for unchanged stale content", () => {
    const latest = {
      contentHash: "hash-current",
      capturedAt: new Date("2026-06-16T12:00:00.000Z"),
    };

    expect(shouldCreateArticleSnapshot(latest, "hash-current", now)).toBe(true);
  });
});

describe("maybeCreateArticleSnapshot", () => {
  it("writes normalized snapshot data when creation is needed", async () => {
    mockPrisma.articleSnapshot.findFirst.mockResolvedValue(null);

    const created = await maybeCreateArticleSnapshot(mockPrisma as any, state(), now);

    expect(created).toBe(true);
    expect(mockPrisma.articleSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { articleRecordId: "article-1" } }));
    expect(mockPrisma.articleSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        handle: "organic-rice-guide",
        contentHash: "hash-current",
        wordCount: 900,
        inboundCount: 3,
        seoScore: 82,
        capturedAt: now,
      }),
    });
  });

  it("falls back to Shopify ID before handle for snapshot freshness identity", async () => {
    mockPrisma.articleSnapshot.findFirst.mockResolvedValue(null);
    await maybeCreateArticleSnapshot(mockPrisma as any, state({ articleRecordId: null, shopifyId: "gid://shopify/Article/recipes" }), now);
    expect(mockPrisma.articleSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { shopifyId: "gid://shopify/Article/recipes" } }));
  });

  it("skips unchanged recent content", async () => {
    mockPrisma.articleSnapshot.findFirst.mockResolvedValue({
      contentHash: "hash-current",
      capturedAt: new Date("2026-06-23T12:00:00.000Z"),
    });

    const created = await maybeCreateArticleSnapshot(mockPrisma as any, state(), now);

    expect(created).toBe(false);
    expect(mockPrisma.articleSnapshot.create).not.toHaveBeenCalled();
  });
});

describe("extractSeoScore", () => {
  it("returns null for missing or invalid score", () => {
    expect(extractSeoScore(null)).toBeNull();
    expect(extractSeoScore({ score: "not-a-number" })).toBeNull();
  });
});
