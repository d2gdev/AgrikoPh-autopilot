export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getSessionShop, getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { fetchBlogContentHandler } from "@/jobs/fetch-blog-content";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { checkRateLimit } from "@/lib/rate-limit";

const JOB_NAME = "fetch-blog-content";

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`content-index:${actor}`, 3, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded: max 3 indexing runs per minute" }, { status: 429 });
  }

  const acquired = await acquireJobLock(JOB_NAME);
  if (!acquired) {
    return NextResponse.json({ error: "Content indexing is already running" }, { status: 409 });
  }
  try {
    const result = await fetchBlogContentHandler();
    return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseJobLock(JOB_NAME);
  }
}
