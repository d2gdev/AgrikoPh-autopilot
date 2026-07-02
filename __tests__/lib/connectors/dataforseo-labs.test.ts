import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/resolver", () => ({
  getOptionalSecret: vi.fn(),
}));

import { getOptionalSecret } from "@/lib/config/resolver";
import {
  fetchDomainIntersection,
  fetchRankedKeywords,
  resolveLabsLimit,
} from "@/lib/connectors/dataforseo-labs";

const mockGetSecret = getOptionalSecret as unknown as ReturnType<typeof vi.fn>;

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSecret.mockImplementation(async (key: string) => {
    if (key === "DATAFORSEO_LOGIN") return "login";
    if (key === "DATAFORSEO_PASSWORD") return "password";
    return null;
  });
  delete process.env.DATAFORSEO_LABS_LIMIT;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveLabsLimit", () => {
  it("defaults to 20 when nothing is configured", () => {
    expect(resolveLabsLimit(undefined)).toBe(20);
  });

  it("reads DATAFORSEO_LABS_LIMIT from env when no explicit value is passed", () => {
    process.env.DATAFORSEO_LABS_LIMIT = "50";
    expect(resolveLabsLimit(undefined)).toBe(50);
  });

  it("clamps to the hard max of 100", () => {
    expect(resolveLabsLimit(500)).toBe(100);
    process.env.DATAFORSEO_LABS_LIMIT = "999";
    expect(resolveLabsLimit(undefined)).toBe(100);
  });

  it("falls back to the default for non-finite or non-positive values", () => {
    expect(resolveLabsLimit(0)).toBe(20);
    expect(resolveLabsLimit(-5)).toBe(20);
    expect(resolveLabsLimit(Number.NaN)).toBe(20);
  });

  it("rounds fractional explicit values", () => {
    expect(resolveLabsLimit(12.7)).toBe(13);
  });
});

describe("fetchRankedKeywords", () => {
  it("returns disabled:true and makes no request when credentials are missing", async () => {
    mockGetSecret.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRankedKeywords("agrikoph.com", 10);

    expect(result).toEqual({ disabled: true, items: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs a task array with the clamped limit and Basic auth header", async () => {
    const fetchMock = mockFetchOnce(200, { tasks: [{ result: [{ items: [] }] }] });
    vi.stubGlobal("fetch", fetchMock);

    await fetchRankedKeywords("agrikoph.com", 500);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/v3/dataforseo_labs/google/ranked_keywords/live");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("login:password").toString("base64")}`);
    const body = JSON.parse(init.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].target).toBe("agrikoph.com");
    expect(body[0].limit).toBe(100); // clamped
  });

  it("parses keyword/position/searchVolume/cpc/url from nested result items", async () => {
    const fetchMock = mockFetchOnce(200, {
      tasks: [{
        result: [{
          items: [
            {
              keyword_data: {
                keyword: "turmeric powder",
                keyword_info: { search_volume: 1200, cpc: 0.45 },
              },
              ranked_serp_element: {
                serp_item: { rank_absolute: 4, url: "https://agrikoph.com/turmeric" },
              },
            },
            { keyword_data: {} }, // no keyword -> filtered out
          ],
        }],
      }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRankedKeywords("agrikoph.com", 10);

    expect(result.items).toEqual([
      { keyword: "turmeric powder", position: 4, searchVolume: 1200, cpc: 0.45, url: "https://agrikoph.com/turmeric" },
    ]);
  });

  it("throws on a non-OK response", async () => {
    const fetchMock = mockFetchOnce(500, { status_message: "boom" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRankedKeywords("agrikoph.com", 10)).rejects.toThrow(/DataForSEO error 500/);
  });

  it("returns an empty item list for a malformed/empty payload", async () => {
    const fetchMock = mockFetchOnce(200, {});
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRankedKeywords("agrikoph.com", 10);
    expect(result.items).toEqual([]);
  });
});

describe("fetchDomainIntersection", () => {
  it("returns disabled:true and makes no request when credentials are missing", async () => {
    mockGetSecret.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDomainIntersection("agrikoph.com", "rival.com", 10);
    expect(result).toEqual({ disabled: true, items: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests the union (intersections:false) with both domains and the clamped limit", async () => {
    const fetchMock = mockFetchOnce(200, { tasks: [{ result: [{ items: [] }] }] });
    vi.stubGlobal("fetch", fetchMock);

    await fetchDomainIntersection("agrikoph.com", "rival.com", 10);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/v3/dataforseo_labs/google/domain_intersection/live");
    const body = JSON.parse(init.body);
    expect(body[0].target1).toBe("agrikoph.com");
    expect(body[0].target2).toBe("rival.com");
    expect(body[0].intersections).toBe(false);
  });

  it("keeps only rows where the competitor ranks and we don't", async () => {
    const fetchMock = mockFetchOnce(200, {
      tasks: [{
        result: [{
          items: [
            {
              keyword_data: { keyword: "gap-keyword", keyword_info: { search_volume: 500, cpc: 1.1 } },
              first_domain_serp_element: null,
              second_domain_serp_element: { rank_absolute: 3 },
            },
            {
              keyword_data: { keyword: "both-rank", keyword_info: { search_volume: 500 } },
              first_domain_serp_element: { rank_absolute: 5 },
              second_domain_serp_element: { rank_absolute: 3 },
            },
            {
              keyword_data: { keyword: "only-we-rank", keyword_info: { search_volume: 500 } },
              first_domain_serp_element: { rank_absolute: 2 },
              second_domain_serp_element: null,
            },
          ],
        }],
      }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDomainIntersection("agrikoph.com", "rival.com", 10);

    expect(result.items).toEqual([
      { keyword: "gap-keyword", competitorPosition: 3, ourPosition: null, searchVolume: 500, cpc: 1.1 },
    ]);
  });
});
