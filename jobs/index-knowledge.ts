import { prisma } from "@/lib/db";
import type { JobResult, JobStatus } from "@/lib/jobs/types";
import { collectSourceDocs, INDEXED_SOURCE_TYPES } from "@/lib/ai/knowledge-sources";
import { chunkText } from "@/lib/ai/chunk";
import { embedTexts } from "@/lib/ai/embeddings";

const JOB_NAME = "index-knowledge";

type Summary = { indexed: number; skipped: number; deleted: number };

function vectorLiteral(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

export async function indexKnowledgeHandler(): Promise<JobResult<Summary>> {
  const runId = (await prisma.jobRun.create({ data: { jobName: JOB_NAME } })).id;
  let status: JobStatus = "failed";
  const errors: string[] = [];
  let indexed = 0;
  let skipped = 0;
  let deleted = 0;

  try {
    const docs = await collectSourceDocs();

    const existing = (await prisma.knowledgeChunk.findMany({
      select: { sourceType: true, sourceId: true, chunkIndex: true, contentHash: true },
    })) as { sourceType: string; sourceId: string; chunkIndex: number; contentHash: string }[];
    const existingHash = new Map(
      existing.map((e) => [`${e.sourceType}:${e.sourceId}:${e.chunkIndex}`, e.contentHash]),
    );

    const liveKeys = new Set<string>();
    const toEmbed: {
      sourceType: string; sourceId: string; chunkIndex: number;
      content: string; contentHash: string; tokens: number; metadata: Record<string, unknown>;
    }[] = [];

    for (const doc of docs) {
      const chunks = chunkText(doc.text);
      for (const c of chunks) {
        const key = `${doc.sourceType}:${doc.sourceId}:${c.chunkIndex}`;
        liveKeys.add(key);
        if (existingHash.get(key) === c.contentHash) {
          skipped++;
          continue;
        }
        toEmbed.push({
          sourceType: doc.sourceType, sourceId: doc.sourceId, chunkIndex: c.chunkIndex,
          content: c.content, contentHash: c.contentHash, tokens: c.tokens, metadata: doc.metadata,
        });
      }
    }

    if (toEmbed.length > 0) {
      const vectors = await embedTexts(toEmbed.map((t) => t.content));
      for (let i = 0; i < toEmbed.length; i++) {
        const t = toEmbed[i]!;
        await prisma.$executeRawUnsafe(
          `INSERT INTO "KnowledgeChunk"
             (id, "sourceType", "sourceId", "chunkIndex", content, "contentHash", embedding, metadata, tokens)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8)
           ON CONFLICT ("sourceType", "sourceId", "chunkIndex")
           DO UPDATE SET content = EXCLUDED.content, "contentHash" = EXCLUDED."contentHash",
                         embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata, tokens = EXCLUDED.tokens`,
          t.sourceType, t.sourceId, t.chunkIndex, t.content, t.contentHash,
          vectorLiteral(vectors[i]!), JSON.stringify(t.metadata), t.tokens,
        );
        indexed++;
      }
    }

    // Delete chunks whose live key no longer exists — but only among sourceTypes
    // this job actually owns/enumerates via collectSourceDocs(). Chunks with
    // other sourceTypes (e.g. "recommendation_outcome", written directly by
    // jobs/check-outcomes.ts) are never candidates for deletion here: this job
    // has no visibility into whether they're still live, so treating their
    // absence from `docs` as "orphaned" would wipe externally-managed data.
    const ownedSourceTypes = new Set<string>(INDEXED_SOURCE_TYPES);
    const orphans = existing.filter(
      (e) => ownedSourceTypes.has(e.sourceType) && !liveKeys.has(`${e.sourceType}:${e.sourceId}:${e.chunkIndex}`),
    );
    if (orphans.length > 0) {
      await prisma.knowledgeChunk.deleteMany({
        where: { OR: orphans.map((o) => ({ sourceType: o.sourceType, sourceId: o.sourceId, chunkIndex: o.chunkIndex })) },
      });
      deleted = orphans.length;
    }

    status = "success";
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const summary: Summary = { indexed, skipped, deleted };
  await prisma.jobRun.update({
    where: { id: runId },
    data: {
      status,
      completedAt: new Date(),
      summary,
      errorLog: errors.length > 0 ? errors.join("\n").slice(0, 10_000) : null,
    },
  });

  return { jobName: JOB_NAME, runId, status, summary, errors };
}
