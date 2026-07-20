import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({
  inventory: vi.fn(),
  duplicate: vi.fn(),
  ready: vi.fn(),
  publish: vi.fn(),
}));
const assets = vi.hoisted(() => ({
  read: vi.fn(),
}));
const auditCreate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/shopify-theme-cache", () => ({
  fetchShopifyThemes: cache.inventory,
  duplicateShopifyTheme: cache.duplicate,
  waitForShopifyThemeReady: cache.ready,
  publishShopifyTheme: cache.publish,
}));
vi.mock("@/lib/shopify-theme-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shopify-theme-assets")>();
  return {
    ...actual,
    fetchThemeSourceAssets: assets.read,
  };
});
vi.mock("@/lib/db", () => ({
  prisma: { auditLog: { create: auditCreate } },
}));

import {
  applyApprovedThemeCacheFlushRecommendation,
  queueThemeCacheFlushRecommendation,
} from "@/lib/recommendations/theme-cache-flush";
import {
  ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY,
  MAIN_ARTICLE_ASSET_KEY,
  MAIN_HOME_ASSET_KEY,
  ROBOTS_TEMPLATE_ASSET_KEY,
  THEME_SOURCE_SYNC_ASSET_KEYS,
} from "@/lib/shopify-theme-assets";

const sourceThemeId = "gid://shopify/OnlineStoreTheme/123";
const duplicateThemeId = "gid://shopify/OnlineStoreTheme/456";
const sourceCommit = "8ff4626583861e70a542a2b51f67989429d52ea3";
const duplicateName = "autopilot-cache-flush-2026-07-20-02-30-00";
const sourceValues = {
  [MAIN_ARTICLE_ASSET_KEY]: "article-source",
  [MAIN_HOME_ASSET_KEY]: "home-source",
  [ROBOTS_TEMPLATE_ASSET_KEY]: "robots-source",
  [ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY]: "article-snippet-source",
};

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function identity(overrides: Record<string, unknown> = {}) {
  return {
    id: sourceThemeId,
    name: "Current main",
    role: "MAIN",
    processing: false,
    updatedAt: "2026-07-20T02:00:00Z",
    ...overrides,
  };
}

function observations(
  themeId: string,
  values: typeof sourceValues = sourceValues,
) {
  return THEME_SOURCE_SYNC_ASSET_KEYS.map((assetKey) => ({
    themeId,
    themeRole: "main" as const,
    assetKey,
    value: values[assetKey],
    sha256: sha256(values[assetKey]),
  }));
}

function payload() {
  return {
    sourceThemeId,
    sourceCommit,
    duplicateName,
    assets: THEME_SOURCE_SYNC_ASSET_KEYS.map((assetKey) => ({
      assetKey,
      sha256: sha256(sourceValues[assetKey]),
    })),
  };
}

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-cache-flush-1",
    status: "executing",
    platform: "shopify",
    actionType: "flush_shopify_theme_page_cache",
    targetEntityId:
      `${sourceThemeId}:cache-flush:${sourceCommit}:${duplicateName}`,
    proposedValue: JSON.stringify(payload()),
    ...overrides,
  } as any;
}

describe("governed Shopify theme cache flush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EXECUTE_APPROVED_LIVE_ENABLED", "true");
  });

  it("queues exact source hashes without mutating Shopify", async () => {
    cache.inventory.mockResolvedValue([identity()]);
    assets.read.mockResolvedValue(observations(sourceThemeId));
    const db: any = {
      rawSnapshot: { findFirst: vi.fn().mockResolvedValue({ id: "snapshot-1" }) },
      recommendation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "rec-cache-flush-1" }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    const result = await queueThemeCacheFlushRecommendation(db, {
      actor: "operator",
      sourceCommit,
      sourceValues,
      duplicateName,
    });

    expect(result).toEqual({
      recommendationId: "rec-cache-flush-1",
      created: true,
    });
    const created = db.recommendation.create.mock.calls[0][0].data;
    expect(JSON.parse(created.proposedValue)).toEqual(payload());
    expect(cache.duplicate).not.toHaveBeenCalled();
    expect(cache.publish).not.toHaveBeenCalled();
  });

  it("rejects source drift before duplication", async () => {
    cache.inventory.mockResolvedValue([identity()]);
    assets.read.mockResolvedValue(observations(sourceThemeId, {
      ...sourceValues,
      [MAIN_HOME_ASSET_KEY]: "unexpected-live-source",
    }));

    await expect(
      applyApprovedThemeCacheFlushRecommendation(recommendation()),
    ).rejects.toThrow(/changed after approval/i);
    expect(cache.duplicate).not.toHaveBeenCalled();
  });

  it("verifies duplicate hashes before publishing and verifies main afterward", async () => {
    const duplicate = identity({
      id: duplicateThemeId,
      name: duplicateName,
      role: "UNPUBLISHED",
      processing: true,
    });
    cache.inventory
      .mockResolvedValueOnce([identity()])
      .mockResolvedValueOnce([
        identity({ role: "UNPUBLISHED" }),
        { ...duplicate, role: "MAIN", processing: false },
      ]);
    assets.read
      .mockResolvedValueOnce(observations(sourceThemeId))
      .mockResolvedValueOnce(observations(duplicateThemeId))
      .mockResolvedValueOnce(observations(duplicateThemeId));
    cache.duplicate.mockResolvedValue(duplicate);
    cache.ready.mockResolvedValue({ ...duplicate, processing: false });
    cache.publish.mockResolvedValue({
      ...duplicate,
      role: "MAIN",
      processing: false,
    });

    const result = await applyApprovedThemeCacheFlushRecommendation(
      recommendation(),
    );

    expect(assets.read).toHaveBeenNthCalledWith(2, duplicateThemeId);
    expect(cache.publish).toHaveBeenCalledWith(duplicateThemeId);
    expect(assets.read).toHaveBeenNthCalledWith(3, duplicateThemeId);
    expect(result).toMatchObject({
      sourceThemeId,
      publishedThemeId: duplicateThemeId,
      duplicateName,
      alreadyApplied: false,
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "theme_cache_flush_duplicate_created",
        entityId: "rec-cache-flush-1",
      }),
    });
  });

  it("does not publish a duplicate with mismatched source hashes", async () => {
    const duplicate = identity({
      id: duplicateThemeId,
      name: duplicateName,
      role: "UNPUBLISHED",
      processing: false,
    });
    cache.inventory.mockResolvedValue([identity()]);
    assets.read
      .mockResolvedValueOnce(observations(sourceThemeId))
      .mockResolvedValueOnce(observations(duplicateThemeId, {
        ...sourceValues,
        [ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY]: "stale-snippet",
      }));
    cache.duplicate.mockResolvedValue(duplicate);
    cache.ready.mockResolvedValue(duplicate);

    await expect(
      applyApprovedThemeCacheFlushRecommendation(recommendation()),
    ).rejects.toThrow(/duplicate.*hash/i);
    expect(cache.publish).not.toHaveBeenCalled();
  });

  it("accepts an already-published verified duplicate idempotently", async () => {
    cache.inventory.mockResolvedValue([
      identity({ role: "UNPUBLISHED" }),
      identity({
        id: duplicateThemeId,
        name: duplicateName,
        role: "MAIN",
      }),
    ]);
    assets.read.mockResolvedValue(observations(duplicateThemeId));

    await expect(
      applyApprovedThemeCacheFlushRecommendation(recommendation()),
    ).resolves.toMatchObject({
      sourceThemeId,
      publishedThemeId: duplicateThemeId,
      alreadyApplied: true,
    });
    expect(cache.duplicate).not.toHaveBeenCalled();
    expect(cache.publish).not.toHaveBeenCalled();
  });
});
