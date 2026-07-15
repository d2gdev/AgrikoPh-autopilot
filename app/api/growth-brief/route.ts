export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getJobsStatusPayload } from "@/lib/dashboard/jobs-status";
import { fetchProductImages } from "@/lib/shopify-admin";
import { imageAltHealth } from "@/lib/image-alt-health";
import { priorityRank } from "@/lib/growth-brief/priority";

type BriefTone = "success" | "warning" | "critical" | "info";

type BriefItem = {
  id: string;
  title: string;
  description: string;
  source: string;
  priority: string;
  sortPriority?: string;
  tone: BriefTone;
  href: string;
  meta: string[];
  sortScore?: number;
};

type RunSkillsDiagnostics = {
  status: string | null;
  completedAt: string | null;
  unavailableSources: string[];
  unavailableSkillCount: number;
  unavailableSkillDetails: string[];
};

const SECTION_LIMIT = 10;
const QUEUE_OVERFETCH = 32;
const CACHE_TTL_MS = 60_000;
let cachedBrief: { expiresAt: number; payload: unknown } | null = null;
let briefInFlight: Promise<unknown> | null = null;
let cacheVersion = 0;

function priorityTone(priority: string | null | undefined): BriefTone {
  const rank = priorityRank(priority);
  if (rank <= 1) return "critical";
  if (rank === 2) return "warning";
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  sortPriority?: string | null;
  tone?: BriefTone;
  href: string;
  meta?: string[];
  sortScore?: number | null;
}): BriefItem {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    source: input.source,
    priority: input.priority ?? "P3",
    sortPriority: input.sortPriority ?? input.priority ?? "P3",
    tone: input.tone ?? priorityTone(input.priority),
    href: input.href,
    meta: input.meta ?? [],
    sortScore: input.sortScore ?? undefined,
  };
}

function evidenceMeta(input: {
  score?: unknown;
  impact?: unknown;
  effort?: unknown;
  extra?: Array<string | null | undefined>;
}): string[] {
  return [
    numberValue(input.score) == null ? "" : `Score ${Math.round(numberValue(input.score) ?? 0)}`,
    typeof input.impact === "string" && input.impact.trim() ? `Impact ${input.impact}` : "",
    typeof input.effort === "string" && input.effort.trim() ? `Effort ${input.effort}` : "",
    ...(input.extra ?? []),
  ].filter(Boolean) as string[];
}

function contentProposalNeedsEvidenceReview(proposal: {
  proposalType: string;
  sourceData: unknown;
}): boolean {
  if (proposal.proposalType !== "new-content") return false;
  const sourceData = asRecord(proposal.sourceData);
  const impressions = numberValue(sourceData.impressions);
  if (impressions != null && impressions < 50) return true;
  return typeof sourceData.insightId === "string" || typeof sourceData.marketInsightId === "string";
}

function contentOpportunityNeedsEvidenceReview(opportunity: { type: string; source: string; evidence: unknown }): boolean {
  if (opportunity.source !== "content-pilot") return false;
  const evidence = asRecord(opportunity.evidence);
  if (opportunity.type === "content_gap") {
    if (typeof evidence.insightId === "string" || typeof evidence.marketInsightId === "string") return true;
    const impressions = numberValue(evidence.impressions);
    return impressions != null && impressions < 50;
  }
  if (opportunity.type === "ctr_gap") {
    const impressions = numberValue(evidence.impressions);
    return impressions == null || impressions < 50;
  }
  return false;
}

function normalizedWorkTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function compareBriefItems(a: BriefItem, b: BriefItem): number {
  return priorityRank(a.sortPriority ?? a.priority) - priorityRank(b.sortPriority ?? b.priority)
    || (b.sortScore ?? 0) - (a.sortScore ?? 0);
}

function summarizeRunSkills(
  job: { status: string; completedAt: Date | null; summary: unknown } | null,
): RunSkillsDiagnostics {
  const summary = asRecord(job?.summary);
  const sourceStatus = asRecord(summary.sourceStatus);
  const unavailableSources = Object.entries(sourceStatus)
    .flatMap(([source, value]) => {
      const state = asRecord(value).state;
      return state === "missing" || state === "stale" || state === "error" || state === "disabled"
        ? [source]
        : [];
    });
  const skillsUnavailable = Array.isArray(summary.skillsUnavailable)
    ? summary.skillsUnavailable.map((entry) => asRecord(entry))
    : [];

  return {
    status: job?.status ?? null,
    completedAt: job?.completedAt?.toISOString() ?? null,
    unavailableSources,
    unavailableSkillCount: skillsUnavailable.length,
    unavailableSkillDetails: skillsUnavailable.slice(0, 3).map((entry) => {
      const skillId = text(entry.skillId, "unknown-skill");
      const missing = Array.isArray(entry.missingRequiredSources)
        ? entry.missingRequiredSources.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const stale = Array.isArray(entry.staleRequiredSources)
        ? entry.staleRequiredSources.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const parts = [
        missing.length > 0 ? `missing ${missing.join(", ")}` : "",
        stale.length > 0 ? `stale ${stale.join(", ")}` : "",
      ].filter(Boolean);
      return `${skillId}: ${parts.join("; ") || text(entry.reason, "unavailable")}`;
    }),
  };
}

async function getImageSummary() {
  try {
    const images = await fetchProductImages();
    const health = imageAltHealth(images);
    return {
      available: true,
      total: images.length,
      missingAltText: health.missing,
      needsReview: health.needsReview,
      needsAttention: health.missing + health.needsReview,
      note: "Live Shopify product image read.",
    };
  } catch (err) {
    console.warn("[growth-brief] image summary unavailable:", err);
    return {
      available: false,
      total: 0,
      missingAltText: 0,
      needsReview: 0,
      needsAttention: 0,
      note: "Image summary unavailable. Check Shopify Admin credentials.",
    };
  }
}

async function buildGrowthBrief() {
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
      latestRunSkills,
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
        take: QUEUE_OVERFETCH,
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
        take: QUEUE_OVERFETCH,
      }),
      prisma.marketInsight.findMany({
        where: { status: "open" },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 8,
      }),
      getImageSummary(),
      prisma.rawSnapshot.findFirst({
        where: { source: "seo_analysis" },
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
      prisma.jobRun.findFirst({
        where: { jobName: "run-skills" },
        orderBy: { startedAt: "desc" },
        select: { status: true, completedAt: true, summary: true },
      }),
    ]);

    const needsAttention: BriefItem[] = [];
    const readyToApprove: BriefItem[] = [];
    const quickWins: BriefItem[] = [];
    const queuedContentTitles = new Set(contentProposals.map((proposal) => normalizedWorkTitle(proposal.title)));

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

    if (imageSummary.available && imageSummary.needsAttention > 0) {
      needsAttention.push(asItem({
        id: "images:missing-alt",
        title: `${imageSummary.needsAttention} product images need alt-text attention`,
        description: "Generate/review alt text before treating image SEO as complete.",
        source: "Store Pilot",
        priority: imageSummary.needsAttention >= 10 ? "P2" : "P3",
        tone: imageSummary.needsAttention >= 10 ? "warning" : "info",
        href: "/images",
        meta: [`${imageSummary.missingAltText} missing`, `${imageSummary.needsReview} need review`, `${imageSummary.total} total images`, imageSummary.note],
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
      const proposalSourceData = asRecord(proposal.sourceData);
      const organicPriority = asRecord(proposalSourceData.organicPriority);
      const organicPriorityValue =
        typeof organicPriority.priority === "string" && organicPriority.priority.trim()
          ? organicPriority.priority
          : null;
      const proposalScore = numberValue(organicPriority.score);
      if (contentProposalNeedsEvidenceReview(proposal)) {
        needsAttention.push(asItem({
          id: `content-review:${proposal.id}`,
          title: `Verify content proposal evidence — ${proposal.title}`,
          description: "This proposal is not backed by sufficient first-party GSC evidence and cannot be approved from Growth Brief.",
          source: "Content Pilot",
          priority: "P2",
          tone: "warning",
          href: "/content-pilot",
          meta: evidenceMeta({
            score: proposalScore,
            extra: [proposal.proposalType, "evidence review required"],
          }),
          sortScore: proposalScore,
        }));
        continue;
      }
      readyToApprove.push(asItem({
        id: `content:${proposal.id}`,
        title: proposal.title,
        description: proposal.description,
        source: "Content Pilot",
        priority: proposal.priority,
        sortPriority: organicPriorityValue ?? proposal.priority,
        href: "/content-pilot",
        meta: evidenceMeta({
          score: proposalScore,
          impact: organicPriority.impact,
          effort: organicPriority.effort,
          extra: [proposal.proposalType, proposal.changeType, proposal.articleHandle ?? "new content"],
        }),
        sortScore: proposalScore,
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
      const actionTitle = text(action.title, opportunity.targetName ?? opportunity.type);
      if (opportunity.source === "content-pilot" && queuedContentTitles.has(normalizedWorkTitle(actionTitle))) {
        continue;
      }
      if (contentOpportunityNeedsEvidenceReview(opportunity)) {
        needsAttention.push(asItem({
          id: `opportunity-review:${opportunity.id}`,
          title: `Verify content opportunity evidence — ${text(action.title, opportunity.targetName ?? opportunity.type)}`,
          description: "This opportunity is not backed by sufficient first-party GSC evidence and cannot be approved as a quick win.",
          source: "Content Pilot",
          priority: "P2",
          tone: "warning",
          href: "/content-pilot",
          meta: evidenceMeta({ score: opportunity.score, extra: [opportunity.type, "evidence review required"] }),
          sortScore: opportunity.score,
        }));
        continue;
      }
      if (opportunity.effort?.toLowerCase() !== "low") continue;
      quickWins.push(asItem({
        id: `opportunity:${opportunity.id}`,
        title: actionTitle,
        description: text(action.description, `Review ${opportunity.type} opportunity.`),
        source: opportunity.source,
        priority: opportunity.priority,
        href: opportunity.targetType === "article" ? "/content-pilot" : "/store-pilot",
        meta: evidenceMeta({
          score: opportunity.score,
          impact: opportunity.impact,
          effort: opportunity.effort,
          extra: [opportunity.type],
        }),
        sortScore: opportunity.score,
      }));
    }

    const sortedNeedsAttention = needsAttention
      .sort(compareBriefItems)
      .slice(0, SECTION_LIMIT);
    const sortedReady = readyToApprove
      .sort(compareBriefItems)
      .slice(0, SECTION_LIMIT);
    const sortedQuickWins = quickWins
      .sort(compareBriefItems)
      .slice(0, SECTION_LIMIT);
    const runSkills = summarizeRunSkills(latestRunSkills);

    const nextAction = sortedNeedsAttention[0]
      ?? sortedReady[0]
      ?? sortedQuickWins[0]
      ?? null;

    return {
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
        imageNeedsAttention: imageSummary.needsAttention,
      },
      dataQuality: {
        seoSnapshotFetchedAt: latestSeoSnapshot?.fetchedAt?.toISOString() ?? null,
        gscCapturedAt: latestGscQuery?.capturedAt?.toISOString() ?? null,
        ga4CapturedAt: latestPageAnalytics?.capturedAt?.toISOString() ?? null,
        imageSummary,
        runSkills,
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
    };
  } catch (err) {
    console.error("[growth-brief] error:", err);
    throw err;
  }
}

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const forceRefresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (!forceRefresh && cachedBrief && cachedBrief.expiresAt > Date.now()) return NextResponse.json(cachedBrief.payload);
  if (forceRefresh) {
    const refreshVersion = ++cacheVersion;
    try {
      const payload = await buildGrowthBrief();
      if (refreshVersion === cacheVersion) cachedBrief = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
      return NextResponse.json(payload);
    } catch {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }
  if (!briefInFlight) {
    const buildVersion = ++cacheVersion;
    briefInFlight = buildGrowthBrief()
      .then((payload) => {
        if (buildVersion === cacheVersion) cachedBrief = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
        return payload;
      })
      .finally(() => { briefInFlight = null; });
  }
  try {
    return NextResponse.json(await briefInFlight);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
