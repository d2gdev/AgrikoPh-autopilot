import { prisma } from "@/lib/db";
import { Prisma, type Recommendation } from "@prisma/client";
import type { JobResult, JobStatus } from "@/lib/jobs/types";
import { findEntityMetrics, computeOutcome, type OutcomeResult } from "@/lib/recommendations/outcome-metrics";
import { chunkText } from "@/lib/ai/chunk";
import { embedTexts } from "@/lib/ai/embeddings";

const JOB_NAME = "check-outcomes";
const CHECK_WINDOW_DAYS = 7;
const CHECK_WINDOW_MS = CHECK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const BATCH_CAP = 50;

type Summary = { considered: number; checked: number; indexed: number; failed: number };

type OutcomePayload = {
  verdict: OutcomeResult["verdict"];
  metricsBefore: OutcomeResult["metricsBefore"];
  metricsAfter: OutcomeResult["metricsAfter"];
  deltas: OutcomeResult["deltas"];
  windowDays: number;
  checkedAt: string;
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// "both" recs (rare) may have landed against either connector's snapshot.
function platformSources(platform: string): string[] {
  return platform === "both" ? ["meta", "google_ads"] : [platform];
}

async function findSnapshotBefore(sources: string[], cutoff: Date) {
  const candidates = await Promise.all(
    sources.map((source) =>
      prisma.rawSnapshot.findFirst({
        where: { source, fetchedAt: { lte: cutoff } },
        orderBy: { fetchedAt: "desc" },
      }),
    ),
  );
  const found = candidates.filter((s): s is NonNullable<typeof s> => s != null);
  found.sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
  return found[0] ?? null;
}

async function findSnapshotAfter(sources: string[], threshold: Date) {
  const candidates = await Promise.all(
    sources.map((source) =>
      prisma.rawSnapshot.findFirst({
        where: { source, fetchedAt: { gte: threshold } },
        orderBy: { fetchedAt: "asc" },
      }),
    ),
  );
  const found = candidates.filter((s): s is NonNullable<typeof s> => s != null);
  found.sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  return found[0] ?? null;
}

function summarizeOutcome(rec: Recommendation, outcome: OutcomePayload): string {
  const deltaEntries = Object.entries(outcome.deltas);
  const deltaText = deltaEntries.length
    ? deltaEntries
        .map(([metric, d]) => `${metric} ${d.before} -> ${d.after}${d.deltaPercent != null ? ` (${d.deltaPercent.toFixed(1)}%)` : ""}`)
        .join(", ")
    : "no comparable metrics";
  return (
    `Skill "${rec.skillName}" recommended ${rec.actionType} on ${rec.targetEntityType} "${rec.targetEntityName}" ` +
    `(${rec.platform}). Outcome after ${outcome.windowDays} day(s): ${outcome.verdict}. Key deltas: ${deltaText}.`
  );
}

// Fail-safe: KB writes (pgvector/embeddings) may be unavailable at runtime —
// log and continue rather than let indexing failures fail the outcome check.
async function indexOutcome(rec: Recommendation, outcome: OutcomePayload): Promise<boolean> {
  try {
    const text = summarizeOutcome(rec, outcome);
    const chunks = chunkText(text);
    if (chunks.length === 0) return false;
    const vectors = await embedTexts(chunks.map((c) => c.content));
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "KnowledgeChunk"
           (id, "sourceType", "sourceId", "chunkIndex", content, "contentHash", embedding, metadata, tokens)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8)
         ON CONFLICT ("sourceType", "sourceId", "chunkIndex")
         DO UPDATE SET content = EXCLUDED.content, "contentHash" = EXCLUDED."contentHash",
                       embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata, tokens = EXCLUDED.tokens`,
        "recommendation_outcome",
        rec.id,
        c.chunkIndex,
        c.content,
        c.contentHash,
        `[${vectors[i]!.join(",")}]`,
        JSON.stringify({ verdict: outcome.verdict, skillName: rec.skillName, targetEntityName: rec.targetEntityName }),
        c.tokens,
      );
    }
    return true;
  } catch (err) {
    console.error(`[${JOB_NAME}] KB indexing failed for recommendation ${rec.id}:`, err);
    return false;
  }
}

export async function checkOutcomesHandler(): Promise<JobResult<Summary>> {
  const run = await prisma.jobRun.create({ data: { jobName: JOB_NAME } });
  const errors: string[] = [];
  let checked = 0;
  let indexed = 0;
  let failed = 0;
  let recs: Recommendation[] = [];

  try {
    const cutoff = new Date(Date.now() - CHECK_WINDOW_MS);
    recs = await prisma.recommendation.findMany({
      where: { status: "executed", executedAt: { lte: cutoff }, outcomeCheckedAt: null },
      orderBy: { executedAt: "asc" },
      take: BATCH_CAP,
    });

    for (const rec of recs) {
      try {
        if (!rec.executedAt) {
          throw new Error("recommendation is missing executedAt");
        }
        const sources = platformSources(rec.platform);
        const afterThreshold = new Date(rec.executedAt.getTime() + CHECK_WINDOW_MS);

        const [beforeSnapshot, afterSnapshot] = await Promise.all([
          findSnapshotBefore(sources, rec.executedAt),
          findSnapshotAfter(sources, afterThreshold),
        ]);

        const beforeMetrics = beforeSnapshot
          ? findEntityMetrics(beforeSnapshot.payload, rec.targetEntityType, rec.targetEntityId)
          : undefined;
        const afterMetrics = afterSnapshot
          ? findEntityMetrics(afterSnapshot.payload, rec.targetEntityType, rec.targetEntityId)
          : undefined;

        const result = computeOutcome(beforeMetrics, afterMetrics);
        const windowDays =
          beforeSnapshot && afterSnapshot
            ? Math.max(1, Math.round((afterSnapshot.fetchedAt.getTime() - beforeSnapshot.fetchedAt.getTime()) / (24 * 60 * 60 * 1000)))
            : CHECK_WINDOW_DAYS;

        const outcome: OutcomePayload = {
          verdict: result.verdict,
          metricsBefore: result.metricsBefore,
          metricsAfter: result.metricsAfter,
          deltas: result.deltas,
          windowDays,
          checkedAt: new Date().toISOString(),
        };

        await prisma.recommendation.update({
          where: { id: rec.id },
          data: { outcome: json(outcome), outcomeCheckedAt: new Date() },
        });
        checked++;

        if (outcome.verdict !== "insufficient_data") {
          const ok = await indexOutcome(rec, outcome);
          if (ok) indexed++;
        }
      } catch (err) {
        failed++;
        errors.push(`recommendation ${rec.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const status: JobStatus = errors.length === 0 ? "success" : checked > 0 ? "partial" : "failed";
  const summary: Summary = { considered: recs.length, checked, indexed, failed };

  await prisma.jobRun.update({
    where: { id: run.id },
    data: {
      status,
      completedAt: new Date(),
      summary: json(summary),
      errorLog: errors.length > 0 ? errors.join("\n").slice(0, 10_000) : null,
    },
  });

  return { jobName: JOB_NAME, runId: run.id, status, summary, errors };
}
