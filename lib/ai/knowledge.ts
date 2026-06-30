import { prisma } from "@/lib/db";
import { embedTexts } from "@/lib/ai/embeddings";

export interface RetrievedChunk {
  sourceType: string;
  sourceId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

function toVectorLiteral(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

export async function retrieveContext(args: {
  query: string;
  sourceTypes?: string[];
  topK?: number;
  minScore?: number;
}): Promise<RetrievedChunk[]> {
  const topK = args.topK ?? 6;
  const minScore = args.minScore ?? 0.35;
  try {
    const [vec] = await embedTexts([args.query]);
    if (!vec) return [];
    const literal = toVectorLiteral(vec);

    const params: unknown[] = [literal];
    let filter = "";
    if (args.sourceTypes && args.sourceTypes.length > 0) {
      params.push(args.sourceTypes);
      filter = `WHERE "sourceType" = ANY($${params.length})`;
    }
    params.push(topK);
    const limitIdx = params.length;

    const rows = await prisma.$queryRawUnsafe<RetrievedChunk[]>(
      `SELECT "sourceType", "sourceId", content,
              1 - (embedding <=> $1::vector) AS score,
              metadata
       FROM "KnowledgeChunk"
       ${filter}
       ORDER BY embedding <=> $1::vector
       LIMIT $${limitIdx}`,
      ...params,
    );
    return rows.filter((r) => Number(r.score) >= minScore).map((r) => ({ ...r, score: Number(r.score) }));
  } catch (err) {
    console.warn("[knowledge] retrieveContext degraded to empty:", err);
    return [];
  }
}

export function formatGroundingBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  const items = chunks.map((c, i) => {
    const title = (c.metadata?.title as string) ?? `${c.sourceType}:${c.sourceId}`;
    return `[${i + 1}] (${c.sourceType} — ${title})\n${c.content}`;
  });
  return [
    "GROUNDING CONTEXT — relevant material from Agriko's own corpus.",
    "Use it for accuracy and to avoid duplicating existing content. Cite by [n] where you rely on it.",
    "",
    items.join("\n\n"),
  ].join("\n");
}
