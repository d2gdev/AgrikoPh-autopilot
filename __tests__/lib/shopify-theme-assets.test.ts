import { beforeEach, describe, expect, it, vi } from "vitest";

const shopifyFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/shopify-admin", () => ({ shopifyFetch }));

import {
  ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY,
  fetchThemeSourceAssets,
  fetchMainThemeSourceAssets,
  fetchMainThemeSchemaAsset,
  fetchMainThemeRobotsAsset,
  HOME_SCHEMA_ASSET_KEY,
  MAIN_ARTICLE_ASSET_KEY,
  MAIN_HOME_ASSET_KEY,
  ROBOTS_TEMPLATE_ASSET_KEY,
  updateMainThemeSourceAssets,
  updateMainThemeRobotsAsset,
  updateMainThemeSchemaAsset,
} from "@/lib/shopify-theme-assets";

const themeId = "gid://shopify/OnlineStoreTheme/123";
const before = "{% comment %} before {% endcomment %}\n";
const after = "{% comment %} after {% endcomment %}\n";

function themes(nodes: Array<{ id: string; role: string }>) {
  return { themes: { nodes } };
}

function file(value: string, filename: string = HOME_SCHEMA_ASSET_KEY) {
  return {
    theme: {
      files: {
        nodes: [{ filename, body: { content: value } }],
        userErrors: [],
      },
    },
  };
}

function sourceFiles(values: Record<string, string>) {
  return {
    theme: {
      files: {
        nodes: Object.entries(values).map(([filename, content]) => ({
          filename,
          body: { content },
        })),
        userErrors: [],
      },
    },
  };
}

function completedJob(id: string) {
  return { job: { id, done: true } };
}

describe("Shopify main-theme schema asset adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("discovers exactly one main theme and reads only the fixed Liquid asset", async () => {
    shopifyFetch
      .mockResolvedValueOnce(themes([{ id: themeId, role: "MAIN" }]))
      .mockResolvedValueOnce(file(before));

    const result = await fetchMainThemeSchemaAsset();

    expect(result).toMatchObject({
      themeId,
      themeRole: "main",
      assetKey: HOME_SCHEMA_ASSET_KEY,
      value: before,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(shopifyFetch.mock.calls[1]?.[1]).toEqual({
      themeId,
      filenames: [HOME_SCHEMA_ASSET_KEY],
    });
  });

  it("reads only the fixed robots Liquid asset", async () => {
    shopifyFetch
      .mockResolvedValueOnce(themes([{ id: themeId, role: "MAIN" }]))
      .mockResolvedValueOnce(file(before, ROBOTS_TEMPLATE_ASSET_KEY));

    const result = await fetchMainThemeRobotsAsset();

    expect(result).toMatchObject({
      themeId,
      themeRole: "main",
      assetKey: ROBOTS_TEMPLATE_ASSET_KEY,
      value: before,
    });
    expect(shopifyFetch.mock.calls[1]?.[1]).toEqual({
      themeId,
      filenames: [ROBOTS_TEMPLATE_ASSET_KEY],
    });
  });

  it("reads the exact four source-sync assets from one published theme", async () => {
    shopifyFetch
      .mockResolvedValueOnce(themes([{ id: themeId, role: "MAIN" }]))
      .mockResolvedValueOnce(sourceFiles({
        [MAIN_ARTICLE_ASSET_KEY]: "article-before",
        [MAIN_HOME_ASSET_KEY]: "home-before",
        [ROBOTS_TEMPLATE_ASSET_KEY]: "robots-before",
        [ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY]: "article-snippet-before",
      }));

    const result = await fetchMainThemeSourceAssets();

    expect(result.map((asset) => asset.assetKey)).toEqual([
      MAIN_ARTICLE_ASSET_KEY,
      MAIN_HOME_ASSET_KEY,
      ROBOTS_TEMPLATE_ASSET_KEY,
      ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY,
    ]);
    expect(shopifyFetch.mock.calls[1]?.[1]).toEqual({
      themeId,
      filenames: [
        MAIN_ARTICLE_ASSET_KEY,
        MAIN_HOME_ASSET_KEY,
        ROBOTS_TEMPLATE_ASSET_KEY,
        ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY,
      ],
    });
  });

  it("reads the fixed source-sync assets from an exact named theme", async () => {
    const duplicateThemeId = "gid://shopify/OnlineStoreTheme/456";
    shopifyFetch.mockResolvedValueOnce(sourceFiles({
      [MAIN_ARTICLE_ASSET_KEY]: "article-after",
      [MAIN_HOME_ASSET_KEY]: "home-after",
      [ROBOTS_TEMPLATE_ASSET_KEY]: "robots-after",
      [ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY]: "article-snippet-after",
    }));

    const result = await fetchThemeSourceAssets(duplicateThemeId);

    expect(result).toHaveLength(4);
    expect(shopifyFetch.mock.calls[0]?.[1]).toEqual({
      themeId: duplicateThemeId,
      filenames: [
        MAIN_ARTICLE_ASSET_KEY,
        MAIN_HOME_ASSET_KEY,
        ROBOTS_TEMPLATE_ASSET_KEY,
        ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY,
      ],
    });
  });

  it("upserts and verifies the exact source-sync asset set in one mutation", async () => {
    const values = {
      [MAIN_ARTICLE_ASSET_KEY]: "article-after",
      [MAIN_HOME_ASSET_KEY]: "home-after",
      [ROBOTS_TEMPLATE_ASSET_KEY]: "robots-after",
      [ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY]: "article-snippet-after",
    };
    shopifyFetch
      .mockResolvedValueOnce(themes([{ id: themeId, role: "MAIN" }]))
      .mockResolvedValueOnce({
        themeFilesUpsert: {
          upsertedThemeFiles: Object.keys(values).map((filename) => ({ filename })),
          job: { id: "gid://shopify/Job/3" },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce(completedJob("gid://shopify/Job/3"))
      .mockResolvedValueOnce(sourceFiles(values));

    const result = await updateMainThemeSourceAssets({
      themeId,
      assets: Object.entries(values).map(([assetKey, value]) => ({
        assetKey,
        value,
      })) as never,
    });

    expect(shopifyFetch.mock.calls[1]?.[1]).toEqual({
      themeId,
      files: [
        { filename: MAIN_ARTICLE_ASSET_KEY, body: { type: "TEXT", value: "article-after" } },
        { filename: MAIN_HOME_ASSET_KEY, body: { type: "TEXT", value: "home-after" } },
        { filename: ROBOTS_TEMPLATE_ASSET_KEY, body: { type: "TEXT", value: "robots-after" } },
        {
          filename: ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY,
          body: { type: "TEXT", value: "article-snippet-after" },
        },
      ],
    });
    expect(result.map((asset) => asset.value)).toEqual([
      "article-after",
      "home-after",
      "robots-after",
      "article-snippet-after",
    ]);
  });

  it("waits for the asynchronous Shopify write job before file read-back", async () => {
    const values = {
      [MAIN_ARTICLE_ASSET_KEY]: "article-after",
      [MAIN_HOME_ASSET_KEY]: "home-after",
      [ROBOTS_TEMPLATE_ASSET_KEY]: "robots-after",
      [ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY]: "article-snippet-after",
    };
    shopifyFetch
      .mockResolvedValueOnce(themes([{ id: themeId, role: "MAIN" }]))
      .mockResolvedValueOnce({
        themeFilesUpsert: {
          upsertedThemeFiles: Object.keys(values).map((filename) => ({ filename })),
          job: { id: "gid://shopify/Job/async-theme-write" },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        job: { id: "gid://shopify/Job/async-theme-write", done: false },
      })
      .mockResolvedValueOnce({
        job: { id: "gid://shopify/Job/async-theme-write", done: true },
      })
      .mockResolvedValueOnce(sourceFiles(values));

    const result = await updateMainThemeSourceAssets({
      themeId,
      assets: Object.entries(values).map(([assetKey, value]) => ({
        assetKey,
        value,
      })) as never,
    });

    expect(result).toHaveLength(4);
    expect(shopifyFetch.mock.calls[2]?.[1]).toEqual({
      jobId: "gid://shopify/Job/async-theme-write",
    });
    expect(shopifyFetch.mock.calls[3]?.[1]).toEqual({
      jobId: "gid://shopify/Job/async-theme-write",
    });
    expect(String(shopifyFetch.mock.calls[2]?.[0])).toContain("job(id: $jobId)");
  });

  it("rejects zero or multiple published main themes", async () => {
    shopifyFetch.mockResolvedValueOnce(themes([]));
    await expect(fetchMainThemeSchemaAsset()).rejects.toThrow(/exactly one published main theme/i);

    shopifyFetch.mockResolvedValueOnce(themes([
      { id: themeId, role: "MAIN" },
      { id: "gid://shopify/OnlineStoreTheme/456", role: "MAIN" },
    ]));
    await expect(fetchMainThemeSchemaAsset()).rejects.toThrow(/exactly one published main theme/i);
  });

  it("upserts one TEXT file and requires exact read-back bytes", async () => {
    shopifyFetch
      .mockResolvedValueOnce(themes([{ id: themeId, role: "MAIN" }]))
      .mockResolvedValueOnce({
        themeFilesUpsert: {
          upsertedThemeFiles: [{ filename: HOME_SCHEMA_ASSET_KEY }],
          job: { id: "gid://shopify/Job/1" },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce(completedJob("gid://shopify/Job/1"))
      .mockResolvedValueOnce(file(after));

    const result = await updateMainThemeSchemaAsset({
      themeId,
      assetKey: HOME_SCHEMA_ASSET_KEY,
      value: after,
    });

    expect(shopifyFetch.mock.calls[1]?.[1]).toEqual({
      themeId,
      files: [{
        filename: HOME_SCHEMA_ASSET_KEY,
        body: { type: "TEXT", value: after },
      }],
    });
    expect(result.value).toBe(after);
  });

  it("rejects every asset key outside the fixed allowlist", async () => {
    await expect(updateMainThemeSchemaAsset({
      themeId,
      assetKey: "layout/theme.liquid" as never,
      value: after,
    })).rejects.toThrow(/asset key is not allowed/i);
    expect(shopifyFetch).not.toHaveBeenCalled();
  });

  it("upserts only the fixed robots asset and requires exact read-back bytes", async () => {
    shopifyFetch
      .mockResolvedValueOnce(themes([{ id: themeId, role: "MAIN" }]))
      .mockResolvedValueOnce({
        themeFilesUpsert: {
          upsertedThemeFiles: [{ filename: ROBOTS_TEMPLATE_ASSET_KEY }],
          job: { id: "gid://shopify/Job/2" },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce(completedJob("gid://shopify/Job/2"))
      .mockResolvedValueOnce(file(after, ROBOTS_TEMPLATE_ASSET_KEY));

    const result = await updateMainThemeRobotsAsset({
      themeId,
      assetKey: ROBOTS_TEMPLATE_ASSET_KEY,
      value: after,
    });

    expect(shopifyFetch.mock.calls[1]?.[1]).toEqual({
      themeId,
      files: [{
        filename: ROBOTS_TEMPLATE_ASSET_KEY,
        body: { type: "TEXT", value: after },
      }],
    });
    expect(result).toMatchObject({
      assetKey: ROBOTS_TEMPLATE_ASSET_KEY,
      value: after,
    });
  });

  it("rejects non-robots keys through the robots writer", async () => {
    await expect(updateMainThemeRobotsAsset({
      themeId,
      assetKey: HOME_SCHEMA_ASSET_KEY as never,
      value: after,
    })).rejects.toThrow(/asset key is not allowed/i);
    expect(shopifyFetch).not.toHaveBeenCalled();
  });

  it("fails boundedly when post-write bytes never match", async () => {
    vi.useFakeTimers();
    shopifyFetch
      .mockResolvedValueOnce(themes([{ id: themeId, role: "MAIN" }]))
      .mockResolvedValueOnce({
        themeFilesUpsert: {
          upsertedThemeFiles: [{ filename: HOME_SCHEMA_ASSET_KEY }],
          job: { id: "gid://shopify/Job/1" },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce(completedJob("gid://shopify/Job/1"));
    for (let index = 0; index < 5; index++) {
      shopifyFetch.mockResolvedValueOnce(file(before));
    }

    const pending = updateMainThemeSchemaAsset({
      themeId,
      assetKey: HOME_SCHEMA_ASSET_KEY,
      value: after,
    });
    const handled = pending.catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    const error = await handled;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Shopify theme asset read-back did not match the approved hash",
    );
    expect((error as Error).message).not.toContain(before);
    expect((error as Error).message).not.toContain(after);
  });
});
