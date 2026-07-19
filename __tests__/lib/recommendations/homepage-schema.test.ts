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
    fetchMainThemeSchemaAsset: theme.fetch,
    updateMainThemeSchemaAsset: theme.update,
  };
});

import {
  applyApprovedHomepageSchemaRecommendation,
  queueHomepageSchemaRecommendation,
  removeHomepageOfferCatalog,
} from "@/lib/recommendations/homepage-schema";
import { HOME_SCHEMA_ASSET_KEY } from "@/lib/shopify-theme-assets";

const themeId = "gid://shopify/OnlineStoreTheme/123";
const before = `{
      "hasMerchantReturnPolicy": {
        "@type": "MerchantReturnPolicy"
      },
      "hasOfferCatalog": { "@id": {{ shop.url | append: '/#offer-catalog' | json }} }
    }
    {% if template.name == 'index' %}
    {%- assign schema_featured_collection = collections['home-page-featured'] -%}
    ,{
      "@type": "OfferCatalog",
      "@id": {{ shop.url | append: '/#offer-catalog' | json }},
      "itemListElement": []
    }
    ,{
      "@type": "ItemList",
      "@id": {{ shop.url | append: '/#featured-products' | json }},
      "itemListElement": []
    }
    {% endif %}
`;
const after = `{
      "hasMerchantReturnPolicy": {
        "@type": "MerchantReturnPolicy"
      }
    }
    {% if template.name == 'index' %}
    {%- assign schema_featured_collection = collections['home-page-featured'] -%}
    ,{
      "@type": "ItemList",
      "@id": {{ shop.url | append: '/#featured-products' | json }},
      "itemListElement": []
    }
    {% endif %}
`;
const liveLegacyBefore = `{
      "branchOf": { "@id": {{ shop.url | append: '/#organization' | json }} },
      "hasOfferCatalog": {
        "@type": "OfferCatalog",
        "name": "Agriko Products",
        "itemListElement": [
          { "@type": "Offer", "itemOffered": { "@type": "Thing", "name": "Black Rice" } }
        ]
      },
      "sameAs": [
        "https://www.facebook.com/AgrikoPH"
      ]
    }
    {% if template.name == 'index' %}
    ,{
      "@type": "OfferCatalog",
      "@id": {{ shop.url | append: '/#offer-catalog' | json }},
      "itemListElement": []
    }
    ,{
      "@type": "ItemList",
      "@id": {{ shop.url | append: '/#featured-products' | json }},
      "itemListElement": []
    }
    {% endif %}
`;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function observation(value: string) {
  return {
    themeId,
    themeRole: "main" as const,
    assetKey: HOME_SCHEMA_ASSET_KEY,
    value,
    sha256: sha256(value),
  };
}

function recommendation(overrides: Record<string, unknown> = {}) {
  const payload = {
    themeId,
    assetKey: HOME_SCHEMA_ASSET_KEY,
    beforeSha256: sha256(before),
    afterSha256: sha256(after),
    afterValue: after,
  };
  return {
    id: "rec-1",
    status: "executing",
    platform: "shopify",
    actionType: "remove_homepage_offer_catalog",
    targetEntityId: `${themeId}:${HOME_SCHEMA_ASSET_KEY}`,
    proposedValue: JSON.stringify(payload),
    ...overrides,
  } as any;
}

describe("homepage OfferCatalog recommendation workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EXECUTE_APPROVED_LIVE_ENABLED", "true");
  });

  it("removes exactly the incomplete OfferCatalog and retains the ItemList", () => {
    expect(removeHomepageOfferCatalog(before)).toBe(after);
    expect(after).toContain('"@type": "ItemList"');
    expect(after).not.toContain("hasOfferCatalog");
    expect(after).not.toContain('"@type": "OfferCatalog"');
  });

  it("removes the older live nested catalog shape without changing adjacent schema", () => {
    const result = removeHomepageOfferCatalog(liveLegacyBefore);

    expect(result).toContain('"branchOf"');
    expect(result).toContain('"sameAs"');
    expect(result).toContain('"@type": "ItemList"');
    expect(result).not.toContain("hasOfferCatalog");
    expect(result).not.toContain('"@type": "OfferCatalog"');
  });

  it("fails closed unless each approved schema block appears exactly once", () => {
    expect(() => removeHomepageOfferCatalog(before.replace("hasOfferCatalog", "other"))).toThrow(/exactly one hasOfferCatalog/i);
    expect(() => removeHomepageOfferCatalog(before + before)).toThrow(/exactly one hasOfferCatalog/i);
    expect(() => removeHomepageOfferCatalog(before.replace('"@type": "ItemList"', '"@type": "Other"'))).toThrow(/exactly one homepage ItemList/i);
  });

  it("queues exact before and after hashes in a pending Shopify recommendation", async () => {
    theme.fetch.mockResolvedValue(observation(before));
    const db: any = {
      rawSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ id: "snapshot-1" }),
      },
      recommendation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "rec-1" }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    const result = await queueHomepageSchemaRecommendation(db, { actor: "operator" });

    expect(result).toEqual({ recommendationId: "rec-1", created: true });
    const create = db.recommendation.create.mock.calls[0][0].data;
    expect(create).toMatchObject({
      platform: "shopify",
      actionType: "remove_homepage_offer_catalog",
      targetEntityType: "theme_asset",
      status: "pending",
      snapshotId: "snapshot-1",
      currentValue: sha256(before),
    });
    expect(JSON.parse(create.proposedValue)).toEqual({
      themeId,
      assetKey: HOME_SCHEMA_ASSET_KEY,
      beforeSha256: sha256(before),
      afterSha256: sha256(after),
      afterValue: after,
    });
    expect(theme.update).not.toHaveBeenCalled();
  });

  it("requires executing identity and the live execution flag", async () => {
    await expect(applyApprovedHomepageSchemaRecommendation(
      recommendation({ status: "approved" }),
    )).rejects.toThrow(/must be executing/i);

    vi.stubEnv("EXECUTE_APPROVED_LIVE_ENABLED", "false");
    await expect(applyApprovedHomepageSchemaRecommendation(
      recommendation(),
    )).rejects.toThrow(/disabled/i);
    expect(theme.update).not.toHaveBeenCalled();
  });

  it("rejects stale live bytes before mutation", async () => {
    theme.fetch.mockResolvedValue(observation(`${before}\nchanged`));

    await expect(applyApprovedHomepageSchemaRecommendation(
      recommendation(),
    )).rejects.toThrow(/changed after approval/i);
    expect(theme.update).not.toHaveBeenCalled();
  });

  it("writes and verifies only the exact approved after bytes", async () => {
    theme.fetch.mockResolvedValue(observation(before));
    theme.update.mockResolvedValue(observation(after));

    const result = await applyApprovedHomepageSchemaRecommendation(recommendation());

    expect(theme.update).toHaveBeenCalledWith({
      themeId,
      assetKey: HOME_SCHEMA_ASSET_KEY,
      value: after,
    });
    expect(result).toMatchObject({
      themeId,
      assetKey: HOME_SCHEMA_ASSET_KEY,
      beforeSha256: sha256(before),
      afterSha256: sha256(after),
    });
    expect(result).not.toHaveProperty("value");
  });

  it("rejects a post-write hash mismatch without returning asset bytes", async () => {
    theme.fetch.mockResolvedValue(observation(before));
    theme.update.mockResolvedValue(observation(`${after}\nchanged`));

    await expect(applyApprovedHomepageSchemaRecommendation(
      recommendation(),
    )).rejects.toThrow(/read-back hash/i);
  });
});
