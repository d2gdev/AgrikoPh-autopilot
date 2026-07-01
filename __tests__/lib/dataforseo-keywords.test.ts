import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/resolver", () => ({
  getOptionalSecret: vi.fn(async (k: string) =>
    k === "DATAFORSEO_LOGIN" ? "login@example.com" : k === "DATAFORSEO_PASSWORD" ? "pw" : null),
}));

import { fetchSearchVolume } from "@/lib/connectors/dataforseo-keywords";

function mockFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch;
}

beforeEach(() => vi.clearAllMocks());

describe("fetchSearchVolume", () => {
  it("parses keyword → volume from a live response (normalized keys)", async () => {
    mockFetch(200, {
      tasks: [{ result: [
        { keyword: "Organic Black Rice", search_volume: 1300 },
        { keyword: "red rice philippines", search_volume: 210 },
        { keyword: "no volume", search_volume: null },
      ] }],
    });
    const r = await fetchSearchVolume(["Organic Black Rice", "red rice philippines", "no volume"]);
    expect(r.disabled).toBeFalsy();
    expect(r.volumes.get("organic black rice")).toBe(1300);
    expect(r.volumes.get("red rice philippines")).toBe(210);
    expect(r.volumes.has("no volume")).toBe(false); // null volume dropped
  });

  it("degrades to disabled (no throw) on 403 out-of-credits", async () => {
    mockFetch(403, { status_message: "Not enough credits" });
    const r = await fetchSearchVolume(["organic rice"]);
    expect(r.disabled).toBe(true);
    expect(r.volumes.size).toBe(0);
  });

  it("returns empty (no fetch) for an empty keyword list", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    const r = await fetchSearchVolume(["", "   "]);
    expect(r.volumes.size).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("still throws on a genuine server error (500)", async () => {
    mockFetch(500, { status_message: "boom" });
    await expect(fetchSearchVolume(["x"])).rejects.toThrow();
  });
});
