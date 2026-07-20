import { createHash } from "node:crypto";
import type { Recommendation } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  fetchMainThemeSourceAssets,
  THEME_SOURCE_SYNC_ASSET_KEYS,
  type ThemeSourceSyncAssetKey,
  updateMainThemeSourceAssets,
} from "@/lib/shopify-theme-assets";

const ApprovedAsset = z.object({
  assetKey: z.enum(THEME_SOURCE_SYNC_ASSET_KEYS),
  beforeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  afterSha256: z.string().regex(/^[a-f0-9]{64}$/),
  afterValue: z.string().min(1).max(500_000),
}).strict();

const ApprovedThemeSourceSync = z.object({
  themeId: z.string().startsWith("gid://shopify/OnlineStoreTheme/").max(100),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  assets: z.array(ApprovedAsset).length(THEME_SOURCE_SYNC_ASSET_KEYS.length),
}).strict().superRefine((value, ctx) => {
  value.assets.forEach((asset, index) => {
    if (asset.assetKey !== THEME_SOURCE_SYNC_ASSET_KEYS[index]) {
      ctx.addIssue({
        code: "custom",
        path: ["assets", index, "assetKey"],
        message: "Theme source assets must use the exact approved order",
      });
    }
  });
});

type Db = typeof prisma;
type SourceValues = Record<ThemeSourceSyncAssetKey, string>;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function queueThemeSourceSyncRecommendation(
  db: Db,
  input: {
    actor: string;
    sourceCommit: string;
    sourceValues: SourceValues;
  },
): Promise<{ recommendationId: string; created: boolean }> {
  const current = await fetchMainThemeSourceAssets();
  const proposed = ApprovedThemeSourceSync.parse({
    themeId: current[0]?.themeId,
    sourceCommit: input.sourceCommit,
    assets: current.map((asset) => ({
      assetKey: asset.assetKey,
      beforeSha256: asset.sha256,
      afterSha256: hash(input.sourceValues[asset.assetKey]),
      afterValue: input.sourceValues[asset.assetKey],
    })),
  });
  const proposedValue = JSON.stringify(proposed);
  const targetEntityId =
    `${proposed.themeId}:source-sync:${proposed.sourceCommit}`;
  const snapshot = await db.rawSnapshot.findFirst({
    where: { source: "gsc" },
    orderBy: { fetchedAt: "desc" },
    select: { id: true },
  });
  if (!snapshot) throw new Error("No GSC evidence snapshot is available");

  const existing = await db.recommendation.findFirst({
    where: {
      platform: "shopify",
      actionType: "sync_theme_source_assets",
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
      skillId: "theme-source-sync",
      skillName: "Published theme source reconciliation",
      actionType: "sync_theme_source_assets",
      targetEntityType: "theme_asset_set",
      targetEntityId,
      targetEntityName: THEME_SOURCE_SYNC_ASSET_KEYS.join(", "),
      currentValue: JSON.stringify(Object.fromEntries(
        proposed.assets.map((asset) => [asset.assetKey, asset.beforeSha256]),
      )),
      proposedValue,
      rationale:
        "Resolve verified Git-to-Shopify drift by promoting the exact tested theme source commit.",
      guardStatus: "clear",
      status: "pending",
      snapshotId: snapshot.id,
    },
  });
  await db.auditLog.create({
    data: {
      actor: input.actor,
      action: "theme_source_sync_recommendation_queued",
      entityType: "theme_asset_set",
      entityId: targetEntityId,
      before: Object.fromEntries(
        proposed.assets.map((asset) => [asset.assetKey, asset.beforeSha256]),
      ),
      after: {
        sourceCommit: proposed.sourceCommit,
        hashes: Object.fromEntries(
          proposed.assets.map((asset) => [asset.assetKey, asset.afterSha256]),
        ),
        recommendationId: recommendation.id,
      },
    },
  });
  return { recommendationId: recommendation.id, created: true };
}

export async function applyApprovedThemeSourceSyncRecommendation(
  recommendation: Recommendation,
): Promise<Record<string, unknown>> {
  if (recommendation.platform !== "shopify"
    || recommendation.actionType !== "sync_theme_source_assets"
    || recommendation.status !== "executing") {
    throw new Error("Theme source sync recommendation must be executing");
  }
  if (process.env.EXECUTE_APPROVED_LIVE_ENABLED !== "true") {
    throw new Error("Live Shopify execution is disabled");
  }

  let proposed: z.infer<typeof ApprovedThemeSourceSync>;
  try {
    proposed = ApprovedThemeSourceSync.parse(
      JSON.parse(recommendation.proposedValue ?? "null"),
    );
  } catch {
    throw new Error("Approved theme source sync payload is invalid");
  }
  if (`${proposed.themeId}:source-sync:${proposed.sourceCommit}`
      !== recommendation.targetEntityId
    || proposed.assets.some((asset) =>
      hash(asset.afterValue) !== asset.afterSha256)) {
    throw new Error("Approved theme source sync identity is invalid");
  }

  const current = await fetchMainThemeSourceAssets();
  if (current.some((asset) => asset.themeId !== proposed.themeId)) {
    throw new Error("Published Shopify theme identity changed after approval");
  }
  const currentByKey = new Map(
    current.map((asset) => [asset.assetKey, asset]),
  );
  const allApplied = proposed.assets.every((asset) => {
    const observed = currentByKey.get(asset.assetKey);
    return observed?.sha256 === asset.afterSha256
      && observed.value === asset.afterValue;
  });
  if (allApplied) {
    return {
      themeId: proposed.themeId,
      sourceCommit: proposed.sourceCommit,
      assetCount: proposed.assets.length,
      alreadyApplied: true,
      hashes: Object.fromEntries(
        proposed.assets.map((asset) => [asset.assetKey, asset.afterSha256]),
      ),
      verifiedAt: new Date().toISOString(),
    };
  }
  for (const asset of proposed.assets) {
    const observed = currentByKey.get(asset.assetKey);
    const isBefore = observed?.sha256 === asset.beforeSha256;
    const isAfter = observed?.sha256 === asset.afterSha256
      && observed.value === asset.afterValue;
    if (!isBefore && !isAfter) {
      throw new Error("Shopify theme source asset changed after approval");
    }
  }

  const updated = await updateMainThemeSourceAssets({
    themeId: proposed.themeId,
    assets: proposed.assets.map((asset) => ({
      assetKey: asset.assetKey,
      value: asset.afterValue,
    })),
  });
  const updatedByKey = new Map(
    updated.map((asset) => [asset.assetKey, asset]),
  );
  if (proposed.assets.some((asset) => {
    const observed = updatedByKey.get(asset.assetKey);
    return observed?.sha256 !== asset.afterSha256
      || observed.value !== asset.afterValue;
  })) {
    throw new Error("Theme source asset read-back hash did not match approval");
  }
  return {
    themeId: proposed.themeId,
    sourceCommit: proposed.sourceCommit,
    assetCount: proposed.assets.length,
    alreadyApplied: false,
    hashes: Object.fromEntries(
      proposed.assets.map((asset) => [asset.assetKey, asset.afterSha256]),
    ),
    verifiedAt: new Date().toISOString(),
  };
}
