import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchProductImages = vi.hoisted(() => vi.fn());
const mockAuth = vi.hoisted(() => ({ requireAppAuth: vi.fn() }));

vi.mock("@/lib/shopify-admin", () => ({
  fetchProductImages: mockFetchProductImages,
  updateProductMediaAlt: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  requireAppAuth: mockAuth.requireAppAuth,
  getSessionShop: vi.fn(),
  getSessionUser: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { auditLog: { create: vi.fn() } } }));
vi.mock("@/lib/ai/client", () => ({ getAiClient: vi.fn() }));

describe("images GET route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockFetchProductImages.mockResolvedValue([]);
  });

  it("does not reuse an in-flight ordinary image read for an explicit refresh", async () => {
    let resolveInitialImages!: (value: []) => void;
    const initialImages = new Promise<[]>((resolve) => { resolveInitialImages = resolve; });
    mockFetchProductImages
      .mockImplementationOnce(() => initialImages)
      .mockResolvedValue([]);
    const { GET } = await import("@/app/api/images/route");

    const ordinary = GET(new Request("http://test.local/api/images"));
    await vi.waitFor(() => expect(mockFetchProductImages).toHaveBeenCalledTimes(1));
    const refresh = GET(new Request("http://test.local/api/images?refresh=1"));
    const refreshStarted = vi.waitFor(() => expect(mockFetchProductImages).toHaveBeenCalledTimes(2));
    try {
      await refreshStarted;
    } finally {
      resolveInitialImages([]);
      await Promise.all([ordinary, refresh]);
    }
  });

  it("keeps an explicit refresh in the server cache when an older read completes afterward", async () => {
    let resolveInitialImages!: (value: Array<{ imageId: string; altText: string | null }>) => void;
    const initialImages = new Promise<Array<{ imageId: string; altText: string | null }>>((resolve) => { resolveInitialImages = resolve; });
    mockFetchProductImages
      .mockImplementationOnce(() => initialImages)
      .mockResolvedValueOnce([{ imageId: "fresh", altText: null }]);
    const { GET } = await import("@/app/api/images/route");

    const ordinary = GET(new Request("http://test.local/api/images"));
    await vi.waitFor(() => expect(mockFetchProductImages).toHaveBeenCalledTimes(1));
    const refreshed = await GET(new Request("http://test.local/api/images?refresh=1"));
    resolveInitialImages([{ imageId: "old", altText: null }]);
    await ordinary;

    const cached = await GET(new Request("http://test.local/api/images"));
    expect(mockFetchProductImages).toHaveBeenCalledTimes(2);
    expect((await refreshed.json()).images[0].imageId).toBe("fresh");
    expect((await cached.json()).images[0].imageId).toBe("fresh");
  });
});
