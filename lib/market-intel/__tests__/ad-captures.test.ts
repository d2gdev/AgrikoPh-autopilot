import { describe, expect, it } from "vitest";
import {
  adChangeInsightData,
  changedTrackedAdFields,
  shouldCreateAdCapture,
  type TrackedAdFields,
} from "@/lib/market-intel/ad-captures";

function ad(overrides: Partial<TrackedAdFields> = {}): TrackedAdFields {
  return {
    adCopy: "Buy organic black rice today",
    headline: "Organic black rice",
    description: "Farm-grown rice.",
    cta: "Shop Now",
    landingPageUrl: "https://agrikoph.com/products/organic-black-rice",
    activeStatus: "ACTIVE",
    creativeType: "image",
    imageUrl: "https://example.com/image.jpg",
    videoUrl: null,
    ...overrides,
  };
}

describe("changedTrackedAdFields", () => {
  it("detects normalized tracked field changes", () => {
    expect(changedTrackedAdFields(ad(), ad({ cta: "Learn More", landingPageUrl: "https://example.com/new" }))).toEqual([
      "cta",
      "landingPageUrl",
    ]);
  });

  it("treats blank strings and null as equivalent", () => {
    expect(changedTrackedAdFields(ad({ videoUrl: null }), ad({ videoUrl: "  " }))).toEqual([]);
  });
});

describe("shouldCreateAdCapture", () => {
  it("creates a capture for a new ad", () => {
    expect(shouldCreateAdCapture({
      latestCapture: null,
      current: ad(),
      capturedAt: new Date("2026-06-24T00:00:00.000Z"),
    })).toMatchObject({ create: true, reason: "new" });
  });

  it("skips unchanged recent ads", () => {
    expect(shouldCreateAdCapture({
      latestCapture: { ...ad(), capturedAt: new Date("2026-06-23T00:00:00.000Z") },
      current: ad(),
      capturedAt: new Date("2026-06-24T00:00:00.000Z"),
    })).toEqual({ create: false, reason: "unchanged", changedFields: [] });
  });

  it("creates a capture when tracked fields change", () => {
    expect(shouldCreateAdCapture({
      latestCapture: { ...ad(), capturedAt: new Date("2026-06-23T00:00:00.000Z") },
      current: ad({ headline: "New headline" }),
      capturedAt: new Date("2026-06-24T00:00:00.000Z"),
    })).toMatchObject({ create: true, reason: "changed", changedFields: ["headline"] });
  });

  it("creates a periodic stale capture after seven days", () => {
    expect(shouldCreateAdCapture({
      latestCapture: { ...ad(), capturedAt: new Date("2026-06-16T00:00:00.000Z") },
      current: ad(),
      capturedAt: new Date("2026-06-24T00:00:00.000Z"),
    })).toEqual({ create: true, reason: "stale", changedFields: [] });
  });
});

describe("adChangeInsightData", () => {
  it("creates a warning insight for reactivated ads and landing page changes", () => {
    const insight = adChangeInsightData({
      competitorName: "Competitor",
      competitorId: "competitor-1",
      competitorAdId: "ad-1",
      adArchiveId: "archive-1",
      previousAd: { id: "ad-1", ...ad({ activeStatus: "INACTIVE", landingPageUrl: "https://old.example.com" }) },
      current: ad({ activeStatus: "ACTIVE", landingPageUrl: "https://new.example.com" }),
      changedFields: ["activeStatus", "landingPageUrl"],
    });

    expect(insight).toMatchObject({
      type: "competitor_ad_changed",
      severity: "warning",
      competitorId: "competitor-1",
      adId: "ad-1",
    });
    expect(insight?.evidence).toMatchObject({
      changedFields: ["activeStatus", "landingPageUrl"],
      reactivated: true,
    });
  });
});
