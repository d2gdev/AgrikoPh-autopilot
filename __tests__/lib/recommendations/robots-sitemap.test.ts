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
    fetchMainThemeRobotsAsset: theme.fetch,
    updateMainThemeRobotsAsset: theme.update,
  };
});

import {
  applyApprovedRobotsSitemapRecommendation,
  CANONICAL_SITEMAP_URL,
  fixRobotsSitemapUrl,
  queueRobotsSitemapRecommendation,
} from "@/lib/recommendations/robots-sitemap";
import { ROBOTS_TEMPLATE_ASSET_KEY } from "@/lib/shopify-theme-assets";

const themeId = "gid://shopify/OnlineStoreTheme/123";
const before = `{% for group in robots.default_groups %}
  {{- group.user_agent -}}
  {% for rule in group.rules %}
    {{- rule -}}
  {% endfor %}
{% endfor %}

Sitemap: {{ shop.url }}/sitemap.xml
`;
const after = before.replace(
  "Sitemap: {{ shop.url }}/sitemap.xml",
  `Sitemap: ${CANONICAL_SITEMAP_URL}`,
);
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function observation(value: string) {
  return {
    themeId,
    themeRole: "main" as const,
    assetKey: ROBOTS_TEMPLATE_ASSET_KEY,
    value,
    sha256: sha256(value),
  };
}

function recommendation(overrides: Record<string, unknown> = {}) {
  const payload = {
    themeId,
    assetKey: ROBOTS_TEMPLATE_ASSET_KEY,
    beforeSha256: sha256(before),
    afterSha256: sha256(after),
    afterValue: after,
  };
  return {
    id: "rec-robots-1",
    status: "executing",
    platform: "shopify",
    actionType: "fix_robots_sitemap_url",
    targetEntityId: `${themeId}:${ROBOTS_TEMPLATE_ASSET_KEY}`,
    proposedValue: JSON.stringify(payload),
    ...overrides,
  } as any;
}

describe("robots sitemap recommendation workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EXECUTE_APPROVED_LIVE_ENABLED", "true");
  });

  it("replaces only the one approved dynamic sitemap directive", () => {
    expect(fixRobotsSitemapUrl(before)).toBe(after);
    expect(after).toContain("Sitemap: https://agrikoph.com/sitemap.xml");
    expect(after).not.toContain("{{ shop.url }}/sitemap.xml");
  });

  it.each([
    "Sitemap: /sitemap.xml",
    "Sitemap: https://agrikoph.com/sitemap.xml",
    "Sitemap: {{ shop.url }}/sitemap.xml\nSitemap: {{ shop.url }}/sitemap.xml",
  ])("fails closed unless the approved source line appears exactly once", (value) => {
    expect(() => fixRobotsSitemapUrl(value)).toThrow(/exactly one/i);
  });

  it("queues exact hashes in a pending Shopify recommendation", async () => {
    theme.fetch.mockResolvedValue(observation(before));
    const db: any = {
      rawSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ id: "snapshot-1" }),
      },
      recommendation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "rec-robots-1" }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    const result = await queueRobotsSitemapRecommendation(db, {
      actor: "operator",
    });

    expect(result).toEqual({
      recommendationId: "rec-robots-1",
      created: true,
    });
    const create = db.recommendation.create.mock.calls[0][0].data;
    expect(create).toMatchObject({
      platform: "shopify",
      actionType: "fix_robots_sitemap_url",
      targetEntityType: "theme_asset",
      status: "pending",
      snapshotId: "snapshot-1",
      currentValue: sha256(before),
    });
    expect(JSON.parse(create.proposedValue)).toEqual({
      themeId,
      assetKey: ROBOTS_TEMPLATE_ASSET_KEY,
      beforeSha256: sha256(before),
      afterSha256: sha256(after),
      afterValue: after,
    });
    expect(theme.update).not.toHaveBeenCalled();
  });

  it("requires executing identity and the live execution flag", async () => {
    await expect(applyApprovedRobotsSitemapRecommendation(
      recommendation({ status: "approved" }),
    )).rejects.toThrow(/must be executing/i);

    vi.stubEnv("EXECUTE_APPROVED_LIVE_ENABLED", "false");
    await expect(applyApprovedRobotsSitemapRecommendation(
      recommendation(),
    )).rejects.toThrow(/disabled/i);
    expect(theme.update).not.toHaveBeenCalled();
  });

  it("rejects stale live bytes before mutation", async () => {
    theme.fetch.mockResolvedValue(observation(`${before}\nchanged`));

    await expect(applyApprovedRobotsSitemapRecommendation(
      recommendation(),
    )).rejects.toThrow(/changed after approval/i);
    expect(theme.update).not.toHaveBeenCalled();
  });

  it("writes and verifies only the exact approved after bytes", async () => {
    theme.fetch.mockResolvedValue(observation(before));
    theme.update.mockResolvedValue(observation(after));

    const result = await applyApprovedRobotsSitemapRecommendation(
      recommendation(),
    );

    expect(theme.update).toHaveBeenCalledWith({
      themeId,
      assetKey: ROBOTS_TEMPLATE_ASSET_KEY,
      value: after,
    });
    expect(result).toMatchObject({
      themeId,
      assetKey: ROBOTS_TEMPLATE_ASSET_KEY,
      beforeSha256: sha256(before),
      afterSha256: sha256(after),
      alreadyApplied: false,
    });
    expect(result).not.toHaveProperty("value");
  });

  it("accepts an already-applied exact value idempotently", async () => {
    theme.fetch.mockResolvedValue(observation(after));

    const result = await applyApprovedRobotsSitemapRecommendation(
      recommendation(),
    );

    expect(result).toMatchObject({ alreadyApplied: true });
    expect(theme.update).not.toHaveBeenCalled();
  });

  it("rejects a post-write hash mismatch", async () => {
    theme.fetch.mockResolvedValue(observation(before));
    theme.update.mockResolvedValue(observation(`${after}\nchanged`));

    await expect(applyApprovedRobotsSitemapRecommendation(
      recommendation(),
    )).rejects.toThrow(/read-back hash/i);
  });
});
