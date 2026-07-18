import { existsSync } from "node:fs";

const configuredRoot = process.env.TOPICAL_MAP_STRATEGY_ROOT?.trim();

export const topicalMapStrategyRoot =
  configuredRoot || "/home/sean/Agriko/shopify-theme/docs/seo";

export const hasTopicalMapStrategyPackage =
  Boolean(configuredRoot) || existsSync(topicalMapStrategyRoot);
