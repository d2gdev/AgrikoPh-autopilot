import { beforeEach, describe, expect, it, vi } from "vitest";

const shopifyFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/shopify-admin", () => ({ shopifyFetch }));

import {
  fetchMainThemeSchemaAsset,
  HOME_SCHEMA_ASSET_KEY,
  updateMainThemeSchemaAsset,
} from "@/lib/shopify-theme-assets";

const themeId = "gid://shopify/OnlineStoreTheme/123";
const before = "{% comment %} before {% endcomment %}\n";
const after = "{% comment %} after {% endcomment %}\n";

function themes(nodes: Array<{ id: string; role: string }>) {
  return { themes: { nodes } };
}

function file(value: string, filename = HOME_SCHEMA_ASSET_KEY) {
  return {
    theme: {
      files: {
        nodes: [{ filename, body: { content: value } }],
        userErrors: [],
      },
    },
  };
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
      });
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
