export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { shopifyFetch } from "@/lib/shopify-admin";

const BLOGS_QUERY = `
  query {
    blogs(first: 20) {
      edges {
        node {
          id
          title
          handle
        }
      }
    }
  }
`;

interface BlogsResponse {
  blogs: {
    edges: Array<{
      node: { id: string; title: string; handle: string };
    }>;
  };
}

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const data = await shopifyFetch<BlogsResponse>(BLOGS_QUERY);
    const blogs = data.blogs.edges.map(({ node }) => ({
      id: node.id,
      title: node.title,
      handle: node.handle,
    }));
    return NextResponse.json({ blogs });
  } catch (err) {
    console.error("[content-pilot/blogs] error:", err);
    return NextResponse.json({ error: "Unable to load Shopify blogs" }, { status: 500 });
  }
}
