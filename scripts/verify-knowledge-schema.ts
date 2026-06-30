import { prisma } from "@/lib/db";

async function main() {
  const extensionRows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS exists;`;
  if (!extensionRows[0]?.exists) throw new Error("pgvector extension missing");

  const vec = "[" + Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0)).join(",") + "]";
  await prisma.$executeRawUnsafe(
    `INSERT INTO "KnowledgeChunk" (id, "sourceType", "sourceId", "chunkIndex", content, "contentHash", embedding, metadata, tokens)
     VALUES ('verify-1', 'article', 'verify', 0, 'hello', 'h', $1::vector, '{}'::jsonb, 1)`,
    vec,
  );
  const rows = await prisma.$queryRawUnsafe<{ id: string; score: number }[]>(
    `SELECT id, 1 - (embedding <=> $1::vector) AS score FROM "KnowledgeChunk" ORDER BY embedding <=> $1::vector LIMIT 1`,
    vec,
  );
  if (rows[0]?.id !== "verify-1") throw new Error("cosine query failed");
  await prisma.$executeRawUnsafe(`DELETE FROM "KnowledgeChunk" WHERE id = 'verify-1'`);
  console.log("knowledge schema OK, cosine score:", rows[0].score);
}

main().finally(() => prisma.$disconnect());
