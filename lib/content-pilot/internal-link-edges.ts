import type { Prisma, PrismaClient } from "@prisma/client";
import type { LinksAnalysis, LinkRecord } from "@/lib/analyzers/blog-links";

type InternalLinkEdgeClient = Pick<PrismaClient, "internalLinkEdge">;

export type InternalLinkTargetType = "article" | "product" | "collection" | "page" | "other";

export interface ClassifiedInternalLink {
  targetType: InternalLinkTargetType;
  targetHandle: string | null;
  targetUrl: string;
}

export interface InternalLinkEdgeInput {
  jobRunId?: string | null;
  sourceType: string;
  sourceHandle: string;
  sourceUrl?: string | null;
  linksData: LinksAnalysis;
  capturedAt?: Date;
}

function pathFromHref(href: string): string | null {
  try {
    const url = new URL(href, "https://agrikoph.com");
    const host = url.hostname.toLowerCase();
    if (host !== "agrikoph.com" && host !== "www.agrikoph.com") return null;
    const path = url.pathname || "/";
    return `${path}${url.search}`.replace(/\/$/, "") || "/";
  } catch {
    return null;
  }
}

function ctaKey(link: LinkRecord): string {
  return `${link.href}\n${link.text}`;
}

export function sourceUrlForArticle(handle: string, blogHandle?: string | null): string {
  return `/blogs/${blogHandle || "news"}/${handle}`;
}

export function articleBlogHandleFromSeoData(seoData: unknown): string | null {
  if (!seoData || typeof seoData !== "object") return null;
  const blogHandle = (seoData as { blogHandle?: unknown }).blogHandle;
  return typeof blogHandle === "string" && blogHandle.length > 0 ? blogHandle : null;
}

export function classifyInternalLink(href: string): ClassifiedInternalLink | null {
  const targetUrl = pathFromHref(href);
  if (!targetUrl) return null;

  const segments = targetUrl.split("?")[0]?.split("/").filter(Boolean) ?? [];
  if (segments[0] === "blogs" && segments.length >= 3) {
    return { targetType: "article", targetHandle: segments[2] ?? null, targetUrl };
  }
  if (segments[0] === "products" && segments[1]) {
    return { targetType: "product", targetHandle: segments[1], targetUrl };
  }
  if (segments[0] === "collections" && segments[1]) {
    return { targetType: "collection", targetHandle: segments[1], targetUrl };
  }
  if (segments[0] === "pages" && segments[1]) {
    return { targetType: "page", targetHandle: segments[1], targetUrl };
  }

  return { targetType: "other", targetHandle: segments.at(-1) ?? null, targetUrl };
}

export function buildInternalLinkEdges(input: InternalLinkEdgeInput): Prisma.InternalLinkEdgeCreateManyInput[] {
  const capturedAt = input.capturedAt ?? new Date();
  const ctaLinks = new Set(input.linksData.cta.map(ctaKey));

  return input.linksData.internal.flatMap((link) => {
    const target = classifyInternalLink(link.href);
    if (!target) return [];
    return {
      jobRunId: input.jobRunId ?? null,
      sourceType: input.sourceType,
      sourceHandle: input.sourceHandle,
      sourceUrl: input.sourceUrl ?? null,
      targetType: target.targetType,
      targetHandle: target.targetHandle,
      targetUrl: target.targetUrl,
      anchorText: link.text,
      isCta: ctaLinks.has(ctaKey(link)),
      capturedAt,
    };
  });
}

export async function replaceInternalLinkEdgesForSource(
  prismaClient: InternalLinkEdgeClient,
  input: InternalLinkEdgeInput,
): Promise<number> {
  const edges = buildInternalLinkEdges(input);
  await prismaClient.internalLinkEdge.deleteMany({
    where: {
      sourceType: input.sourceType,
      sourceHandle: input.sourceHandle,
    },
  });

  if (edges.length === 0) return 0;

  await prismaClient.internalLinkEdge.createMany({ data: edges });
  return edges.length;
}
