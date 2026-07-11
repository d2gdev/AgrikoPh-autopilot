export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { runFetchBlogContentLocked } from "@/jobs/fetch-blog-content";

async function handler(req: NextRequest) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  try {
    const locked = await runFetchBlogContentLocked();
    if (!locked.acquired) return Response.json({ skipped: true, reason: "job already running" }, { status: 409 });
    const result = locked.result;
    return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handler(req); }
export async function POST(req: NextRequest) { return handler(req); }
