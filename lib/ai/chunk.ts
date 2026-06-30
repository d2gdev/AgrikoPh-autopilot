import { createHash } from "crypto";

export interface TextChunk {
  content: string;
  chunkIndex: number;
  contentHash: string;
  tokens: number;
}

const CHARS_PER_TOKEN = 4;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function chunkText(
  text: string,
  opts: { maxTokens?: number; overlapTokens?: number } = {},
): TextChunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const maxChars = (opts.maxTokens ?? 500) * CHARS_PER_TOKEN;
  const overlapChars = (opts.overlapTokens ?? 50) * CHARS_PER_TOKEN;
  const words = trimmed.split(/\s+/);

  const chunks: TextChunk[] = [];
  let buf: string[] = [];
  let bufLen = 0;

  const flush = () => {
    if (buf.length === 0) return;
    const content = buf.join(" ");
    chunks.push({
      content,
      chunkIndex: chunks.length,
      contentHash: sha256(content),
      tokens: Math.ceil(content.length / CHARS_PER_TOKEN),
    });
  };

  for (const w of words) {
    if (bufLen + w.length + 1 > maxChars && buf.length > 0) {
      flush();
      // Seed the next buffer with the overlap tail of the previous chunk.
      const overlap: string[] = [];
      let oLen = 0;
      for (let i = buf.length - 1; i >= 0 && oLen < overlapChars; i--) {
        overlap.unshift(buf[i]!);
        oLen += buf[i]!.length + 1;
      }
      buf = overlap;
      bufLen = oLen;
    }
    buf.push(w);
    bufLen += w.length + 1;
  }
  flush();
  return chunks;
}
