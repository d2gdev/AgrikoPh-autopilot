import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/resolver", () => ({
  getOptionalSecret: vi.fn(async (key: string) => key === "SERPER_API_KEY" ? "test-key" : null),
}));

import { fetchSerperOrganicResults } from "@/lib/connectors/serper-organic";
import { buildBrandSerpObservations, captureDailyBrandSerp, normalizeBrandSerpUrl, serializeBrandSerpObservations } from "@/lib/seo/brand-serp";

function mockFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchSerperOrganicResults", () => {
  it("requests a localized organic SERP and preserves provider positions", async () => {
    mockFetch(200, {
      organic: [{
        position: 2,
        title: "Agriko | Cebu City",
        link: "https://www.facebook.com/AgrikoPH/",
        snippet: "Agriko profile",
      }],
    });

    const result = await fetchSerperOrganicResults({
      query: "agriko",
      location: "Cebu City, Central Visayas, Philippines",
      countryCode: "ph",
      languageCode: "en",
      device: "mobile",
      limit: 30,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://google.serper.dev/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          q: "agriko",
          location: "Cebu City, Central Visayas, Philippines",
          gl: "ph",
          hl: "en",
          num: 30,
          device: "mobile",
        }),
      }),
    );
    expect(result.disabled).toBeFalsy();
    expect(result.results).toEqual([expect.objectContaining({ position: 2, title: "Agriko | Cebu City" })]);
  });

  it("degrades without throwing when Serper cannot serve the request", async () => {
    mockFetch(403, { message: "Not enough credits" });

    const result = await fetchSerperOrganicResults({ query: "agriko" });

    expect(result).toEqual({ disabled: true, results: [] });
  });
});

describe("brand SERP normalization", () => {
  it("removes Google tracking parameters without changing the canonical URL", () => {
    expect(normalizeBrandSerpUrl("https://agrikoph.com/?srsltid=tracking-value"))
      .toBe("https://agrikoph.com/");
  });

  it("records the advisory as absent when it is not in the captured organic results", () => {
    const rows = buildBrandSerpObservations({
      observedAt: "2026-07-15T10:56:36.716Z",
      query: "agriko",
      location: "Philippines",
      language: "en",
      device: "desktop",
      rawCaptureId: "capture-1",
      results: [{
        position: 1,
        title: "Agriko",
        link: "https://agrikoph.com/?srsltid=value",
        snippet: "Agriko homepage",
        rawPayload: {},
      }],
    });

    expect(rows).toEqual([
      expect.objectContaining({ organicPosition: 1, normalizedUrl: "https://agrikoph.com/", isAdvisory: false }),
      expect.objectContaining({ organicPosition: "not_in_top_30", isAdvisory: true }),
    ]);
  });

  it("captures the fixed Philippines and Cebu desktop/mobile schedule", async () => {
    const fetchResults = vi.fn(async (_input: { location?: string | null; device?: "desktop" | "mobile" }) => ({
      results: [{
        position: 1,
        title: "Agriko",
        link: "https://agrikoph.com/",
        snippet: null,
        rawPayload: {},
      }],
    }));

    const captures = await captureDailyBrandSerp({
      observedAt: "2026-07-15T10:56:36.716Z",
      fetchResults,
    });

    expect(fetchResults.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({ location: "Philippines", device: "desktop" }),
      expect.objectContaining({ location: "Philippines", device: "mobile" }),
      expect.objectContaining({ location: "Cebu City, Central Visayas, Philippines", device: "desktop" }),
      expect.objectContaining({ location: "Cebu City, Central Visayas, Philippines", device: "mobile" }),
    ]);
    expect(captures).toHaveLength(4);
    expect(captures.every(capture => capture.observations.at(-1)?.isAdvisory)).toBe(true);
  });

  it("refuses to record an absence when the provider is disabled", async () => {
    await expect(captureDailyBrandSerp({
      observedAt: "2026-07-15T10:56:36.716Z",
      fetchResults: async () => ({ disabled: true, results: [] }),
    })).rejects.toThrow("SERPER_ORGANIC_UNAVAILABLE");
  });

  it("serializes observations as append-safe CSV", () => {
    const rows = buildBrandSerpObservations({
      observedAt: "2026-07-15T10:56:36.716Z",
      query: "agriko",
      location: "Cebu City, Central Visayas, Philippines",
      language: "en",
      device: "desktop",
      rawCaptureId: "capture-1",
      results: [],
    });

    const csv = serializeBrandSerpObservations(rows, { includeHeader: true });

    expect(csv).toContain("observed_at,provider,query,location");
    expect(csv).toContain("\"Cebu City, Central Visayas, Philippines\"");
    expect(csv.endsWith("\n")).toBe(true);
  });
});
