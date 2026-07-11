import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  requirePermission: vi.fn(),
  getSessionShop: vi.fn(),
  getSessionUser: vi.fn(),
}));
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockFillCaptureTranslations = vi.hoisted(() => vi.fn());
const mockGenerateStolenAd = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({ contentProposal: { create: vi.fn() } }));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review", SETTINGS_ADMIN: "settings:admin" },
  requireAppAuth: mockAuth.requireAppAuth,
  requirePermission: mockAuth.requirePermission,
  getSessionShop: mockAuth.getSessionShop,
  getSessionUser: mockAuth.getSessionUser,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/market-intel/translate-captures", () => ({ fillCaptureTranslations: mockFillCaptureTranslations }));
vi.mock("@/lib/market-intel/steal-ad", () => ({ generateStolenAd: mockGenerateStolenAd }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { POST as backfillPOST } from "@/app/api/market-intelligence/backfill-translations/route";
import { POST as stealAdPOST } from "@/app/api/market-intelligence/steal-ad/route";
import { POST as sendToContentPilotPOST } from "@/app/api/market-intelligence/steal-ad/send-to-content-pilot/route";

describe("market intelligence mutation permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.requirePermission.mockResolvedValue(null);
    mockCheckRateLimit.mockReturnValue(true);
  });

  it("blocks translation backfill before rate limiting or translation work", async () => {
    mockAuth.requirePermission.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    const response = await backfillPOST(new Request("http://test.local/api/market-intelligence/backfill-translations", { method: "POST" }));

    expect(response.status).toBe(403);
    expect(mockAuth.requirePermission).toHaveBeenCalledWith(expect.any(Request), "settings:admin");
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockFillCaptureTranslations).not.toHaveBeenCalled();
  });

  it("blocks ad rewriting and proposal creation before side effects", async () => {
    mockAuth.requirePermission.mockResolvedValue(new Response("Forbidden", { status: 403 }));

    const rewriteResponse = await stealAdPOST(new Request("http://test.local/api/market-intelligence/steal-ad", {
      method: "POST", body: JSON.stringify({ adId: "ad-1" }),
    }));
    const proposalResponse = await sendToContentPilotPOST(new Request("http://test.local/api/market-intelligence/steal-ad/send-to-content-pilot", {
      method: "POST", body: JSON.stringify({ headline: "H", adCopy: "C", sourceAdId: "ad-1" }),
    }));

    expect(rewriteResponse.status).toBe(403);
    expect(proposalResponse.status).toBe(403);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockGenerateStolenAd).not.toHaveBeenCalled();
    expect(mockPrisma.contentProposal.create).not.toHaveBeenCalled();
  });
});
