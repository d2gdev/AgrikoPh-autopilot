import { createHash } from "node:crypto";
import { shopifyFetch } from "@/lib/shopify-admin";

export const HOME_SCHEMA_ASSET_KEY =
  "snippets/schema-global-jsonld.liquid" as const;
export const ROBOTS_TEMPLATE_ASSET_KEY =
  "templates/robots.txt.liquid" as const;
export const MAIN_ARTICLE_ASSET_KEY =
  "sections/main-article.liquid" as const;
export const MAIN_HOME_ASSET_KEY =
  "sections/main-home.liquid" as const;
export const ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY =
  "snippets/article-types-of-organic-rice.liquid" as const;
export const THEME_SOURCE_SYNC_ASSET_KEYS = [
  MAIN_ARTICLE_ASSET_KEY,
  MAIN_HOME_ASSET_KEY,
  ROBOTS_TEMPLATE_ASSET_KEY,
  ARTICLE_TYPES_OF_ORGANIC_RICE_ASSET_KEY,
] as const;

export type ThemeSourceSyncAssetKey =
  typeof THEME_SOURCE_SYNC_ASSET_KEYS[number];

type AllowedThemeAssetKey =
  | typeof HOME_SCHEMA_ASSET_KEY
  | ThemeSourceSyncAssetKey;

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
const JOB_POLL_ATTEMPTS = 10;

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

async function readThemeAssets<TKey extends AllowedThemeAssetKey>(
  themeId: string,
  assetKeys: readonly TKey[],
): Promise<Array<ThemeAssetObservation<TKey>>> {
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
  `, { themeId, filenames: assetKeys });

  if (!data.theme || data.theme.files.userErrors.length > 0) {
    throw new Error("Shopify theme asset could not be read");
  }
  return assetKeys.map((assetKey) => {
    const files = data.theme!.files.nodes.filter((file) =>
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
  });
}

async function readThemeAsset<TKey extends AllowedThemeAssetKey>(
  themeId: string,
  assetKey: TKey,
): Promise<ThemeAssetObservation<TKey>> {
  return (await readThemeAssets(themeId, [assetKey]))[0]!;
}

async function waitForThemeFileWriteJob(jobId: string | null): Promise<void> {
  if (!jobId) return;
  for (let attempt = 0; attempt < JOB_POLL_ATTEMPTS; attempt++) {
    const data: {
      job: { id: string; done: boolean } | null;
    } = await shopifyFetch<{
      job: { id: string; done: boolean } | null;
    }>(`
      query ThemeFileWriteJob($jobId: ID!) {
        job(id: $jobId) {
          id
          done
        }
      }
    `, { jobId });
    if (!data.job || data.job.id !== jobId) {
      throw new Error("Shopify theme file write job could not be read");
    }
    if (data.job.done) return;
    if (attempt < JOB_POLL_ATTEMPTS - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1_000, 100 * 2 ** attempt)));
    }
  }
  throw new Error("Shopify theme file write job did not complete");
}

export async function fetchMainThemeSchemaAsset(): Promise<ThemeAssetObservation> {
  return readThemeAsset(await discoverMainThemeId(), HOME_SCHEMA_ASSET_KEY);
}

export async function fetchMainThemeRobotsAsset(): Promise<
  ThemeAssetObservation<typeof ROBOTS_TEMPLATE_ASSET_KEY>
> {
  return readThemeAsset(await discoverMainThemeId(), ROBOTS_TEMPLATE_ASSET_KEY);
}

export async function fetchMainThemeSourceAssets(): Promise<
  Array<ThemeAssetObservation<ThemeSourceSyncAssetKey>>
> {
  return fetchThemeSourceAssets(await discoverMainThemeId());
}

export async function fetchThemeSourceAssets(
  themeId: string,
): Promise<Array<ThemeAssetObservation<ThemeSourceSyncAssetKey>>> {
  return readThemeAssets(themeId, THEME_SOURCE_SYNC_ASSET_KEYS);
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
  await waitForThemeFileWriteJob(data.themeFilesUpsert.job?.id ?? null);

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

export async function updateMainThemeSourceAssets(input: {
  themeId: string;
  assets: Array<{ assetKey: ThemeSourceSyncAssetKey; value: string }>;
}): Promise<Array<ThemeAssetObservation<ThemeSourceSyncAssetKey>>> {
  const keys = input.assets.map((asset) => asset.assetKey);
  if (keys.length !== THEME_SOURCE_SYNC_ASSET_KEYS.length
    || keys.some((key, index) => key !== THEME_SOURCE_SYNC_ASSET_KEYS[index])) {
    throw new Error("Theme source sync asset set is not allowed");
  }
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
    mutation UpdateExactThemeSourceAssets(
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
    files: input.assets.map((asset) => ({
      filename: asset.assetKey,
      body: { type: "TEXT", value: asset.value },
    })),
  });

  const upserted = new Set(
    data.themeFilesUpsert.upsertedThemeFiles.map((file) => file.filename),
  );
  if (data.themeFilesUpsert.userErrors.length > 0
    || THEME_SOURCE_SYNC_ASSET_KEYS.some((key) => !upserted.has(key))) {
    throw new Error("Shopify theme source asset update was rejected");
  }
  await waitForThemeFileWriteJob(data.themeFilesUpsert.job?.id ?? null);

  const expected = new Map(
    input.assets.map((asset) => [asset.assetKey, hash(asset.value)]),
  );
  for (let attempt = 0; attempt < READ_BACK_ATTEMPTS; attempt++) {
    const observations = await readThemeAssets(
      input.themeId,
      THEME_SOURCE_SYNC_ASSET_KEYS,
    );
    if (observations.every((asset) =>
      asset.sha256 === expected.get(asset.assetKey))) {
      return observations;
    }
    if (attempt < READ_BACK_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
  throw new Error("Shopify theme source asset read-back did not match approved hashes");
}
