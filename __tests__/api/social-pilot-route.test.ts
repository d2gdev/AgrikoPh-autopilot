import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAppAuth: vi.fn(async () => null) }));
vi.mock("@/lib/connectors/meta-organic", () => ({
  fetchManagedPages: vi.fn(),
  fetchPagePosts: vi.fn(),
}));

import { GET } from "@/app/api/social-pilot/route";
import { fetchManagedPages } from "@/lib/connectors/meta-organic";

describe("GET /api/social-pilot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.META_ACCESS_TOKEN = "test-token";
  });

  it("identifies an expired Meta token instead of returning an opaque 500", async () => {
    vi.mocked(fetchManagedPages).mockRejectedValue(new Error("Meta API error 400: {\"error\":{\"code\":190}}"));

    const response = await GET(new Request("http://localhost/api/social-pilot"));

    expect(response.status).toBe(424);
    await expect(response.json()).resolves.toMatchObject({ code: "META_TOKEN_EXPIRED" });
  });
});
