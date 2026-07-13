import { NextResponse } from "next/server";
import { getSessionShop, getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { syncTopicalMapStoreTasks } from "@/lib/store-tasks/topical-map";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;
  const actor = (await getSessionUser(req)) ?? (await getSessionShop(req)) ?? "embedded-app";
  if (!checkRateLimit(`topical-map-store-task-sync:${actor}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many synchronization requests." }, { status: 429 });
  }
  try {
    return NextResponse.json(await syncTopicalMapStoreTasks(prisma));
  } catch {
    return NextResponse.json({ error: "Store task synchronization failed." }, { status: 500 });
  }
}
