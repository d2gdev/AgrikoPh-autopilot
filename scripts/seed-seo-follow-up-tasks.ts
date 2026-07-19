import { pathToFileURL } from "node:url";
import { CreateSeoTaskSchema, type CreateSeoTaskInput } from "@/lib/seo-tasks/contracts";
import {
  createSeoTask,
  type CreateSeoTaskResult,
} from "@/lib/seo-tasks/service";

const ACTOR = "seed:seo-follow-up-2026-07-18";

export const INITIAL_SEO_FOLLOW_UP_TASKS: CreateSeoTaskInput[] = [
  CreateSeoTaskSchema.parse({
    taskType: "canonical_transfer_review",
    title: "Review black-rice vs red-rice canonical transfer",
    description: "Confirm Google has consolidated the comparison page signals and that the legacy URL is no longer competing.",
    targetUrl: "/blogs/news/black-rice-vs-red-rice-which-philippine-organic-rice-is-right-for-you",
    topicalCluster: "rice-nutrition",
    pageRole: "comparison",
    ownerSurface: "seo",
    destinationPath: "/seo-pillar",
    priority: "P1",
    earliestReviewAt: "2026-07-25T00:00:00+08:00",
    dueAt: "2026-08-01T23:59:59+08:00",
    requiresEvidence: true,
    evidenceRequirement: {
      checks: [
        "Google-selected canonical",
        "index status",
        "legacy impressions",
        "canonical impressions",
        "clicks",
        "enhancement detection",
      ],
    },
    evidenceStatus: "waiting",
    evidenceSnapshot: null,
    sourceType: "operator",
    sourceKey: "canonical-transfer:black-rice-vs-red-rice:2026-07",
    sourceData: { agreedAt: "2026-07-18", createdFrom: "seo-follow-up-plan" },
  }),
  CreateSeoTaskSchema.parse({
    taskType: "ctr_experiment_review",
    title: "Review Rice Nutrition CTR pilot",
    description: "Evaluate the finalized 14–27 July Search Console window before deciding whether to retain the search presentation.",
    targetUrl: "/blogs/news/rice-nutrition-breakdown",
    topicalCluster: "rice-nutrition",
    pageRole: "nutrition-pillar",
    ownerSurface: "seo",
    destinationPath: "/seo-pillar",
    priority: "P1",
    earliestReviewAt: "2026-07-29T00:00:00+08:00",
    dueAt: null,
    requiresEvidence: true,
    evidenceRequirement: {
      finalizedWindow: { start: "2026-07-14", end: "2026-07-27" },
      metrics: ["clicks", "impressions", "CTR", "average position", "query mix", "confirmed Google crawl date"],
    },
    evidenceStatus: "waiting",
    evidenceSnapshot: null,
    sourceType: "seo_experiment",
    sourceKey: "ctr-pilot:rice-nutrition:2026-07-14_2026-07-27",
    sourceData: { agreedAt: "2026-07-18", createdFrom: "seo-follow-up-plan" },
  }),
  CreateSeoTaskSchema.parse({
    taskType: "cohort_review",
    title: "Review 90-day recipe cohort",
    description: "Assess the recipe cluster as a cohort and identify page-level outliers before scheduling further recipe work.",
    targetUrl: "/blogs/recipes",
    topicalCluster: "recipes",
    pageRole: "recipe-index",
    ownerSurface: "seo",
    destinationPath: "/seo-pillar",
    priority: "P2",
    earliestReviewAt: "2026-09-22T00:00:00+08:00",
    dueAt: null,
    requiresEvidence: true,
    evidenceRequirement: {
      metrics: [
        "90-day recipe cohort clicks",
        "impressions",
        "landing sessions",
        "conversions",
        "indexed coverage",
        "page-level outliers",
      ],
    },
    evidenceStatus: "waiting",
    evidenceSnapshot: null,
    sourceType: "topical_map",
    sourceKey: "cohort-review:recipes:90d:2026-09-22",
    sourceData: { agreedAt: "2026-07-18", createdFrom: "seo-follow-up-plan" },
  }),
  CreateSeoTaskSchema.parse({
    taskType: "ctr_experiment_review",
    title: "Review red-rice vs brown-rice query and snippet alignment",
    description: "Preserve the positive impression-growth signal. Compare same-query intent and the current search snippet before proposing any title or description change.",
    targetUrl: "/blogs/news/red-rice-vs-brown-rice-article-system-pilot",
    topicalCluster: "rice-nutrition",
    pageRole: "comparison",
    ownerSurface: "seo",
    destinationPath: "/seo-pillar",
    priority: "P1",
    earliestReviewAt: "2026-07-21T00:00:00+08:00",
    dueAt: null,
    requiresEvidence: true,
    evidenceRequirement: {
      finalizedWindowDays: 28,
      checks: ["same-query impressions", "same-query clicks", "CTR", "average position", "rendered Google title", "rendered Google snippet", "active topical-map ownership"],
      constraint: "Positive impression growth is not a defect and must not trigger a blind rewrite.",
    },
    evidenceStatus: "waiting",
    evidenceSnapshot: null,
    sourceType: "operator",
    sourceKey: "gsc-07:red-brown-query-snippet:2026-07-20",
    sourceData: { finding: "GSC-07", approvedAt: "2026-07-20", action: "evidence_review_only" },
  }),
  CreateSeoTaskSchema.parse({
    taskType: "ctr_experiment_review",
    title: "Review black-rice vs red-rice query and snippet alignment",
    description: "Compare query intent and the canonical comparison-page snippet while retaining the current topical-map owner and existing canonical-transfer review.",
    targetUrl: "/blogs/news/black-rice-vs-red-rice-which-philippine-organic-rice-is-right-for-you",
    topicalCluster: "rice-nutrition",
    pageRole: "comparison",
    ownerSurface: "seo",
    destinationPath: "/seo-pillar",
    priority: "P1",
    earliestReviewAt: "2026-07-21T00:00:00+08:00",
    dueAt: null,
    requiresEvidence: true,
    evidenceRequirement: {
      finalizedWindowDays: 28,
      checks: ["canonical query mix", "legacy query mix", "CTR", "average position", "Google-selected canonical", "rendered Google title", "rendered Google snippet"],
      constraint: "Do not change canonical ownership without the separate consolidation evidence.",
    },
    evidenceStatus: "waiting",
    evidenceSnapshot: null,
    sourceType: "operator",
    sourceKey: "gsc-07:black-red-query-snippet:2026-07-20",
    sourceData: { finding: "GSC-07", approvedAt: "2026-07-20", action: "evidence_review_only" },
  }),
  CreateSeoTaskSchema.parse({
    taskType: "ctr_experiment_review",
    title: "Review pito-pito snippet and evidence",
    description: "Compare the current pito-pito search presentation with same-query intent, then identify evidence gaps before drafting any metadata adjustment.",
    targetUrl: "/blogs/news/pito-pito-tea-philippines",
    topicalCluster: "filipino-herbal-remedies",
    pageRole: "herb-spoke",
    ownerSurface: "seo",
    destinationPath: "/seo-pillar",
    priority: "P1",
    earliestReviewAt: "2026-07-21T00:00:00+08:00",
    dueAt: null,
    requiresEvidence: true,
    evidenceRequirement: {
      finalizedWindowDays: 28,
      checks: ["same-query impressions", "same-query clicks", "CTR", "average position", "rendered Google title", "rendered Google snippet", "claim evidence coverage"],
      constraint: "Keep the page within its active herb-spoke ownership.",
    },
    evidenceStatus: "waiting",
    evidenceSnapshot: null,
    sourceType: "operator",
    sourceKey: "gsc-07:pito-pito-snippet-evidence:2026-07-20",
    sourceData: { finding: "GSC-07", approvedAt: "2026-07-20", action: "evidence_review_only" },
  }),
  CreateSeoTaskSchema.parse({
    taskType: "content_quality_review",
    title: "Review turmeric dosage performance with medical gate",
    description: "Reconcile the recovered impression trend against a non-overlapping 28-day baseline. No dosage, safety, title, description, or body change is authorized without the active medical-review gate.",
    targetUrl: "/blogs/news/turmeric-dosage-safety",
    topicalCluster: "turmeric-tea-philippines",
    pageRole: "safety-spoke",
    ownerSurface: "content",
    destinationPath: "/content-pilot",
    priority: "P1",
    earliestReviewAt: "2026-07-21T00:00:00+08:00",
    dueAt: null,
    requiresEvidence: true,
    evidenceRequirement: {
      medicalReviewRequired: true,
      finalizedWindowDays: 28,
      checks: ["same-query impressions", "same-query clicks", "CTR", "average position", "query mix", "Google crawl date", "qualified medical reviewer evidence"],
      constraint: "Do not mutate medical or nutrition claims until the review requirement is satisfied.",
    },
    evidenceStatus: "waiting",
    evidenceSnapshot: null,
    sourceType: "operator",
    sourceKey: "gsc-07:turmeric-performance-medical-review:2026-07-20",
    sourceData: { finding: "GSC-07", approvedAt: "2026-07-20", action: "manual_gate" },
  }),
];

export function parseSeedArguments(args: string[]) {
  let apply = false;
  let production = false;
  for (const argument of args) {
    if (argument === "--apply") apply = true;
    else if (argument === "--production") production = true;
    else throw new Error(`Unknown flag: ${argument}`);
  }
  return { apply, production };
}

function isGuardedTestDatabase(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
      && parsed.pathname.slice(1) === "autopilot_test";
  } catch {
    return false;
  }
}

type SeedCreate = (
  input: CreateSeoTaskInput,
  actor: string,
) => Promise<CreateSeoTaskResult>;

export async function runSeoTaskSeed({
  apply,
  production,
  databaseUrl,
  createTask = createSeoTask,
}: {
  apply: boolean;
  production: boolean;
  databaseUrl: string | undefined;
  createTask?: SeedCreate;
}) {
  if (!apply) {
    return {
      planned: INITIAL_SEO_FOLLOW_UP_TASKS.length,
      created: 0,
      existing: 0,
      writeCount: 0,
      dryRun: true,
    };
  }
  if (!databaseUrl) throw new Error("DATABASE_URL is required with --apply.");
  if (!isGuardedTestDatabase(databaseUrl) && !production) {
    throw new Error("Production seeding requires --production and separate operator authorization.");
  }

  let created = 0;
  let existing = 0;
  for (const task of INITIAL_SEO_FOLLOW_UP_TASKS) {
    const result = await createTask(task, ACTOR);
    if (result.outcome === "created") created += 1;
    else existing += 1;
  }
  return {
    planned: INITIAL_SEO_FOLLOW_UP_TASKS.length,
    created,
    existing,
    writeCount: created,
    dryRun: false,
  };
}

async function main() {
  const args = parseSeedArguments(process.argv.slice(2));
  const result = await runSeoTaskSeed({
    ...args,
    databaseUrl: process.env.DATABASE_URL,
  });
  console.log(JSON.stringify(result, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
