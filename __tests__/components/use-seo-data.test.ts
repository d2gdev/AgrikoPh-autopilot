import { describe, expect, it, vi } from "vitest";
import { loadSeoCoreRequest } from "@/app/(embedded)/(seo-pillar)/seo-pillar/components/useSeoData";

const valid = { topQueries: [], topPages: [], gscFetchedAt: null, ga4FetchedAt: null, trends: null, opportunities: [], gscPages: [], queryPagePairs: [] };

describe("loadSeoCoreRequest", () => {
  it("rejects failed responses without committing", async () => {
    const commit = vi.fn();
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "upstream unavailable" }), { status: 500 }));
    await expect(loadSeoCoreRequest(authFetch, commit)).rejects.toThrow("upstream unavailable");
    expect(commit).not.toHaveBeenCalled();
  });
  it("commits valid responses once", async () => {
    const commit = vi.fn();
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(valid), { status: 200 }));
    await loadSeoCoreRequest(authFetch, commit);
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith(valid);
  });
});
