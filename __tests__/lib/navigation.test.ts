import { describe, expect, it } from "vitest";
import {
  EMBEDDED_NAVIGATION_SECTIONS,
  getAppBridgeNavigationItems,
  matchesNavigationItem,
} from "@/lib/navigation";

describe("embedded navigation config", () => {
  it("uses one shared config for side navigation and App Bridge subset", () => {
    const allItems = EMBEDDED_NAVIGATION_SECTIONS.flatMap((section) => section.items);

    expect(allItems.map((item) => item.href)).toContain("/");
    expect(getAppBridgeNavigationItems().map((item) => item.href)).toEqual([
      "/",
      "/campaigns",
      "/recommendations",
      "/ad-approvals",
      "/seo-pillar",
      "/content-pilot",
      "/social-pilot",
      "/market-intelligence",
      "/insights",
      "/settings",
    ]);
  });

  it("routes the SEO nav entry to the pillar dashboard (/seo is a redirect)", () => {
    const allItems = EMBEDDED_NAVIGATION_SECTIONS.flatMap((section) => section.items);
    expect(allItems.map((item) => item.href)).not.toContain("/seo");
    const seo = { label: "SEO", href: "/seo-pillar", match: "prefix" as const };
    expect(matchesNavigationItem("/seo-pillar", seo)).toBe(true);
  });

  it("preserves special active matching rules", () => {
    const images = { label: "Images", href: "/images", match: "prefix" as const };

    expect(matchesNavigationItem("/images", images)).toBe(true);
    expect(matchesNavigationItem("/store-pilot", images)).toBe(false);
  });
});
