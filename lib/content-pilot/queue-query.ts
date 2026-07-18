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
  sort: z.enum(["priority", "createdAt", "impact"]),
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

export function encodeQueueCursor(cursor: QueueCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export type QueueSortRow = {
  id: string;
  priority: string;
  impact: string;
  createdAt: Date | string;
};

function priorityRank(priority: string): number {
  const normalized = priority.toLowerCase();
  if (normalized === "p0") return 0;
  if (normalized === "p1") return 1;
  if (normalized === "p2" || normalized === "medium") return 2;
  if (normalized === "p3") return 3;
  return 4;
}

function impactRank(impact: string): number {
  const normalized = impact.toLowerCase();
  if (normalized === "high") return 0;
  if (normalized === "medium") return 1;
  if (normalized === "low") return 2;
  return 3;
}

export function orderQueueRows<T extends QueueSortRow>(rows: T[], sort: QueueSort): T[] {
  return [...rows].sort((left, right) => {
    const createdAtDifference = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    const idDifference = right.id.localeCompare(left.id);

    if (sort === "priority") {
      return priorityRank(left.priority) - priorityRank(right.priority)
        || createdAtDifference
        || idDifference;
    }
    if (sort === "impact") {
      return impactRank(left.impact) - impactRank(right.impact)
        || createdAtDifference
        || idDifference;
    }
    return createdAtDifference || idDifference;
  });
}

export function pageQueueRows<T extends QueueSortRow>(
  rows: T[],
  sort: QueueSort,
  limit: number,
  cursorValue?: string | null,
): { rows: T[]; nextCursor: string | null } {
  const ordered = orderQueueRows(rows, sort);
  let start = 0;
  if (cursorValue) {
    const cursor = decodeQueueCursor(cursorValue);
    if (cursor.sort !== sort) throw new Error("Invalid cursor");
    const cursorIndex = ordered.findIndex((row) => row.id === cursor.id);
    if (cursorIndex < 0) throw new Error("Invalid cursor");
    start = cursorIndex + 1;
  }

  const page = ordered.slice(start, start + limit);
  const hasMore = start + page.length < ordered.length;
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: hasMore && last ? encodeQueueCursor({ sort, id: last.id }) : null,
  };
}

export function parseQueueQuery(url: string): QueueQuery {
  const params = new URL(url, "http://localhost").searchParams;
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new Error("Invalid queue query");
  return parsed.data;
}
