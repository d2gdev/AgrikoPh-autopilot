import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  credentials: new Map<string, { key: string; value: string; updatedAt: Date; updatedBy: string | null }>(),
}));

vi.mock("@/lib/auth", () => ({
  requireAppAuth: vi.fn().mockResolvedValue(null),
  requirePermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { SETTINGS_ADMIN: "settings:admin" },
  getSessionShop: vi.fn().mockResolvedValue("test-shop.myshopify.com"),
  getSessionUser: vi.fn().mockResolvedValue("test-shop.myshopify.com"),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    apiCredential: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        return state.credentials.get(where.key) ?? null;
      }),
      upsert: vi.fn(async ({ where, create, update }: {
        where: { key: string };
        create: { key: string; value: string; updatedBy: string | null };
        update: { value: string; updatedBy: string | null };
      }) => {
        const existing = state.credentials.get(where.key);
        const row = {
          key: where.key,
          value: existing ? update.value : create.value,
          updatedAt: new Date("2026-06-19T00:00:00.000Z"),
          updatedBy: existing ? update.updatedBy : create.updatedBy,
        };
        state.credentials.set(where.key, row);
        return { key: row.key, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
      }),
    },
  },
}));

import { POST } from "@/app/api/settings/credentials/route";
import { shopifyFetch } from "@/lib/shopify-admin";

describe("Settings credential roundtrip", () => {
  beforeEach(() => {
    state.credentials.clear();
    vi.unstubAllEnvs();
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "test-secret-key-for-settings-roundtrip");
    vi.stubEnv("SHOPIFY_STORE_DOMAIN", "env-shop.myshopify.com");
    vi.stubEnv("SHOPIFY_ADMIN_ACCESS_TOKEN", "env-token");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("saves through Settings API and connector reads the DB credential before env fallback", async () => {
    const response = await POST(new Request("http://test.local/api/settings/credentials", {
      method: "POST",
      body: JSON.stringify({
        key: "SHOPIFY_ADMIN_ACCESS_TOKEN",
        value: "db-token",
      }),
    }) as never);

    expect(response.status).toBe(201);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: { shop: { name: "Agriko" } },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(shopifyFetch<{ shop: { name: string } }>("{ shop { name } }")).resolves.toEqual({
      shop: { name: "Agriko" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://env-shop.myshopify.com/admin/api/2025-01/graphql.json",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Shopify-Access-Token": "db-token",
        }),
      })
    );
  });
});
