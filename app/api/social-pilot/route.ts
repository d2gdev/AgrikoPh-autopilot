export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { fetchManagedPages, fetchPagePosts } from "@/lib/connectors/meta-organic";
import { requireAppAuth } from "@/lib/auth";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  try {
    if (!process.env.META_ACCESS_TOKEN) {
      console.error("[social-pilot] Meta not configured: META_ACCESS_TOKEN is not set");
      return NextResponse.json({
        error: "Meta integration not configured",
        code: "META_NOT_CONFIGURED",
        posts: [],
        pages: [],
      }, { status: 503 });
    }

    const pages = await fetchManagedPages();
    if (pages.length === 0) {
      return NextResponse.json({ posts: [], pages: [], message: "No Facebook pages found for this token." });
    }

    // Use META_PAGE_ID if set, otherwise first managed page
    const pageId = process.env.META_PAGE_ID ?? pages[0]!.id;
    const pageName = pages.find((p) => p.id === pageId)?.name ?? pages[0]!.name; // safe: pages.length > 0 checked above

    const posts = await fetchPagePosts(pageId);

    // Sort by engagement (likes + comments + shares)
    posts.sort((a, b) => (b.likes + b.comments + b.shares) - (a.likes + a.comments + a.shares));

    return NextResponse.json({ posts, pages, activePage: { id: pageId, name: pageName } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/\"code\"\s*:\s*(190|463)|\bcode\s+(190|463)\b/.test(message)) {
      return NextResponse.json({
        error: "Meta access token expired",
        code: "META_TOKEN_EXPIRED",
        posts: [],
        pages: [],
      }, { status: 424 });
    }
    return NextResponse.json({ error: "Social data could not be loaded", code: "META_FETCH_FAILED", posts: [], pages: [] }, { status: 502 });
  }
}
