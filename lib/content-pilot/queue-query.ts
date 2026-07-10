export type QueueQuery = { status?: string; limit: number; cursor?: string };
export function parseQueueQuery(url: string): QueueQuery {
  const p = new URL(url, "http://localhost").searchParams;
  const raw = Number(p.get("limit") ?? 100);
  return { status: p.get("status") ?? undefined, limit: Number.isFinite(raw) ? Math.min(100, Math.max(1, Math.floor(raw))) : 100, cursor: p.get("cursor") ?? undefined };
}
