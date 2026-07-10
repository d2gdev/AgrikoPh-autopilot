import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDecodeSessionToken = vi.fn();
const mockShopifyApi = vi.fn(() => ({
  session: {
    decodeSessionToken: mockDecodeSessionToken,
  },
}));

vi.mock("@shopify/shopify-api", () => ({
  ApiVersion: { April26: "2026-04" },
  shopifyApi: mockShopifyApi,
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
    mockShopifyApi.mockClear();
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

  it("uses session-token credentials when they differ from Admin API credentials", async () => {
    vi.stubEnv("SHOPIFY_SESSION_API_KEY", "session-api-key");
    vi.stubEnv("SHOPIFY_SESSION_API_SECRET", "session-api-secret");
    mockDecodeSessionToken.mockResolvedValueOnce({ dest: "https://expected.myshopify.com" });
    const { verifySessionToken } = await import("@/lib/shopify");

    await expect(verifySessionToken(requestWithBearer())).resolves.toBe("expected.myshopify.com");
    expect(mockShopifyApi).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "session-api-key",
      apiSecretKey: "session-api-secret",
    }));
  });

  it("rejects a valid Shopify token for a different shop", async () => {
    mockDecodeSessionToken.mockResolvedValueOnce({ dest: "https://other.myshopify.com" });
    const { verifySessionToken } = await import("@/lib/shopify");

    await expect(verifySessionToken(requestWithBearer())).resolves.toBeNull();
  });

  it("does not log the raw bearer token when verification fails", async () => {
    const token = [
      "header",
      Buffer.from(JSON.stringify({
        aud: "wrong-audience",
        dest: "https://expected.myshopify.com",
        exp: 1783647923,
      })).toString("base64url"),
      "signature",
    ].join(".");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockDecodeSessionToken.mockRejectedValueOnce(
      new Error(`Failed to parse session token '${token}': signature verification failed`),
    );
    const { verifySessionToken } = await import("@/lib/shopify");

    await expect(verifySessionToken(requestWithBearer(token))).resolves.toBeNull();

    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token);
    expect(errorSpy).toHaveBeenCalledWith(
      "[shopify] Session token verification failed",
      expect.objectContaining({
        reason: "signature verification failed",
        token: expect.objectContaining({
          aud: "wrong-audience",
          dest: "expected.myshopify.com",
        }),
      }),
    );
  });
});
