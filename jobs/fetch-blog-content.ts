import crypto from "crypto";
import { prisma } from "@/lib/db";
import { fetchBlogArticles } from "@/lib/shopify-admin";
import { parseArticleHtml } from "@/lib/analyzers/html-parser";
import { analyzeSeo } from "@/lib/analyzers/blog-seo";
import { analyzeLinks, type LinksAnalysis } from "@/lib/analyzers/blog-links";
import { analyzeTopics } from "@/lib/analyzers/blog-topics";
import {
  maybeCreateArticleSnapshot,
  type ArticleSnapshotState,
} from "@/lib/content-pilot/article-snapshots";
import {
  articleBlogHandleFromSeoData,
  replaceInternalLinkEdgesForSource,
  sourceUrlForArticle,
} from "@/lib/content-pilot/internal-link-edges";
import type { JobStatus } from "@/lib/jobs/types";

export function computeContentHash(bodyHtml: string): string {
  return crypto.createHash("sha256").update(bodyHtml).digest("hex");
}

export function computeInboundCounts(
  linksMap: Record<string, LinksAnalysis>
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const links of Object.values(linksMap)) {
    for (const link of links.internal) {
      let handle: string;
      try {
        const segments = new URL(link.href, "https://agrikoph.com").pathname
          .split("/")
          .filter(Boolean);
        // Must be /blogs/<blog-name>/<handle> — ignore product, page, collection links
        handle = segments[0] === "blogs" && segments.length === 3 ? segments[2]! : ""; // safe: length === 3 guarantees index 2 exists
      } catch {
        handle = "";
      }
      if (!handle) continue;
      counts[handle] = (counts[handle] ?? 0) + 1;
    }
  }

  return counts;
}

export interface IndexResult {
  jobName: "fetch-blog-content";
  runId: string;
  indexed: number;
  skipped: number;
  snapshotsCreated: number;
  errors: string[];
  status: Extract<JobStatus, "success" | "partial" | "failed">;
  timings?: Record<string, number>;
}

export async function fetchBlogContentHandler(): Promise<IndexResult> {
  const timings: Record<string, number> = {};
  const tStart = Date.now();
  let mark = tStart;
  const lap = (name: string) => { const now = Date.now(); timings[name] = now - mark; mark = now; };

  const runId = (
    await prisma.jobRun.create({ data: { jobName: "fetch-blog-content" } })
  ).id;
  lap("jobRunCreate");

  const errors: string[] = [];
  let indexed = 0;
  let skipped = 0;
  let snapshotsCreated = 0;
  let linkEdgesWritten = 0;
  let staleArticlesPruned = 0;
  let staleLinkEdgesPruned = 0;

  try {
    const articles = await fetchBlogArticles();
    lap("fetchShopify");
    const linksMap: Record<string, LinksAnalysis> = {};
    const pendingSnapshots: ArticleSnapshotState[] = [];
    const seoDataByHandle = new Map<string, unknown>();

    const handles = articles.map((a: { handle: string }) => a.handle);
    const shopifyIds = articles.map((a: { id: string }) => a.id);
    const existingRecords = await prisma.articleRecord.findMany({
      where: {
        OR: [
          { handle: { in: handles } },
          { shopifyId: { in: shopifyIds } },
        ],
      },
      select: {
        id: true,
        shopifyId: true,
        handle: true,
        title: true,
        contentHash: true,
        wordCount: true,
        imageCount: true,
        headingCount: true,
        ctaCount: true,
        internalLinkCount: true,
        inboundCount: true,
        seoData: true,
        linksData: true,
        topicsData: true,
      },
    });
    const existingMap = new Map(existingRecords.map((r) => [r.handle, r]));
    const existingByShopifyId = new Map(existingRecords.map((r) => [r.shopifyId, r]));
    lap("loadExisting");

    for (const article of articles) {
      try {
        const contentHash = computeContentHash(article.bodyHtml);

        const existingByHandle = existingMap.get(article.handle) ?? null;
        const existingByShopify = existingByShopifyId.get(article.id) ?? null;
        if (existingByHandle && existingByShopify && existingByHandle.id !== existingByShopify.id) {
          errors.push(
            `${article.handle}: Article identity conflict; handle belongs to ${existingByHandle.shopifyId} but Shopify returned ${article.id}.`,
          );
          skipped++;
          continue;
        }

        const existing = existingByShopify ?? existingByHandle;

        if (existing?.contentHash === contentHash && existing.handle === article.handle) {
          if (existing.linksData) {
            linksMap[article.handle] = existing.linksData as unknown as LinksAnalysis;
          }
          seoDataByHandle.set(article.handle, existing.seoData);
          pendingSnapshots.push({
            articleRecordId: existing.id,
            shopifyId: existing.shopifyId,
            handle: existing.handle,
            title: existing.title,
            contentHash: existing.contentHash,
            wordCount: existing.wordCount,
            imageCount: existing.imageCount,
            headingCount: existing.headingCount,
            ctaCount: existing.ctaCount,
            internalLinkCount: existing.internalLinkCount,
            inboundCount: existing.inboundCount,
            seoData: existing.seoData,
            linksData: existing.linksData,
            topicsData: existing.topicsData,
          });
          skipped++;
          continue;
        }

        const parsed = parseArticleHtml(article.bodyHtml);
        const seoData = {
          ...analyzeSeo(
            { seoTitle: article.seoTitle, seoDescription: article.seoDescription },
            parsed
          ),
          blogHandle: article.blogHandle,
        };
        const linksData = analyzeLinks(parsed);
        const topicsData = analyzeTopics(article.title, parsed.textContent, article.tags);

        linksMap[article.handle] = linksData;
        seoDataByHandle.set(article.handle, seoData);

        const scalars = {
          author: article.authorName ?? null,
          imageCount: parsed.images.length,
          headingCount: parsed.h1s.length + parsed.h2s.length + parsed.h3s.length,
          ctaCount: linksData.cta.length,
          internalLinkCount: linksData.internal.length,
        };

        const articleData = {
          shopifyId: article.id,
          handle: article.handle,
          title: article.title,
          publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
          contentHash,
          wordCount: parsed.wordCount,
          seoData: seoData as object,
          linksData: linksData as object,
          topicsData: topicsData as object,
          ...scalars,
        };

        const saved = existing
          ? await prisma.articleRecord.update({
              where: { id: existing.id },
              data: articleData,
              select: { id: true, shopifyId: true, inboundCount: true },
            })
          : await prisma.articleRecord.create({
              data: articleData,
              select: { id: true, shopifyId: true, inboundCount: true },
            });

        pendingSnapshots.push({
          articleRecordId: saved.id,
          shopifyId: saved.shopifyId,
          handle: article.handle,
          title: article.title,
          contentHash,
          wordCount: parsed.wordCount,
          inboundCount: saved.inboundCount,
          seoData,
          linksData,
          topicsData,
          ...scalars,
        });

        indexed++;
      } catch (err) {
        errors.push(`${article.handle}: ${String(err)}`);
        // Preserve existing link data so this article's outbound links still count toward inbound totals
        const existing = existingMap.get(article.handle) ?? existingByShopifyId.get(article.id) ?? null;
        if (existing?.linksData) {
          linksMap[article.handle] = existing.linksData as unknown as LinksAnalysis;
        }
      }
    }

    lap("indexLoop");

    // Phase 2: compute and patch inbound counts
    const inboundCounts = computeInboundCounts(linksMap);

    // Zero-fill EVERY current article handle first, then overlay the computed
    // counts. Without this, an article whose inbound links dropped to zero this
    // run (and which is therefore absent from the computed counts) would retain
    // its stale non-zero inboundCount instead of being decremented to 0.
    for (const handle of handles) {
      if (!(handle in inboundCounts)) {
        inboundCounts[handle] = 0;
      }
    }

    // Write inbound counts to the dedicated column (not patched into JSON)
    const inboundHandles = Object.keys(inboundCounts);
    if (inboundHandles.length > 0) {
      try {
        await prisma.$transaction(
          inboundHandles.map((handle) =>
            prisma.articleRecord.updateMany({
              where: { handle },
              data: { inboundCount: inboundCounts[handle] ?? 0 },
            })
          )
        );
      } catch (err) {
        errors.push(`inbound-count-batch: ${String(err)}`);
      }
    }
    lap("inboundUpdate");

    for (const [handle, linksData] of Object.entries(linksMap)) {
      try {
        linkEdgesWritten += await replaceInternalLinkEdgesForSource(prisma, {
          jobRunId: runId,
          sourceType: "article",
          sourceHandle: handle,
          sourceUrl: sourceUrlForArticle(handle, articleBlogHandleFromSeoData(seoDataByHandle.get(handle))),
          linksData,
        });
      } catch (err) {
        errors.push(`internal-link-edge:${handle}: ${String(err)}`);
      }
    }
    lap("linkEdgeUpdate");

    if (handles.length > 0) {
      try {
        const [articleResult, edgeResult] = await prisma.$transaction([
          prisma.articleRecord.deleteMany({
            where: {
              AND: [
                { handle: { notIn: handles } },
                { shopifyId: { notIn: shopifyIds } },
              ],
            },
          }),
          prisma.internalLinkEdge.deleteMany({
            where: {
              sourceType: "article",
              sourceHandle: { notIn: handles },
            },
          }),
        ]);
        staleArticlesPruned = articleResult.count;
        staleLinkEdgesPruned = edgeResult.count;
      } catch (err) {
        errors.push(`stale-article-prune: ${String(err)}`);
      }
    }
    lap("stalePrune");

    for (const snapshot of pendingSnapshots) {
      try {
        const created = await maybeCreateArticleSnapshot(prisma, {
          ...snapshot,
          inboundCount: inboundCounts[snapshot.handle] ?? snapshot.inboundCount,
        });
        if (created) snapshotsCreated++;
      } catch (err) {
        errors.push(`article-snapshot:${snapshot.handle}: ${String(err)}`);
      }
    }
    lap("snapshotUpdate");
  } catch (err) {
    errors.push(`fetch: ${String(err)}`);
  }
  timings.total = Date.now() - tStart;

  const status: Extract<JobStatus, "success" | "partial" | "failed"> =
    errors.length === 0 ? "success" : indexed > 0 ? "partial" : "failed";

  await prisma.jobRun.update({
    where: { id: runId },
    data: {
      completedAt: new Date(),
      status,
      summary: {
        indexed,
        skipped,
        snapshotsCreated,
        linkEdgesWritten,
        staleArticlesPruned,
        staleLinkEdgesPruned,
        errors: errors.length,
      },
      errorLog: errors.length > 0 ? errors.join("\n").slice(0, 10_000) : null,
    },
  });

  return { jobName: "fetch-blog-content", runId, indexed, skipped, snapshotsCreated, errors, status, timings };
}
