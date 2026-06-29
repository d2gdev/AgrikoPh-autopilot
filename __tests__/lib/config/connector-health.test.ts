import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";

vi.mock("@/lib/db", () => ({
  prisma: {
    apiCredential: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    jobRun: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import { getConnectorHealth } from "@/lib/config/connector-health";

const mockPrisma = prisma as unknown as {
  apiCredential: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  jobRun: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};

describe("connector health", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "test-secret-key-for-connector-health");
    vi.stubEnv("SHOPIFY_STORE_DOMAIN", "example.myshopify.com");
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-env-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    mockPrisma.apiCredential.findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "SHOPIFY_ADMIN_ACCESS_TOKEN") return Promise.resolve({ key: where.key, value: encrypt("shopify-db-token") });
      return Promise.resolve(null);
    });
    mockPrisma.apiCredential.findMany.mockImplementation(({ where }: { where: { key: { in: string[] } } }) => {
      if (!where.key.in.includes("SHOPIFY_ADMIN_ACCESS_TOKEN")) return Promise.resolve([]);
      return Promise.resolve([{ key: "SHOPIFY_ADMIN_ACCESS_TOKEN", value: encrypt("shopify-db-token") }]);
    });
    mockPrisma.jobRun.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns connector status and source metadata without credential values", async () => {
    const connectors = await getConnectorHealth();
    const shopify = connectors.find((connector) => connector.id === "shopify_admin");
    const ai = connectors.find((connector) => connector.id === "ai");
    const metaAds = connectors.find((connector) => connector.id === "meta_ads");

    expect(shopify).toMatchObject({
      status: "configured",
      configured: true,
      sources: [
        { key: "SHOPIFY_STORE_DOMAIN", source: "env" },
        { key: "SHOPIFY_ADMIN_ACCESS_TOKEN", source: "db" },
      ],
      missing: [],
    });
    expect(ai).toMatchObject({
      status: "configured",
      sources: [{ key: "DEEPSEEK_API_KEY", source: "env" }],
    });
    expect(metaAds).toMatchObject({
      status: "missing",
      configured: false,
    });

    expect(JSON.stringify(connectors)).not.toContain("shopify-db-token");
    expect(JSON.stringify(connectors)).not.toContain("deepseek-env-key");
  });
});
