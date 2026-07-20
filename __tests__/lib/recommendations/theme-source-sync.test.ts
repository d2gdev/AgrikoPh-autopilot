import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const theme = vi.hoisted(() => ({
  fetch: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/shopify-theme-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shopify-theme-assets")>();
  return {
    ...actual,
    fetchMainThemeSourceAssets: theme.fetch,
    updateMainThemeSourceAssets: theme.update,
  };
});

import {
  applyApprovedThemeSourceSyncRecommendation,
  queueThemeSourceSyncRecommendation,
} from "@/lib/recommendations/theme-source-sync";
import {
  MAIN_ARTICLE_ASSET_KEY,
  MAIN_HOME_ASSET_KEY,
  ROBOTS_TEMPLATE_ASSET_KEY,
  THEME_SOURCE_SYNC_ASSET_KEYS,
} from "@/lib/shopify-theme-assets";

const themeId = "gid://shopify/OnlineStoreTheme/123";
const sourceCommit = "8ff4626583861e70a542a2b51f67989429d52ea3";
const beforeValues = {
  [MAIN_ARTICLE_ASSET_KEY]: "article-before",
  [MAIN_HOME_ASSET_KEY]: "home-before",
  [ROBOTS_TEMPLATE_ASSET_KEY]: "robots-before",
};
const afterValues = {
  [MAIN_ARTICLE_ASSET_KEY]: "article-after",
  [MAIN_HOME_ASSET_KEY]: "home-after",
  [ROBOTS_TEMPLATE_ASSET_KEY]: "robots-after",
};
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function observations(values: typeof beforeValues) {
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
    themeId,
    sourceCommit,
    assets: THEME_SOURCE_SYNC_ASSET_KEYS.map((assetKey) => ({
      assetKey,
      beforeSha256: sha256(beforeValues[assetKey]),
      afterSha256: sha256(afterValues[assetKey]),
      afterValue: afterValues[assetKey],
    })),
  };
}

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-theme-sync-1",
    status: "executing",
    platform: "shopify",
    actionType: "sync_theme_source_assets",
    targetEntityId: `${themeId}:source-sync:${sourceCommit}`,
    proposedValue: JSON.stringify(payload()),
    ...overrides,
  } as any;
}

describe("theme source-sync recommendation workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EXECUTE_APPROVED_LIVE_ENABLED", "true");
  });

  it("queues all exact before and after hashes without mutating Shopify", async () => {
    theme.fetch.mockResolvedValue(observations(beforeValues));
    const db: any = {
      rawSnapshot: { findFirst: vi.fn().mockResolvedValue({ id: "snapshot-1" }) },
      recommendation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "rec-theme-sync-1" }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    const result = await queueThemeSourceSyncRecommendation(db, {
      actor: "operator",
      sourceCommit,
      sourceValues: afterValues,
    });

    expect(result).toEqual({ recommendationId: "rec-theme-sync-1", created: true });
    const created = db.recommendation.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      platform: "shopify",
      actionType: "sync_theme_source_assets",
      targetEntityType: "theme_asset_set",
      status: "pending",
    });
    expect(JSON.parse(created.proposedValue)).toEqual(payload());
    expect(theme.update).not.toHaveBeenCalled();
  });

  it("rejects stale live bytes before any mutation", async () => {
    theme.fetch.mockResolvedValue(observations({
      ...beforeValues,
      [MAIN_HOME_ASSET_KEY]: "unexpected-live-change",
    }));

    await expect(
      applyApprovedThemeSourceSyncRecommendation(recommendation()),
    ).rejects.toThrow(/changed after approval/i);
    expect(theme.update).not.toHaveBeenCalled();
  });

  it("writes the exact approved asset set and verifies every read-back hash", async () => {
    theme.fetch.mockResolvedValue(observations(beforeValues));
    theme.update.mockResolvedValue(observations(afterValues));

    const result = await applyApprovedThemeSourceSyncRecommendation(
      recommendation(),
    );

    expect(theme.update).toHaveBeenCalledWith({
      themeId,
      assets: THEME_SOURCE_SYNC_ASSET_KEYS.map((assetKey) => ({
        assetKey,
        value: afterValues[assetKey],
      })),
    });
    expect(result).toMatchObject({
      themeId,
      sourceCommit,
      alreadyApplied: false,
      assetCount: 3,
    });
    expect(result).not.toHaveProperty("values");
  });

  it("accepts the exact after-state idempotently", async () => {
    theme.fetch.mockResolvedValue(observations(afterValues));

    const result = await applyApprovedThemeSourceSyncRecommendation(
      recommendation(),
    );

    expect(result).toMatchObject({ alreadyApplied: true, assetCount: 3 });
    expect(theme.update).not.toHaveBeenCalled();
  });
});
