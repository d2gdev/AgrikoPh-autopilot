import { shopifyFetch } from "@/lib/shopify-admin";

export type ShopifyThemeIdentity = {
  id: string;
  name: string;
  role: "MAIN" | "UNPUBLISHED" | "DEVELOPMENT";
  processing: boolean;
  updatedAt: string;
};

const THEME_READY_ATTEMPTS = 30;
const THEME_READY_POLL_MS = 5_000;
const THEME_ID_PATTERN = /^gid:\/\/shopify\/OnlineStoreTheme\/\d+$/;
const DUPLICATE_NAME_PATTERN =
  /^autopilot-cache-flush-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/;

function assertThemeId(themeId: string): void {
  if (!THEME_ID_PATTERN.test(themeId)) {
    throw new Error("Shopify theme identity is invalid");
  }
}

function assertTheme(value: ShopifyThemeIdentity | null): ShopifyThemeIdentity {
  if (!value || !THEME_ID_PATTERN.test(value.id)) {
    throw new Error("Shopify theme response was invalid");
  }
  return value;
}

export async function fetchShopifyThemes(): Promise<ShopifyThemeIdentity[]> {
  const data = await shopifyFetch<{
    themes: { nodes: ShopifyThemeIdentity[] };
  }>(`
    query GovernedThemeInventory {
      themes(first: 50) {
        nodes {
          id
          name
          role
          processing
          updatedAt
        }
      }
    }
  `);
  return data.themes.nodes.map((theme) => assertTheme(theme));
}

export async function fetchExactlyOneMainTheme(): Promise<ShopifyThemeIdentity> {
  const main = (await fetchShopifyThemes()).filter(
    (theme) => theme.role === "MAIN",
  );
  if (main.length !== 1) {
    throw new Error("Shopify must expose exactly one published main theme");
  }
  return main[0]!;
}

export async function duplicateShopifyTheme(input: {
  sourceThemeId: string;
  name: string;
}): Promise<ShopifyThemeIdentity> {
  assertThemeId(input.sourceThemeId);
  if (!DUPLICATE_NAME_PATTERN.test(input.name)) {
    throw new Error("Shopify cache-flush theme name is invalid");
  }
  const data = await shopifyFetch<{
    themeDuplicate: {
      newTheme: ShopifyThemeIdentity | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(`
    mutation DuplicateGovernedMainTheme($id: ID!, $name: String) {
      themeDuplicate(id: $id, name: $name) {
        newTheme {
          id
          name
          role
          processing
          updatedAt
        }
        userErrors {
          field
          message
        }
      }
    }
  `, { id: input.sourceThemeId, name: input.name });
  if (data.themeDuplicate.userErrors.length > 0) {
    throw new Error("Shopify theme duplication was rejected");
  }
  const duplicate = assertTheme(data.themeDuplicate.newTheme);
  if (duplicate.name !== input.name || duplicate.role === "MAIN") {
    throw new Error("Shopify theme duplicate identity was invalid");
  }
  return duplicate;
}

async function fetchTheme(themeId: string): Promise<ShopifyThemeIdentity> {
  assertThemeId(themeId);
  const data = await shopifyFetch<{
    theme: ShopifyThemeIdentity | null;
  }>(`
    query GovernedThemeProcessingState($themeId: ID!) {
      theme(id: $themeId) {
        id
        name
        role
        processing
        updatedAt
      }
    }
  `, { themeId });
  const theme = assertTheme(data.theme);
  if (theme.id !== themeId) {
    throw new Error("Shopify theme processing identity changed");
  }
  return theme;
}

export async function waitForShopifyThemeReady(
  themeId: string,
): Promise<ShopifyThemeIdentity> {
  for (let attempt = 0; attempt < THEME_READY_ATTEMPTS; attempt++) {
    const theme = await fetchTheme(themeId);
    if (!theme.processing) return theme;
    if (attempt < THEME_READY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, THEME_READY_POLL_MS));
    }
  }
  throw new Error("Shopify theme duplication did not finish processing");
}

export async function publishShopifyTheme(
  themeId: string,
): Promise<ShopifyThemeIdentity> {
  assertThemeId(themeId);
  const data = await shopifyFetch<{
    themePublish: {
      theme: ShopifyThemeIdentity | null;
      userErrors: Array<{
        code?: string;
        field: string[] | null;
        message: string;
      }>;
    };
  }>(`
    mutation PublishVerifiedCacheFlushTheme($id: ID!) {
      themePublish(id: $id) {
        theme {
          id
          name
          role
          processing
          updatedAt
        }
        userErrors {
          code
          field
          message
        }
      }
    }
  `, { id: themeId });
  if (data.themePublish.userErrors.length > 0) {
    throw new Error("Shopify theme publication was rejected");
  }
  const published = assertTheme(data.themePublish.theme);
  if (published.id !== themeId || published.role !== "MAIN") {
    throw new Error("Shopify published theme identity was invalid");
  }
  return published;
}
