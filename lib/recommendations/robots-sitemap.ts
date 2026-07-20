import { createHash } from "node:crypto";
import type { Recommendation } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  fetchMainThemeRobotsAsset,
  ROBOTS_TEMPLATE_ASSET_KEY,
  updateMainThemeRobotsAsset,
} from "@/lib/shopify-theme-assets";

export const CANONICAL_SITEMAP_URL =
  "https://agrikoph.com/sitemap.xml" as const;

const DYNAMIC_SITEMAP_DIRECTIVE =
  "Sitemap: {{ shop.url }}/sitemap.xml";
const ABSOLUTE_SITEMAP_DIRECTIVE =
  `Sitemap: ${CANONICAL_SITEMAP_URL}`;

const ApprovedRobotsSitemap = z.object({
  themeId: z.string().startsWith("gid://shopify/OnlineStoreTheme/").max(100),
  assetKey: z.literal(ROBOTS_TEMPLATE_ASSET_KEY),
  beforeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  afterSha256: z.string().regex(/^[a-f0-9]{64}$/),
  afterValue: z.string().min(1).max(100_000),
}).strict();

type Db = typeof prisma;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

export function fixRobotsSitemapUrl(value: string): string {
  if (occurrences(value, DYNAMIC_SITEMAP_DIRECTIVE) !== 1) {
    throw new Error("Expected exactly one approved dynamic sitemap directive");
  }
  if (occurrences(value, ABSOLUTE_SITEMAP_DIRECTIVE) !== 0) {
    throw new Error("Expected exactly one sitemap transformation source");
  }
  const result = value.replace(
    DYNAMIC_SITEMAP_DIRECTIVE,
    ABSOLUTE_SITEMAP_DIRECTIVE,
  );
  if (occurrences(result, ABSOLUTE_SITEMAP_DIRECTIVE) !== 1
    || result.includes(DYNAMIC_SITEMAP_DIRECTIVE)) {
    throw new Error("Robots sitemap transformation did not reach the approved shape");
  }
  return result;
}

export async function queueRobotsSitemapRecommendation(
  db: Db,
  input: { actor: string },
): Promise<{ recommendationId: string; created: boolean }> {
  const current = await fetchMainThemeRobotsAsset();
  const afterValue = fixRobotsSitemapUrl(current.value);
  const proposed = ApprovedRobotsSitemap.parse({
    themeId: current.themeId,
    assetKey: current.assetKey,
    beforeSha256: current.sha256,
    afterSha256: hash(afterValue),
    afterValue,
  });
  const proposedValue = JSON.stringify(proposed);
  const targetEntityId = `${current.themeId}:${current.assetKey}`;
  const snapshot = await db.rawSnapshot.findFirst({
    where: { source: "gsc" },
    orderBy: { fetchedAt: "desc" },
    select: { id: true },
  });
  if (!snapshot) throw new Error("No GSC evidence snapshot is available");

  const existing = await db.recommendation.findFirst({
    where: {
      platform: "shopify",
      actionType: "fix_robots_sitemap_url",
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
      skillId: "gsc-robots-sitemap",
      skillName: "GSC robots sitemap remediation",
      actionType: "fix_robots_sitemap_url",
      targetEntityType: "theme_asset",
      targetEntityId,
      targetEntityName: current.assetKey,
      currentValue: current.sha256,
      proposedValue,
      rationale:
        "Resolve GSC-08 by replacing the relative rendered sitemap directive with the absolute canonical sitemap URL.",
      guardStatus: "clear",
      status: "pending",
      snapshotId: snapshot.id,
    },
  });
  await db.auditLog.create({
    data: {
      actor: input.actor,
      action: "robots_sitemap_recommendation_queued",
      entityType: "theme_asset",
      entityId: targetEntityId,
      before: { sha256: current.sha256 },
      after: {
        sha256: proposed.afterSha256,
        recommendationId: recommendation.id,
      },
    },
  });
  return { recommendationId: recommendation.id, created: true };
}

export async function applyApprovedRobotsSitemapRecommendation(
  recommendation: Recommendation,
): Promise<Record<string, unknown>> {
  if (recommendation.platform !== "shopify"
    || recommendation.actionType !== "fix_robots_sitemap_url"
    || recommendation.status !== "executing") {
    throw new Error("Robots sitemap recommendation must be executing");
  }
  if (process.env.EXECUTE_APPROVED_LIVE_ENABLED !== "true") {
    throw new Error("Live Shopify execution is disabled");
  }

  let proposed: z.infer<typeof ApprovedRobotsSitemap>;
  try {
    proposed = ApprovedRobotsSitemap.parse(
      JSON.parse(recommendation.proposedValue ?? "null"),
    );
  } catch {
    throw new Error("Approved robots sitemap payload is invalid");
  }
  if (`${proposed.themeId}:${proposed.assetKey}` !== recommendation.targetEntityId
    || hash(proposed.afterValue) !== proposed.afterSha256) {
    throw new Error("Approved robots sitemap identity is invalid");
  }

  const current = await fetchMainThemeRobotsAsset();
  if (current.themeId !== proposed.themeId
    || current.assetKey !== proposed.assetKey) {
    throw new Error("Published Shopify theme identity changed after approval");
  }
  if (current.sha256 === proposed.afterSha256
    && current.value === proposed.afterValue) {
    return {
      themeId: current.themeId,
      assetKey: current.assetKey,
      beforeSha256: proposed.beforeSha256,
      afterSha256: proposed.afterSha256,
      alreadyApplied: true,
      verifiedAt: new Date().toISOString(),
    };
  }
  if (current.sha256 !== proposed.beforeSha256) {
    throw new Error("Shopify theme asset changed after approval");
  }
  const derivedAfter = fixRobotsSitemapUrl(current.value);
  if (derivedAfter !== proposed.afterValue
    || hash(derivedAfter) !== proposed.afterSha256) {
    throw new Error("Approved robots sitemap transformation is invalid");
  }

  const updated = await updateMainThemeRobotsAsset({
    themeId: proposed.themeId,
    assetKey: proposed.assetKey,
    value: proposed.afterValue,
  });
  if (updated.sha256 !== proposed.afterSha256
    || updated.value !== proposed.afterValue) {
    throw new Error("Shopify theme asset read-back hash did not match approval");
  }
  return {
    themeId: updated.themeId,
    assetKey: updated.assetKey,
    beforeSha256: proposed.beforeSha256,
    afterSha256: proposed.afterSha256,
    alreadyApplied: false,
    verifiedAt: new Date().toISOString(),
  };
}
