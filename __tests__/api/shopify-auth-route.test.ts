import { afterEach, describe, expect, it } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("GET /api/auth/shopify", () => {
  it("redirects direct app visits to the configured Shopify Admin app", async () => {
    process.env.SHOPIFY_ADMIN_APP_URL =
      "https://admin.shopify.com/store/agriko-3/apps/seoai-9";
    process.env.SHOPIFY_STORE_DOMAIN = "e56aau-5f.myshopify.com";
    process.env.SHOPIFY_API_KEY = "legacy-app-key";

    const { GET } = await import("@/app/api/auth/[...shopify]/route");
    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://admin.shopify.com/store/agriko-3/apps/seoai-9",
    );
  });
});
