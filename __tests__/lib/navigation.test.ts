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
      "/seo",
      "/settings",
    ]);
  });

  it("preserves special active matching rules", () => {
    const seo = { label: "SEO", href: "/seo", match: "prefix" as const };
    const images = { label: "Images", href: "/images", match: "prefix" as const };

    expect(matchesNavigationItem("/seo", seo)).toBe(true);
    expect(matchesNavigationItem("/seo/queries", seo)).toBe(true);
    expect(matchesNavigationItem("/seo-pillar", seo)).toBe(false);
    expect(matchesNavigationItem("/images", images)).toBe(true);
    expect(matchesNavigationItem("/store-pilot", images)).toBe(false);
  });
});
