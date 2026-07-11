import { z } from "zod";

export const MAX_QUEUE_PAGE_SIZE = 100;
export type QueueSort = "priority" | "createdAt" | "impact";
export type QueueQuery = {
  status?: string;
  type?: string;
  priority?: string;
  stage?: string;
  sort: QueueSort;
  q?: string;
  limit: number;
  cursor?: string;
};

const querySchema = z.object({
  status: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  stage: z.enum(["pending", "approved", "generating", "ready", "scheduled", "publishing", "publish-error", "published", "failed", "rejected"]).optional(),
  sort: z.enum(["priority", "createdAt", "impact"]).default("priority"),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).default(50).transform((limit) => Math.min(limit, MAX_QUEUE_PAGE_SIZE)),
  cursor: z.string().min(1).optional(),
});

const cursorSchema = z.object({
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().min(1).max(200),
}).strict();

export type QueueCursor = z.infer<typeof cursorSchema>;

export function decodeQueueCursor(value: string): QueueCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const parsed = cursorSchema.safeParse(decoded);
    if (!parsed.success) throw new Error("invalid shape");
    return parsed.data;
  } catch {
    throw new Error("Invalid cursor");
  }
}

export function parseQueueQuery(url: string): QueueQuery {
  const params = new URL(url, "http://localhost").searchParams;
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new Error("Invalid queue query");
  return parsed.data;
}
