export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveActor } from "@/lib/ad-approval/route-helpers";

// GET /api/notifications — the current actor's in-app notifications (newest
// first). ?unread=1 returns only unread. Includes an unread count.
export async function GET(req: Request) {
  const ctx = await resolveActor(req);
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 100);

  const where = { recipientId: ctx.actor, ...(unreadOnly ? { readAt: null } : {}) };
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.notification.count({ where: { recipientId: ctx.actor, readAt: null } }),
  ]);
  return NextResponse.json({ notifications, unreadCount });
}

const patchSchema = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

// PATCH /api/notifications — mark notifications read (by id list, or all).
export async function PATCH(req: Request) {
  const ctx = await resolveActor(req);
  if (ctx instanceof NextResponse) return ctx;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const where = parsed.data.all
    ? { recipientId: ctx.actor, readAt: null }
    : { recipientId: ctx.actor, id: { in: parsed.data.ids ?? [] } };

  const result = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
  return NextResponse.json({ ok: true, updated: result.count });
}
