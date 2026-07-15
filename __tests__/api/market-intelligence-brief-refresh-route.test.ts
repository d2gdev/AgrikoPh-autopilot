import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  requirePermission: vi.fn(),
  getSessionShop: vi.fn(),
  getSessionUser: vi.fn(),
}));
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockGenerateBrief = vi.hoisted(() => vi.fn());
const mockSanitizeBrief = vi.hoisted(() => vi.fn((brief) => brief));
const mockPrisma = vi.hoisted(() => ({ rawSnapshot: { upsert: vi.fn(), findFirst: vi.fn() } }));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  requireAppAuth: mockAuth.requireAppAuth,
  requirePermission: mockAuth.requirePermission,
  getSessionShop: mockAuth.getSessionShop,
  getSessionUser: mockAuth.getSessionUser,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/market-intel/generate-brief", () => ({ generateBrief: mockGenerateBrief, sanitizeBrief: mockSanitizeBrief }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { GET } from "@/app/api/market-intelligence/brief/route";
import { POST } from "@/app/api/market-intelligence/brief/refresh/route";

describe("market intelligence brief refresh route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.requirePermission.mockResolvedValue(null);
    mockAuth.getSessionShop.mockResolvedValue("agriko.myshopify.com");
    mockCheckRateLimit.mockReturnValue(true);
    mockGenerateBrief.mockResolvedValue({ generatedAt: "2026-07-11T00:00:00.000Z" });
    mockPrisma.rawSnapshot.upsert.mockResolvedValue({});
    mockPrisma.rawSnapshot.findFirst.mockResolvedValue(null);
  });

  it("returns the permission response before rate-limit, AI, or database work", async () => {
    mockAuth.requirePermission.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    const response = await POST(new Request("http://test.local/api/market-intelligence/brief/refresh", { method: "POST" }));

    expect(response.status).toBe(403);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockGenerateBrief).not.toHaveBeenCalled();
    expect(mockPrisma.rawSnapshot.upsert).not.toHaveBeenCalled();
  });

  it("does not check permission after failed embedded authentication", async () => {
    mockAuth.requireAppAuth.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    const response = await POST(new Request("http://test.local/api/market-intelligence/brief/refresh", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(mockAuth.requirePermission).not.toHaveBeenCalled();
  });

  it("blocks cache-miss generation before rate-limit, AI, or database work", async () => {
    mockAuth.requirePermission.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    const response = await GET(new Request("http://test.local/api/market-intelligence/brief"));

    expect(response.status).toBe(403);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockGenerateBrief).not.toHaveBeenCalled();
    expect(mockPrisma.rawSnapshot.upsert).not.toHaveBeenCalled();
  });

  it("applies current safety rules to an already cached brief", async () => {
    const cached = {
      generatedAt: "2026-07-15T00:00:00.000Z",
      adsActivity: "Ads", pricingMovements: "Prices", opportunities: "Ideas",
      recommendedActions: [{ priority: "high", action: "Unsafe price comparison", reason: "Unsupported" }],
    };
    mockPrisma.rawSnapshot.findFirst.mockResolvedValueOnce({
      fetchedAt: new Date("2026-07-15T00:00:00.000Z"), payload: cached,
    });
    mockSanitizeBrief.mockReturnValueOnce({ ...cached, recommendedActions: [] });

    const response = await GET(new Request("http://test.local/api/market-intelligence/brief"));
    const body = await response.json();

    expect(mockSanitizeBrief).toHaveBeenCalledWith(cached);
    expect(body.brief.recommendedActions).toEqual([]);
    expect(mockGenerateBrief).not.toHaveBeenCalled();
  });
});
