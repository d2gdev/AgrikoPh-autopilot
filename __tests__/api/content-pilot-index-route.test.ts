import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.hoisted(() => ({ requireAppAuth: vi.fn(), requirePermission: vi.fn(), getSessionShop: vi.fn(), getSessionUser: vi.fn() }));
const mockJobLock = vi.hoisted(() => ({ acquireJobLock: vi.fn(), releaseJobLock: vi.fn() }));
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockFetchBlogContentHandler = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  requireAppAuth: mockAuth.requireAppAuth,
  requirePermission: mockAuth.requirePermission,
  getSessionShop: mockAuth.getSessionShop,
  getSessionUser: mockAuth.getSessionUser,
}));
vi.mock("@/lib/job-lock", () => mockJobLock);
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/jobs/fetch-blog-content", () => ({ fetchBlogContentHandler: mockFetchBlogContentHandler }));

describe("Content Pilot index route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.requirePermission.mockResolvedValue(null);
    mockAuth.getSessionShop.mockResolvedValue("test-shop");
    mockAuth.getSessionUser.mockResolvedValue("operator-1");
    mockCheckRateLimit.mockReturnValue(true);
    mockJobLock.acquireJobLock.mockResolvedValue(true);
    mockJobLock.releaseJobLock.mockResolvedValue(undefined);
    mockFetchBlogContentHandler.mockResolvedValue({ status: "success", indexed: 1, skipped: 0 });
  });

  it("returns a conflict without indexing when the shared blog-content lock is held", async () => {
    mockJobLock.acquireJobLock.mockResolvedValueOnce(false);
    const { POST } = await import("@/app/api/content-pilot/index/route");

    const response = await POST(new Request("http://test.local/api/content-pilot/index", { method: "POST" }));

    expect(response.status).toBe(409);
    expect(mockJobLock.acquireJobLock).toHaveBeenCalledWith("fetch-blog-content");
    expect(mockFetchBlogContentHandler).not.toHaveBeenCalled();
    expect(mockJobLock.releaseJobLock).not.toHaveBeenCalled();
  });

  it("releases the shared lock after a completed index run", async () => {
    const { POST } = await import("@/app/api/content-pilot/index/route");

    const response = await POST(new Request("http://test.local/api/content-pilot/index", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(mockFetchBlogContentHandler).toHaveBeenCalledTimes(1);
    expect(mockJobLock.releaseJobLock).toHaveBeenCalledWith("fetch-blog-content");
  });

  it("rate limits repeated operator indexing before acquiring the lock", async () => {
    mockCheckRateLimit.mockReturnValueOnce(false);
    const { POST } = await import("@/app/api/content-pilot/index/route");

    const response = await POST(new Request("http://test.local/api/content-pilot/index", { method: "POST" }));

    expect(response.status).toBe(429);
    expect(mockJobLock.acquireJobLock).not.toHaveBeenCalled();
    expect(mockFetchBlogContentHandler).not.toHaveBeenCalled();
  });

  it("uses the session user for rate limiting when the shop is unavailable", async () => {
    mockAuth.getSessionShop.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/content-pilot/index/route");

    await POST(new Request("http://test.local/api/content-pilot/index", { method: "POST" }));

    expect(mockCheckRateLimit).toHaveBeenCalledWith("content-index:operator-1", 3, 60_000);
  });
});
