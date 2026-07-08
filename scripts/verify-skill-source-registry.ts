import path from "path";
import dotenv from "dotenv";
import type { SkillDataSource } from "@/lib/skills/loader";

const ORGANIC_SOURCES: SkillDataSource[] = [
  "gsc",
  "gsc_query_page",
  "ga4",
  "blog",
  "market_intel",
  "keyword_research",
  "dataforseo_ranked",
  "shopify_catalog",
  "shopify_orders",
];

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  dotenv.config({ path: envPath, override: false });
  if (!process.env.DATABASE_URL && process.env.DATABASE_URL_PROD) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
  }
}

function formatDate(value: Date | null | undefined): string {
  return value ? value.toISOString() : "-";
}

async function main(): Promise<void> {
  loadEnv();

  const { resolveDatabaseUrl } = await import("@/lib/db-url");
  const { url, source } = resolveDatabaseUrl();
  if (!url || !source) {
    throw new Error("No configured database URL found in DATABASE_URL or DATABASE_URL_PROD.");
  }

  const { prisma } = await import("@/lib/db");
  const { checkSourceStatus, selectBaseSnapshotForSource } = await import("@/lib/skills/source-registry");

  let hadUsableSource = false;

  try {
    console.log(`Database URL source: ${source}`);
    console.log("Verifying source registry against persisted PostgreSQL data");

    for (const sourceName of ORGANIC_SOURCES) {
      const status = await checkSourceStatus(sourceName);
      const baseSnapshot = await selectBaseSnapshotForSource(sourceName);
      if (status.state !== "missing" && status.state !== "error") {
        hadUsableSource = true;
      }

      console.log(
        [
          `source=${sourceName}`,
          `status=${status.state}`,
          `latestAt=${formatDate(status.latestAt)}`,
          `evidenceId=${status.evidenceId ?? "-"}`,
          `rowCount=${status.rowCount ?? "-"}`,
          `baseSource=${baseSnapshot?.source ?? "-"}`,
          `baseId=${baseSnapshot?.id ?? "-"}`,
        ].join(" | "),
      );
    }

    if (!hadUsableSource) {
      throw new Error("Every organic source resolved to missing/error.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
