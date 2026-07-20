import { beforeEach, describe, expect, it, vi } from "vitest";

const shopifyFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/shopify-admin", () => ({ shopifyFetch }));

import {
  duplicateShopifyTheme,
  fetchExactlyOneMainTheme,
  fetchShopifyThemes,
  publishShopifyTheme,
  waitForShopifyThemeReady,
} from "@/lib/shopify-theme-cache";

const sourceThemeId = "gid://shopify/OnlineStoreTheme/123";
const duplicateThemeId = "gid://shopify/OnlineStoreTheme/456";
const duplicateName = "autopilot-cache-flush-2026-07-20-02-30-00";

function theme(overrides: Record<string, unknown> = {}) {
  return {
    id: sourceThemeId,
    name: "Current main",
    role: "MAIN",
    processing: false,
    updatedAt: "2026-07-20T02:00:00Z",
    ...overrides,
  };
}

describe("Shopify theme cache lifecycle adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("lists themes and discovers exactly one published main theme", async () => {
    shopifyFetch.mockResolvedValue({
      themes: {
        nodes: [
          theme(),
          theme({
            id: duplicateThemeId,
            name: "Unpublished",
            role: "UNPUBLISHED",
          }),
        ],
      },
    });

    const themes = await fetchShopifyThemes();
    expect(themes).toHaveLength(2);
    expect(await fetchExactlyOneMainTheme()).toMatchObject({
      id: sourceThemeId,
      role: "MAIN",
      processing: false,
    });
    expect(String(shopifyFetch.mock.calls[0]?.[0])).toContain("themes(first: 50)");
  });

  it("rejects zero or multiple main themes", async () => {
    shopifyFetch.mockResolvedValueOnce({ themes: { nodes: [] } });
    await expect(fetchExactlyOneMainTheme()).rejects.toThrow(
      /exactly one published main theme/i,
    );

    shopifyFetch.mockResolvedValueOnce({
      themes: {
        nodes: [
          theme(),
          theme({ id: duplicateThemeId }),
        ],
      },
    });
    await expect(fetchExactlyOneMainTheme()).rejects.toThrow(
      /exactly one published main theme/i,
    );
  });

  it("duplicates only the exact source theme with the approved name", async () => {
    shopifyFetch.mockResolvedValue({
      themeDuplicate: {
        newTheme: theme({
          id: duplicateThemeId,
          name: duplicateName,
          role: "UNPUBLISHED",
          processing: true,
        }),
        userErrors: [],
      },
    });

    await expect(duplicateShopifyTheme({
      sourceThemeId,
      name: duplicateName,
    })).resolves.toMatchObject({
      id: duplicateThemeId,
      name: duplicateName,
      role: "UNPUBLISHED",
    });
    expect(shopifyFetch.mock.calls[0]?.[1]).toEqual({
      id: sourceThemeId,
      name: duplicateName,
    });
  });

  it("polls a duplicate until Shopify finishes processing it", async () => {
    vi.useFakeTimers();
    shopifyFetch
      .mockResolvedValueOnce({
        theme: theme({
          id: duplicateThemeId,
          name: duplicateName,
          role: "UNPUBLISHED",
          processing: true,
        }),
      })
      .mockResolvedValueOnce({
        theme: theme({
          id: duplicateThemeId,
          name: duplicateName,
          role: "UNPUBLISHED",
          processing: false,
        }),
      });

    const pending = waitForShopifyThemeReady(duplicateThemeId);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({
      id: duplicateThemeId,
      processing: false,
    });
    expect(shopifyFetch).toHaveBeenCalledTimes(2);
    expect(shopifyFetch.mock.calls[0]?.[1]).toEqual({
      themeId: duplicateThemeId,
    });
  });

  it("publishes only the exact verified duplicate ID", async () => {
    shopifyFetch.mockResolvedValue({
      themePublish: {
        theme: theme({
          id: duplicateThemeId,
          name: duplicateName,
          role: "MAIN",
        }),
        userErrors: [],
      },
    });

    await expect(publishShopifyTheme(duplicateThemeId)).resolves.toMatchObject({
      id: duplicateThemeId,
      role: "MAIN",
    });
    expect(shopifyFetch.mock.calls[0]?.[1]).toEqual({
      id: duplicateThemeId,
    });
  });
});
