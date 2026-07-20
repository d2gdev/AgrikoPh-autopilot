import { createHash } from "node:crypto";
import type { Recommendation } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  duplicateShopifyTheme,
  fetchShopifyThemes,
  publishShopifyTheme,
  type ShopifyThemeIdentity,
  waitForShopifyThemeReady,
} from "@/lib/shopify-theme-cache";
import {
  fetchThemeSourceAssets,
  THEME_SOURCE_SYNC_ASSET_KEYS,
  type ThemeAssetObservation,
  type ThemeSourceSyncAssetKey,
} from "@/lib/shopify-theme-assets";

const DuplicateName = z.string().regex(
  /^autopilot-cache-flush-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/,
);
const ApprovedAsset = z.object({
  assetKey: z.enum(THEME_SOURCE_SYNC_ASSET_KEYS),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const ApprovedThemeCacheFlush = z.object({
  sourceThemeId: z.string()
    .regex(/^gid:\/\/shopify\/OnlineStoreTheme\/\d+$/)
    .max(100),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  duplicateName: DuplicateName,
  assets: z.array(ApprovedAsset).length(THEME_SOURCE_SYNC_ASSET_KEYS.length),
}).strict().superRefine((value, ctx) => {
  value.assets.forEach((asset, index) => {
    if (asset.assetKey !== THEME_SOURCE_SYNC_ASSET_KEYS[index]) {
      ctx.addIssue({
        code: "custom",
        path: ["assets", index, "assetKey"],
        message: "Theme cache-flush assets must use the exact approved order",
      });
    }
  });
});

type Db = typeof prisma;
type SourceValues = Record<ThemeSourceSyncAssetKey, string>;
type ApprovedPayload = z.infer<typeof ApprovedThemeCacheFlush>;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactlyOneMain(themes: ShopifyThemeIdentity[]): ShopifyThemeIdentity {
  const main = themes.filter((theme) => theme.role === "MAIN");
  if (main.length !== 1) {
    throw new Error("Shopify must expose exactly one published main theme");
  }
  return main[0]!;
}

function expectedHashes(payload: ApprovedPayload): Record<string, string> {
  return Object.fromEntries(
    payload.assets.map((asset) => [asset.assetKey, asset.sha256]),
  );
}

function observationsMatch(
  observations: Array<ThemeAssetObservation<ThemeSourceSyncAssetKey>>,
  payload: ApprovedPayload,
): boolean {
  if (observations.length !== payload.assets.length) return false;
  const byKey = new Map(
    observations.map((asset) => [asset.assetKey, asset.sha256]),
  );
  return payload.assets.every(
    (asset) => byKey.get(asset.assetKey) === asset.sha256,
  );
}

function receipt(input: {
  payload: ApprovedPayload;
  publishedThemeId: string;
  alreadyApplied: boolean;
}): Record<string, unknown> {
  return {
    sourceThemeId: input.payload.sourceThemeId,
    publishedThemeId: input.publishedThemeId,
    duplicateName: input.payload.duplicateName,
    sourceCommit: input.payload.sourceCommit,
    hashes: expectedHashes(input.payload),
    alreadyApplied: input.alreadyApplied,
    verifiedAt: new Date().toISOString(),
  };
}

export async function queueThemeCacheFlushRecommendation(
  db: Db,
  input: {
    actor: string;
    sourceCommit: string;
    sourceValues: SourceValues;
    duplicateName: string;
  },
): Promise<{ recommendationId: string; created: boolean }> {
  for (const assetKey of THEME_SOURCE_SYNC_ASSET_KEYS) {
    if (typeof input.sourceValues[assetKey] !== "string"
      || input.sourceValues[assetKey].length === 0) {
      throw new Error("Git theme source asset was missing");
    }
  }
  const main = exactlyOneMain(await fetchShopifyThemes());
  const current = await fetchThemeSourceAssets(main.id);
  const proposed = ApprovedThemeCacheFlush.parse({
    sourceThemeId: main.id,
    sourceCommit: input.sourceCommit,
    duplicateName: input.duplicateName,
    assets: THEME_SOURCE_SYNC_ASSET_KEYS.map((assetKey) => ({
      assetKey,
      sha256: hash(input.sourceValues[assetKey]),
    })),
  });
  if (!observationsMatch(current, proposed)) {
    throw new Error("Published Shopify theme does not match the Git source commit");
  }

  const targetEntityId =
    `${proposed.sourceThemeId}:cache-flush:${proposed.sourceCommit}:`
    + proposed.duplicateName;
  const snapshot = await db.rawSnapshot.findFirst({
    where: { source: "gsc" },
    orderBy: { fetchedAt: "desc" },
    select: { id: true },
  });
  if (!snapshot) throw new Error("No GSC evidence snapshot is available");

  const proposedValue = JSON.stringify(proposed);
  const existing = await db.recommendation.findFirst({
    where: {
      platform: "shopify",
      actionType: "flush_shopify_theme_page_cache",
      targetEntityId,
      proposedValue,
      status: { in: ["pending", "approved", "override_approved", "executing"] },
    },
    select: { id: true },
  });
  if (existing) return { recommendationId: existing.id, created: false };

  const recommendation = await db.recommendation.create({
    data: {
      platform: "shopify",
      skillId: "theme-cache-flush",
      skillName: "Shopify rendered page-cache reconciliation",
      actionType: "flush_shopify_theme_page_cache",
      targetEntityType: "published_theme",
      targetEntityId,
      targetEntityName: proposed.duplicateName,
      currentValue: JSON.stringify({
        themeId: proposed.sourceThemeId,
        hashes: expectedHashes(proposed),
      }),
      proposedValue,
      rationale:
        "Replace Shopify's stale rendered page cache by publishing a hash-verified duplicate of the approved main theme.",
      guardStatus: "clear",
      status: "pending",
      snapshotId: snapshot.id,
    },
  });
  await db.auditLog.create({
    data: {
      actor: input.actor,
      action: "theme_cache_flush_recommendation_queued",
      entityType: "recommendation",
      entityId: recommendation.id,
      before: {
        sourceThemeId: proposed.sourceThemeId,
        hashes: expectedHashes(proposed),
      },
      after: {
        sourceCommit: proposed.sourceCommit,
        duplicateName: proposed.duplicateName,
        recommendationId: recommendation.id,
      },
    },
  });
  return { recommendationId: recommendation.id, created: true };
}

export async function applyApprovedThemeCacheFlushRecommendation(
  recommendation: Recommendation,
): Promise<Record<string, unknown>> {
  if (recommendation.platform !== "shopify"
    || recommendation.actionType !== "flush_shopify_theme_page_cache"
    || recommendation.status !== "executing") {
    throw new Error("Theme cache-flush recommendation must be executing");
  }
  if (process.env.EXECUTE_APPROVED_LIVE_ENABLED !== "true") {
    throw new Error("Live Shopify execution is disabled");
  }

  let payload: ApprovedPayload;
  try {
    payload = ApprovedThemeCacheFlush.parse(
      JSON.parse(recommendation.proposedValue ?? "null"),
    );
  } catch {
    throw new Error("Approved theme cache-flush payload is invalid");
  }
  const targetEntityId =
    `${payload.sourceThemeId}:cache-flush:${payload.sourceCommit}:`
    + payload.duplicateName;
  if (targetEntityId !== recommendation.targetEntityId) {
    throw new Error("Approved theme cache-flush identity is invalid");
  }

  const initialThemes = await fetchShopifyThemes();
  const initialMain = exactlyOneMain(initialThemes);
  if (initialMain.name === payload.duplicateName) {
    if (initialMain.id === payload.sourceThemeId
      || !observationsMatch(
        await fetchThemeSourceAssets(initialMain.id),
        payload,
      )) {
      throw new Error("Published Shopify cache-flush theme hash was invalid");
    }
    return receipt({
      payload,
      publishedThemeId: initialMain.id,
      alreadyApplied: true,
    });
  }
  if (initialMain.id !== payload.sourceThemeId) {
    throw new Error("Published Shopify theme changed after approval");
  }
  if (!observationsMatch(
    await fetchThemeSourceAssets(payload.sourceThemeId),
    payload,
  )) {
    throw new Error("Shopify theme source changed after approval");
  }

  const matchingDuplicates = initialThemes.filter(
    (theme) =>
      theme.id !== payload.sourceThemeId
      && theme.name === payload.duplicateName,
  );
  if (matchingDuplicates.length > 1) {
    throw new Error("Multiple Shopify cache-flush theme duplicates exist");
  }
  let duplicate = matchingDuplicates[0];
  if (!duplicate) {
    duplicate = await duplicateShopifyTheme({
      sourceThemeId: payload.sourceThemeId,
      name: payload.duplicateName,
    });
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "theme_cache_flush_duplicate_created",
        entityType: "recommendation",
        entityId: recommendation.id,
        after: {
          sourceThemeId: payload.sourceThemeId,
          duplicateThemeId: duplicate.id,
          duplicateName: payload.duplicateName,
        },
      },
    });
  }
  if (duplicate.name !== payload.duplicateName || duplicate.role === "MAIN") {
    throw new Error("Shopify cache-flush duplicate identity was invalid");
  }
  duplicate = await waitForShopifyThemeReady(duplicate.id);
  if (duplicate.name !== payload.duplicateName || duplicate.role === "MAIN") {
    throw new Error("Shopify cache-flush duplicate state was invalid");
  }
  if (!observationsMatch(
    await fetchThemeSourceAssets(duplicate.id),
    payload,
  )) {
    throw new Error("Shopify cache-flush duplicate asset hash did not match approval");
  }

  await publishShopifyTheme(duplicate.id);
  const finalMain = exactlyOneMain(await fetchShopifyThemes());
  if (finalMain.id !== duplicate.id
    || finalMain.name !== payload.duplicateName
    || !observationsMatch(
      await fetchThemeSourceAssets(finalMain.id),
      payload,
    )) {
    throw new Error("Shopify published cache-flush theme verification failed");
  }
  return receipt({
    payload,
    publishedThemeId: finalMain.id,
    alreadyApplied: false,
  });
}
