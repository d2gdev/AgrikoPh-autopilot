import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const locks = vi.hoisted(() => ({ acquireJobLock: vi.fn(), releaseJobLock: vi.fn() }));
vi.mock("@/lib/job-lock", () => locks);

describe("fetch-blog-content shared lock", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses an owner token and releases only its own lock", async () => {
    locks.acquireJobLock.mockResolvedValueOnce(true);
    const run = vi.fn().mockResolvedValue({ status: "success" });
    const { runFetchBlogContentLocked } = await import("@/jobs/fetch-blog-content");

    const result = await runFetchBlogContentLocked(run);

    expect(result).toEqual({ acquired: true, result: { status: "success" } });
    expect(locks.acquireJobLock).toHaveBeenCalledWith("fetch-blog-content", { ownerToken: expect.any(String) });
    const ownerToken = locks.acquireJobLock.mock.calls[0]?.[1]?.ownerToken;
    expect(locks.releaseJobLock).toHaveBeenCalledWith("fetch-blog-content", ownerToken);
  });

  it("does not invoke the handler when another entry point owns the lock", async () => {
    locks.acquireJobLock.mockResolvedValueOnce(false);
    const run = vi.fn();
    const { runFetchBlogContentLocked } = await import("@/jobs/fetch-blog-content");

    await expect(runFetchBlogContentLocked(run)).resolves.toEqual({ acquired: false });
    expect(run).not.toHaveBeenCalled();
    expect(locks.releaseJobLock).not.toHaveBeenCalled();
  });

  it("routes every production entry point through the lock-owning wrapper", () => {
    const paths = [
      "app/api/content-pilot/index/route.ts",
      "app/api/cron/fetch-blog-content/route.ts",
      "app/api/cron/daily/route.ts",
      "app/api/cron/publish-scheduled/route.ts",
      "jobs/run-dashboard-refresh.ts",
      "lib/content-pilot/publish-service.ts",
      "lib/skills/source-registry.ts",
      "scripts/run-fetch-blog.ts",
    ];

    for (const path of paths) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("runFetchBlogContentLocked");
      expect(source, path).not.toMatch(/\bfetchBlogContentHandler\s*\(/);
    }
  });
});
