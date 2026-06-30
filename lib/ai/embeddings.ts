import OpenAI from "openai";
import { getOptionalSecret } from "@/lib/config/resolver";

export const EMBEDDING_DIM = 1024;
const DEFAULT_MODEL = "bge-m3";
const BATCH_SIZE = 64;

export class EmbeddingsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingsUnavailableError";
  }
}

async function getEmbeddingsClient() {
  const [baseURL, model] = await Promise.all([
    getOptionalSecret("EMBEDDINGS_BASE_URL"),
    getOptionalSecret("EMBEDDINGS_MODEL"),
  ]);
  if (!baseURL) {
    throw new EmbeddingsUnavailableError("EMBEDDINGS_BASE_URL is not configured");
  }
  // Ollama/LocalAI OpenAI-compatible endpoints ignore the key but the SDK requires one.
  const client = new OpenAI({ baseURL, apiKey: "ollama", maxRetries: 3 });
  return { client, model: model ?? DEFAULT_MODEL };
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { client, model } = await getEmbeddingsClient();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await client.embeddings.create({ model, input: batch });
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    for (const row of sorted) out.push(row.embedding as number[]);
  }
  return out;
}
