import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";

vi.mock("@/lib/db", () => ({
  prisma: {
    apiCredential: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import { getConnectorConfig, getOptionalSecret, getSecret, resolveConfigValue } from "@/lib/config/resolver";

const mockPrisma = prisma as unknown as {
  apiCredential: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

describe("config resolver", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "test-secret-key-for-config-resolver-tests");
    mockPrisma.apiCredential.findUnique.mockReset();
    mockPrisma.apiCredential.findMany.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses DB credential before env fallback", async () => {
    vi.stubEnv("SHOPIFY_ADMIN_ACCESS_TOKEN", "env-token");
    mockPrisma.apiCredential.findUnique.mockResolvedValue({ value: encrypt("db-token") });

    await expect(getSecret("SHOPIFY_ADMIN_ACCESS_TOKEN")).resolves.toBe("db-token");
    expect(console.warn).toHaveBeenCalledWith('[config] DB credential "SHOPIFY_ADMIN_ACCESS_TOKEN" overrides environment value');
  });

  it("uses env value when DB credential is absent", async () => {
    vi.stubEnv("SHOPIFY_STORE_DOMAIN", "example.myshopify.com");
    mockPrisma.apiCredential.findUnique.mockResolvedValue(null);

    await expect(getOptionalSecret("SHOPIFY_STORE_DOMAIN")).resolves.toBe("example.myshopify.com");
  });

  it("reports missing when neither DB nor env exists", async () => {
    mockPrisma.apiCredential.findUnique.mockResolvedValue(null);

    await expect(resolveConfigValue("MISSING_KEY")).resolves.toEqual({
      key: "MISSING_KEY",
      value: null,
      source: "missing",
    });
    await expect(getSecret("MISSING_KEY")).rejects.toThrow("Missing required credential: MISSING_KEY");
  });

  it("returns source metadata for connector config", async () => {
    vi.stubEnv("A_KEY", "a-env");
    mockPrisma.apiCredential.findMany.mockResolvedValue([
      { key: "B_KEY", value: encrypt("b-db") },
    ]);

    await expect(getConnectorConfig(["A_KEY", "B_KEY"] as const)).resolves.toMatchObject({
      A_KEY: { source: "env", value: "a-env" },
      B_KEY: { source: "db", value: "b-db" },
    });
  });
});
