import { createHash } from "node:crypto";
import { shopifyFetch } from "@/lib/shopify-admin";

export const HOME_SCHEMA_ASSET_KEY =
  "snippets/schema-global-jsonld.liquid" as const;
export const ROBOTS_TEMPLATE_ASSET_KEY =
  "templates/robots.txt.liquid" as const;

type AllowedThemeAssetKey =
  | typeof HOME_SCHEMA_ASSET_KEY
  | typeof ROBOTS_TEMPLATE_ASSET_KEY;

export type ThemeAssetObservation<
  TKey extends AllowedThemeAssetKey = typeof HOME_SCHEMA_ASSET_KEY,
> = {
  themeId: string;
  themeRole: "main";
  assetKey: TKey;
  value: string;
  sha256: string;
};

const READ_BACK_ATTEMPTS = 5;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function discoverMainThemeId(): Promise<string> {
  const data = await shopifyFetch<{
    themes: { nodes: Array<{ id: string; role: string }> };
  }>(`
    query PublishedMainThemes {
      themes(first: 50) {
        nodes {
          id
          role
        }
      }
    }
  `);
  const main = data.themes.nodes.filter((theme) =>
    theme.role.toUpperCase() === "MAIN");
  if (main.length !== 1) {
    throw new Error("Shopify must expose exactly one published main theme");
  }
  return main[0]!.id;
}

async function readThemeAsset<TKey extends AllowedThemeAssetKey>(
  themeId: string,
  assetKey: TKey,
): Promise<ThemeAssetObservation<TKey>> {
  const data = await shopifyFetch<{
    theme: {
      files: {
        nodes: Array<{
          filename: string;
          body:
            | { content: string }
            | { contentBase64: string }
            | { url: string };
        }>;
        userErrors: Array<{ code: string; filename: string | null }>;
      };
    } | null;
  }>(`
    query ExactAllowedThemeAsset($themeId: ID!, $filenames: [String!]!) {
      theme(id: $themeId) {
        files(filenames: $filenames) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
          userErrors {
            code
            filename
          }
        }
      }
    }
  `, { themeId, filenames: [assetKey] });

  if (!data.theme || data.theme.files.userErrors.length > 0) {
    throw new Error("Shopify theme asset could not be read");
  }
  const files = data.theme.files.nodes.filter((file) =>
    file.filename === assetKey);
  if (files.length !== 1 || !("content" in files[0]!.body)) {
    throw new Error("Shopify theme asset was missing or was not text");
  }
  const value = files[0]!.body.content;
  return {
    themeId,
    themeRole: "main",
    assetKey,
    value,
    sha256: hash(value),
  };
}

export async function fetchMainThemeSchemaAsset(): Promise<ThemeAssetObservation> {
  return readThemeAsset(await discoverMainThemeId(), HOME_SCHEMA_ASSET_KEY);
}

export async function fetchMainThemeRobotsAsset(): Promise<
  ThemeAssetObservation<typeof ROBOTS_TEMPLATE_ASSET_KEY>
> {
  return readThemeAsset(await discoverMainThemeId(), ROBOTS_TEMPLATE_ASSET_KEY);
}

async function updateMainThemeAsset<TKey extends AllowedThemeAssetKey>(input: {
  themeId: string;
  assetKey: TKey;
  value: string;
}): Promise<ThemeAssetObservation<TKey>> {
  const mainThemeId = await discoverMainThemeId();
  if (input.themeId !== mainThemeId) {
    throw new Error("Approved Shopify theme is no longer the published main theme");
  }

  const data = await shopifyFetch<{
    themeFilesUpsert: {
      upsertedThemeFiles: Array<{ filename: string }>;
      job: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(`
    mutation UpdateExactAllowedThemeAsset(
      $files: [OnlineStoreThemeFilesUpsertFileInput!]!
      $themeId: ID!
    ) {
      themeFilesUpsert(files: $files, themeId: $themeId) {
        upsertedThemeFiles {
          filename
        }
        job {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `, {
    themeId: input.themeId,
    files: [{
      filename: input.assetKey,
      body: { type: "TEXT", value: input.value },
    }],
  });

  if (data.themeFilesUpsert.userErrors.length > 0
    || !data.themeFilesUpsert.upsertedThemeFiles.some(
      (file) => file.filename === input.assetKey,
    )) {
    throw new Error("Shopify theme asset update was rejected");
  }

  const approvedHash = hash(input.value);
  for (let attempt = 0; attempt < READ_BACK_ATTEMPTS; attempt++) {
    const observation = await readThemeAsset(input.themeId, input.assetKey);
    if (observation.sha256 === approvedHash && observation.value === input.value) {
      return observation;
    }
    if (attempt < READ_BACK_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
  throw new Error("Shopify theme asset read-back did not match the approved hash");
}

export async function updateMainThemeSchemaAsset(input: {
  themeId: string;
  assetKey: typeof HOME_SCHEMA_ASSET_KEY;
  value: string;
}): Promise<ThemeAssetObservation> {
  if (input.assetKey !== HOME_SCHEMA_ASSET_KEY) {
    throw new Error("Shopify theme asset key is not allowed");
  }
  return updateMainThemeAsset(input);
}

export async function updateMainThemeRobotsAsset(input: {
  themeId: string;
  assetKey: typeof ROBOTS_TEMPLATE_ASSET_KEY;
  value: string;
}): Promise<ThemeAssetObservation<typeof ROBOTS_TEMPLATE_ASSET_KEY>> {
  if (input.assetKey !== ROBOTS_TEMPLATE_ASSET_KEY) {
    throw new Error("Shopify theme asset key is not allowed");
  }
  return updateMainThemeAsset(input);
}
