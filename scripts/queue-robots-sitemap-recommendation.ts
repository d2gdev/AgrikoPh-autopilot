import "dotenv/config";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { prisma } from "@/lib/db";
import {
  fixRobotsSitemapUrl,
  queueRobotsSitemapRecommendation,
} from "@/lib/recommendations/robots-sitemap";
import { fetchMainThemeRobotsAsset } from "@/lib/shopify-theme-assets";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseQueueRobotsSitemapArguments(args: string[]): {
  apply: boolean;
} {
  let apply = false;
  for (const argument of args) {
    if (argument === "--apply") apply = true;
    else throw new Error(`Unknown flag: ${argument}`);
  }
  return { apply };
}

export async function runQueueRobotsSitemapRecommendation(input: {
  apply: boolean;
  actor?: string;
}) {
  if (input.apply) {
    return {
      mode: "apply" as const,
      ...(await queueRobotsSitemapRecommendation(prisma, {
        actor: input.actor ?? "script:gsc-robots-sitemap",
      })),
    };
  }

  const current = await fetchMainThemeRobotsAsset();
  const afterValue = fixRobotsSitemapUrl(current.value);
  return {
    mode: "dry-run" as const,
    themeId: current.themeId,
    assetKey: current.assetKey,
    beforeSha256: current.sha256,
    afterSha256: hash(afterValue),
    recommendationCreated: false,
    liveMutationSent: false,
  };
}

async function main() {
  const result = await runQueueRobotsSitemapRecommendation(
    parseQueueRobotsSitemapArguments(process.argv.slice(2)),
  );
  console.log(JSON.stringify(result, null, 2));
}

const invokedAsScript =
  Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (invokedAsScript) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
