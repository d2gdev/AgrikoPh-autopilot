export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getSessionShop, getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { runFetchBlogContentLocked } from "@/jobs/fetch-blog-content";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`content-index:${actor}`, 3, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded: max 3 indexing runs per minute" }, { status: 429 });
  }

  try {
    const locked = await runFetchBlogContentLocked();
    if (!locked.acquired) {
      return NextResponse.json({ error: "Content indexing is already running" }, { status: 409 });
    }
    const result = locked.result;
    return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
