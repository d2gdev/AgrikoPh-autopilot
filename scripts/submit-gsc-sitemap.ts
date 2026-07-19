import "dotenv/config";
import { pathToFileURL } from "node:url";
import {
  listGscSitemaps,
  submitGscSitemap,
} from "@/lib/connectors/gsc";

const DEFAULT_SITEMAP_URL = "https://agrikoph.com/sitemap.xml";

export function parseSubmitGscSitemapArguments(args: string[]): {
  apply: boolean;
  sitemapUrl: string;
} {
  let apply = false;
  let sitemapUrl = DEFAULT_SITEMAP_URL;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--apply") apply = true;
    else if (argument === "--sitemap") {
      const value = args[index + 1];
      if (!value) throw new Error("--sitemap requires a URL");
      sitemapUrl = value;
      index += 1;
    } else {
      throw new Error(`Unknown flag: ${argument}`);
    }
  }
  return { apply, sitemapUrl };
}

export async function runSubmitGscSitemap(input: {
  apply: boolean;
  sitemapUrl: string;
}) {
  if (!input.apply) {
    return {
      dryRun: true,
      sitemapUrl: input.sitemapUrl,
      submitted: false,
      writeCount: 0,
    };
  }
  const submitted = await submitGscSitemap(input.sitemapUrl);
  const sitemaps = await listGscSitemaps();
  const readBack = sitemaps.find((sitemap) =>
    sitemap.path === input.sitemapUrl);
  if (!readBack) {
    throw new Error("Submitted GSC sitemap was absent from API read-back");
  }
  return {
    dryRun: false,
    ...submitted,
    readBack: {
      path: readBack.path,
      isPending: readBack.isPending ?? null,
      lastSubmitted: readBack.lastSubmitted ?? null,
    },
    writeCount: 1,
  };
}

async function main() {
  const result = await runSubmitGscSitemap(
    parseSubmitGscSitemapArguments(process.argv.slice(2)),
  );
  console.log(JSON.stringify(result, null, 2));
}

const invokedAsScript =
  Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
