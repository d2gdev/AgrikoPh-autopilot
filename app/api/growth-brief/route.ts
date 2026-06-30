export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getJobsStatusPayload } from "@/lib/dashboard/jobs-status";
import { fetchProductImages } from "@/lib/shopify-admin";

type BriefTone = "success" | "warning" | "critical" | "info";

type BriefItem = {
  id: string;
  title: string;
  description: string;
  source: string;
  priority: string;
  tone: BriefTone;
  href: string;
  meta: string[];
};

function priorityTone(priority: string | null | undefined): BriefTone {
  if (priority === "P0" || priority === "P1") return "critical";
  if (priority === "P2") return "warning";
  return "info";
}

function severityTone(severity: string | null | undefined): BriefTone {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  return "info";
}

function text(value: unknown, fallback = "Review item"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function dateLabel(value: Date | string | null | undefined): string {
  if (!value) return "unknown";
  const d = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(d.getTime())) return "unknown";
  return d.toISOString();
}

function asItem(input: {
  id: string;
  title: string;
  description: string;
  source: string;
  priority?: string | null;
  tone?: BriefTone;
  href: string;
  meta?: string[];
}): BriefItem {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    source: input.source,
    priority: input.priority ?? "P3",
    tone: input.tone ?? priorityTone(input.priority),
    href: input.href,
    meta: input.meta ?? [],
  };
}

async function getImageSummary() {
  try {
    const images = await fetchProductImages();
    return {
      available: true,
      total: images.length,
      missingAltText: images.filter((image) => !image.altText).length,
      note: "Live Shopify product image read.",
    };
  } catch (err) {
    console.warn("[growth-brief] image summary unavailable:", err);
    return {
      available: false,
      total: 0,
      missingAltText: 0,
      note: "Image summary unavailable. Check Shopify Admin credentials.",
    };
  }
}

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const [
      jobs,
      storeTasks,
      contentProposals,
      recommendations,
      hardBlockedRecommendations,
      openOpportunities,
      marketInsights,
      imageSummary,
      latestSeoSnapshot,
      latestGscQuery,
      latestPageAnalytics,
    ] = await Promise.all([
      getJobsStatusPayload(),
      prisma.storeTask.findMany({
        where: { status: "pending" },
        orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
        take: 8,
      }),
      prisma.contentProposal.findMany({
        where: { status: "pending" },
        orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
        take: 8,
      }),
      prisma.recommendation.findMany({
        where: { status: "pending", guardStatus: { not: "hard_block" } },
        orderBy: [{ guardStatus: "desc" }, { createdAt: "desc" }],
        take: 8,
        select: {
          id: true,
          platform: true,
          skillName: true,
          actionType: true,
          targetEntityName: true,
          rationale: true,
          estimatedImpact: true,
          guardStatus: true,
          guardReason: true,
          confidenceScore: true,
          createdAt: true,
        },
      }),
      prisma.recommendation.findMany({
        where: { status: "pending", guardStatus: "hard_block" },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          platform: true,
          skillName: true,
          actionType: true,
          targetEntityName: true,
          rationale: true,
          guardStatus: true,
          guardReason: true,
          createdAt: true,
        },
      }),
      prisma.opportunity.findMany({
        where: { status: "open" },
        orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
        take: 8,
      }),
      prisma.marketInsight.findMany({
        where: { status: "open" },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 8,
      }),
      getImageSummary(),
      prisma.rawSnapshot.findFirst({
        where: { source: "seo" },
        orderBy: { fetchedAt: "desc" },
        select: { fetchedAt: true },
      }),
      prisma.gscQuery.findFirst({
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true },
      }),
      prisma.pageAnalytics.findFirst({
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true },
      }),
    ]);

    const needsAttention: BriefItem[] = [];
    const readyToApprove: BriefItem[] = [];
    const quickWins: BriefItem[] = [];

    for (const job of jobs.perJobHealth) {
      const severity = text(job.severity, "info");
      if (severity === "critical" || severity === "warning") {
        needsAttention.push(asItem({
          id: `job:${text(job.jobName)}`,
          title: `${text(job.label, text(job.jobName))}: ${text(job.healthStatus, "check status")}`,
          description: text(job.healthReason, "Job health needs review."),
          source: "Jobs",
          priority: severity === "critical" ? "P1" : "P2",
          tone: severityTone(severity),
          href: "/",
          meta: [
            `Last status: ${text(job.lastStatus, "none")}`,
            `Last success: ${text(job.lastSuccessAt, "none")}`,
          ],
        }));
      }
    }

    for (const rec of hardBlockedRecommendations) {
      needsAttention.push(asItem({
        id: `hard-block:${rec.id}`,
        title: `Hard-blocked ${rec.platform} recommendation`,
        description: rec.guardReason ?? rec.rationale,
        source: "Ad Pilot",
        priority: "P1",
        tone: "critical",
        href: "/recommendations",
        meta: [rec.skillName, rec.targetEntityName, rec.actionType],
      }));
    }

    if (imageSummary.available && imageSummary.missingAltText > 0) {
      needsAttention.push(asItem({
        id: "images:missing-alt",
        title: `${imageSummary.missingAltText} product images missing alt text`,
        description: "Generate/review alt text before treating image SEO as complete.",
        source: "Store Pilot",
        priority: imageSummary.missingAltText >= 10 ? "P2" : "P3",
        tone: imageSummary.missingAltText >= 10 ? "warning" : "info",
        href: "/images",
        meta: [`${imageSummary.total} total images`, imageSummary.note],
      }));
    } else if (!imageSummary.available) {
      needsAttention.push(asItem({
        id: "images:unavailable",
        title: "Image status unavailable",
        description: imageSummary.note,
        source: "Store Pilot",
        priority: "P2",
        tone: "warning",
        href: "/settings",
      }));
    }

    for (const task of storeTasks) {
      const item = asItem({
        id: `store-task:${task.id}`,
        title: task.title,
        description: task.description,
        source: "Store Pilot",
        priority: task.priority,
        href: "/store-pilot",
        meta: [task.taskType, task.targetType, task.targetUrl ?? task.targetId ?? ""].filter(Boolean),
      });
      if (item.tone === "critical" || item.tone === "warning") needsAttention.push(item);
      else quickWins.push(item);
    }

    for (const proposal of contentProposals) {
      readyToApprove.push(asItem({
        id: `content:${proposal.id}`,
        title: proposal.title,
        description: proposal.description,
        source: "Content Pilot",
        priority: proposal.priority,
        href: "/content-pilot",
        meta: [proposal.proposalType, proposal.changeType, proposal.articleHandle ?? "new content"],
      }));
    }

    for (const rec of recommendations) {
      const tone = rec.guardStatus === "hard_block"
        ? "critical"
        : rec.guardStatus === "soft_flag"
        ? "warning"
        : "info";
      readyToApprove.push(asItem({
        id: `recommendation:${rec.id}`,
        title: `${rec.actionType.replace(/_/g, " ")}: ${rec.targetEntityName}`,
        description: rec.rationale,
        source: "Ad Pilot",
        priority: tone === "critical" ? "P1" : tone === "warning" ? "P2" : "P3",
        tone,
        href: "/recommendations",
        meta: [
          rec.platform,
          rec.skillName,
          rec.estimatedImpact ?? "impact not estimated",
          rec.confidenceScore == null ? "" : `${Math.round(rec.confidenceScore * 100)}% confidence`,
        ].filter(Boolean),
      }));
    }

    for (const insight of marketInsights) {
      const item = asItem({
        id: `market:${insight.id}`,
        title: insight.title,
        description: insight.summary,
        source: "Market Intelligence",
        priority: insight.severity === "critical" ? "P1" : insight.severity === "warning" ? "P2" : "P3",
        tone: severityTone(insight.severity),
        href: "/market-intelligence",
        meta: [insight.type, `Created ${dateLabel(insight.createdAt)}`],
      });
      if (item.tone === "critical" || item.tone === "warning") needsAttention.push(item);
      else quickWins.push(item);
    }

    for (const opportunity of openOpportunities) {
      const action = opportunity.proposedAction as Record<string, unknown>;
      quickWins.push(asItem({
        id: `opportunity:${opportunity.id}`,
        title: text(action.title, opportunity.targetName ?? opportunity.type),
        description: text(action.description, `Review ${opportunity.type} opportunity.`),
        source: opportunity.source,
        priority: opportunity.priority,
        href: opportunity.targetType === "article" ? "/content-pilot" : "/store-pilot",
        meta: [
          opportunity.type,
          `Score ${Math.round(opportunity.score)}`,
          opportunity.impact ?? "",
          opportunity.effort ?? "",
        ].filter(Boolean),
      }));
    }

    const sortedNeedsAttention = needsAttention
      .sort((a, b) => (a.priority > b.priority ? 1 : -1))
      .slice(0, 10);
    const sortedReady = readyToApprove
      .sort((a, b) => (a.priority > b.priority ? 1 : -1))
      .slice(0, 10);
    const sortedQuickWins = quickWins
      .sort((a, b) => (a.priority > b.priority ? 1 : -1))
      .slice(0, 10);

    const nextAction = sortedNeedsAttention[0]
      ?? sortedReady[0]
      ?? sortedQuickWins[0]
      ?? null;

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      summary: {
        status: sortedNeedsAttention.length > 0 ? "needs_attention" : "ok",
        needsAttentionCount: sortedNeedsAttention.length,
        readyToApproveCount: sortedReady.length,
        quickWinCount: sortedQuickWins.length,
        pendingStoreTasks: storeTasks.length,
        pendingContentProposals: contentProposals.length,
        pendingRecommendations: recommendations.length,
        openMarketInsights: marketInsights.length,
        openOpportunities: openOpportunities.length,
        imageMissingAltText: imageSummary.missingAltText,
      },
      dataQuality: {
        seoSnapshotFetchedAt: latestSeoSnapshot?.fetchedAt?.toISOString() ?? null,
        gscCapturedAt: latestGscQuery?.capturedAt?.toISOString() ?? null,
        ga4CapturedAt: latestPageAnalytics?.capturedAt?.toISOString() ?? null,
        imageSummary,
        jobHealth: jobs.perJobHealth.map((job) => ({
          jobName: job.jobName,
          label: job.label,
          severity: job.severity,
          healthStatus: job.healthStatus,
          healthReason: job.healthReason,
          lastSuccessAt: job.lastSuccessAt,
          lastStatus: job.lastStatus,
        })),
        caveats: [
          "Growth Brief is read-only.",
          "Market Intelligence is advisory.",
          "Image alt text is generated/reviewed manually unless write-back is separately approved.",
        ],
      },
      sections: {
        needsAttention: sortedNeedsAttention,
        readyToApprove: sortedReady,
        quickWins: sortedQuickWins,
      },
      nextAction,
    });
  } catch (err) {
    console.error("[growth-brief] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
