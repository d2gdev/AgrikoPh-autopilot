import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDecodeSessionToken = vi.fn();

vi.mock("@shopify/shopify-api", () => ({
  ApiVersion: { April26: "2026-04" },
  shopifyApi: vi.fn(() => ({
    session: {
      decodeSessionToken: mockDecodeSessionToken,
    },
  })),
}));

vi.mock("@shopify/shopify-api/adapters/node", () => ({}));

function requestWithBearer(token = "valid-token") {
  return new Request("http://localhost/api/test", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("verifySessionToken", () => {
  beforeEach(() => {
    vi.resetModules();
    mockDecodeSessionToken.mockReset();
    vi.stubEnv("SHOPIFY_API_KEY", "api-key");
    vi.stubEnv("SHOPIFY_API_SECRET", "api-secret");
    vi.stubEnv("SHOPIFY_APP_URL", "https://app.example.com");
    vi.stubEnv("SHOPIFY_STORE_DOMAIN", "expected.myshopify.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the normalized shop when the token destination matches the configured store", async () => {
    mockDecodeSessionToken.mockResolvedValueOnce({ dest: "https://expected.myshopify.com" });
    const { verifySessionToken } = await import("@/lib/shopify");

    await expect(verifySessionToken(requestWithBearer())).resolves.toBe("expected.myshopify.com");
  });

  it("rejects a valid Shopify token for a different shop", async () => {
    mockDecodeSessionToken.mockResolvedValueOnce({ dest: "https://other.myshopify.com" });
    const { verifySessionToken } = await import("@/lib/shopify");

    await expect(verifySessionToken(requestWithBearer())).resolves.toBeNull();
  });
});
