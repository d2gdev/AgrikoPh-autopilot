import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workflow = vi.hoisted(() => ({
  fetch: vi.fn(),
  queue: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { $disconnect: vi.fn() },
}));
vi.mock("@/lib/shopify-theme-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shopify-theme-assets")>();
  return {
    ...actual,
    fetchMainThemeRobotsAsset: workflow.fetch,
  };
});
vi.mock("@/lib/recommendations/robots-sitemap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/recommendations/robots-sitemap")>();
  return {
    ...actual,
    queueRobotsSitemapRecommendation: workflow.queue,
  };
});

import {
  parseQueueRobotsSitemapArguments,
  runQueueRobotsSitemapRecommendation,
} from "@/scripts/queue-robots-sitemap-recommendation";
import { ROBOTS_TEMPLATE_ASSET_KEY } from "@/lib/shopify-theme-assets";

const before = "User-agent: *\nSitemap: {{ shop.url }}/sitemap.xml\n";
const after = "User-agent: *\nSitemap: https://agrikoph.com/sitemap.xml\n";
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("queue robots sitemap recommendation command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflow.fetch.mockResolvedValue({
      themeId: "gid://shopify/OnlineStoreTheme/123",
      themeRole: "main",
      assetKey: ROBOTS_TEMPLATE_ASSET_KEY,
      value: before,
      sha256: sha256(before),
    });
  });

  it("defaults to a zero-write dry-run", async () => {
    const input = parseQueueRobotsSitemapArguments([]);
    await expect(runQueueRobotsSitemapRecommendation(input)).resolves.toEqual({
      mode: "dry-run",
      themeId: "gid://shopify/OnlineStoreTheme/123",
      assetKey: ROBOTS_TEMPLATE_ASSET_KEY,
      beforeSha256: sha256(before),
      afterSha256: sha256(after),
      recommendationCreated: false,
      liveMutationSent: false,
    });
    expect(workflow.queue).not.toHaveBeenCalled();
  });

  it("queues once only with explicit apply", async () => {
    workflow.queue.mockResolvedValue({
      recommendationId: "rec-robots-1",
      created: true,
    });

    await expect(runQueueRobotsSitemapRecommendation({
      apply: true,
      actor: "operator",
    })).resolves.toEqual({
      mode: "apply",
      recommendationId: "rec-robots-1",
      created: true,
    });
    expect(workflow.queue).toHaveBeenCalledOnce();
    expect(workflow.queue).toHaveBeenCalledWith(
      expect.anything(),
      { actor: "operator" },
    );
  });

  it("rejects every unknown flag", () => {
    expect(() => parseQueueRobotsSitemapArguments(["--live"]))
      .toThrow(/unknown flag/i);
  });
});
