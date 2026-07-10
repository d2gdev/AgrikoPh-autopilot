import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  marketKeyword: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  competitor: {
    upsert: vi.fn(),
  },
  competitorSocialPage: {
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAppAuth: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

import { POST } from "@/app/api/market-intelligence/config/route";

describe("market intelligence config route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("MARKET_INTEL_DEFAULT_LOCATION", "Philippines");
    mockPrisma.marketKeyword.findFirst.mockResolvedValue(null);
    mockPrisma.marketKeyword.create.mockResolvedValue({
      id: "kw-1",
      keyword: "sample",
      category: null,
      locationName: "Philippines",
      languageCode: "en",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.competitor.upsert.mockResolvedValue({
      id: "comp-1",
      name: "Acme",
      domain: null,
      notes: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.competitorSocialPage.upsert.mockResolvedValue({
      id: "page-1",
      competitorId: "comp-1",
      platform: "facebook",
      pageName: "Acme Page",
      pageId: "12345",
      pageUrl: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("requires a numeric pageId for facebook pages", async () => {
    const res = await POST(new Request("http://test.local/api/market-intelligence/config", {
      method: "POST",
      body: JSON.stringify({
        competitors: [
          {
            name: "Acme",
            pages: [
              {
                platform: "facebook",
                pageName: "Acme Page",
                pageId: "abc",
              },
            ],
          },
        ],
      }),
    }));

    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error).toBeDefined();
  });

  it("requires a pageId for meta and facebook pages", async () => {
    const res = await POST(new Request("http://test.local/api/market-intelligence/config", {
      method: "POST",
      body: JSON.stringify({
        competitors: [
          {
            name: "Acme",
            pages: [
              {
                platform: "meta",
                pageName: "Meta Page",
                pageId: "   ",
              },
            ],
          },
        ],
      }),
    }));

    expect(res.status).toBe(400);
  });

  it("normalizes and persists lowercase platform and trimmed pageId", async () => {
    const res = await POST(new Request("http://test.local/api/market-intelligence/config", {
      method: "POST",
      body: JSON.stringify({
        competitors: [
          {
            name: "Acme",
            pages: [
              {
                platform: "FACEBOOK",
                pageName: "Acme Page",
                pageId: " 12345 ",
              },
            ],
          },
        ],
      }),
    }));

    expect(res.status).toBe(200);
    expect(mockPrisma.competitor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: "Acme" },
        update: expect.objectContaining({ active: true }),
      }),
    );
    // Upserts directly on the unique identityKey — atomic, so two concurrent
    // identical submissions can't both pass a "not found" check and race on create.
    expect(mockPrisma.competitorSocialPage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { identityKey: "facebook|12345" },
        create: expect.objectContaining({ platform: "facebook", pageId: "12345" }),
        update: expect.objectContaining({ pageId: "12345" }),
      }),
    );
  });
});
