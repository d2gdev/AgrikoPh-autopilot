import { getToken, detectAndLogTokenExpiry } from "./meta-token";

const BASE_URL = "https://graph.facebook.com/v20.0";

async function graphGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getToken()}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.text();
    detectAndLogTokenExpiry(err);
    throw new Error(`Meta API error ${res.status}: ${err}`);
  }
  return res.json();
}

export interface PagePost {
  id: string;
  message: string;
  createdTime: string;
  permalinkUrl: string;
  likes: number;
  comments: number;
  shares: number;
  fullPicture: string | null;
}

export interface PageInfo {
  id: string;
  name: string;
}

export async function fetchManagedPages(): Promise<PageInfo[]> {
  const data = await graphGet("me/accounts", { fields: "id,name", limit: "25" }) as {
    data: Array<{ id: string; name: string }>;
  };
  if (data.data?.length >= 25) console.warn("[meta-organic] fetchManagedPages hit limit=25 — some pages may be missing. Phase 2: add cursor pagination.");
  return (data.data ?? []).map((p) => ({ id: p.id, name: p.name }));
}

export async function fetchPagePosts(pageId: string): Promise<PagePost[]> {
  const data = await graphGet(`${pageId}/posts`, {
    fields: "message,created_time,permalink_url,full_picture,likes.summary(true),comments.summary(true),shares",
    limit: "50",
  }) as {
    data: Array<{
      id: string;
      message?: string;
      created_time: string;
      permalink_url: string;
      full_picture?: string;
      likes?: { summary: { total_count: number } };
      comments?: { summary: { total_count: number } };
      shares?: { count: number };
    }>;
  };

  if (data.data?.length >= 50) console.warn("[meta-organic] fetchPagePosts hit limit=50 — some posts may be missing. Phase 2: add cursor pagination.");
  return (data.data ?? []).map((p) => ({
    id: p.id,
    message: p.message ?? "",
    createdTime: p.created_time,
    permalinkUrl: p.permalink_url,
    likes: p.likes?.summary?.total_count ?? 0,
    comments: p.comments?.summary?.total_count ?? 0,
    shares: p.shares?.count ?? 0,
    fullPicture: p.full_picture ?? null,
  }));
}
