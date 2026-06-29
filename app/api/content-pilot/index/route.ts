export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { fetchBlogContentHandler } from "@/jobs/fetch-blog-content";

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  try {
    const result = await fetchBlogContentHandler();
    return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
