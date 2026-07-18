export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { getSessionUser, requireAppAuth } from "@/lib/auth";
import { verifySessionToken } from "@/lib/shopify";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";

const RESET_JOB_NAME = "market-intel-reset";
const MAINTENANCE_SECRET = process.env.MARKET_INTEL_RESET_MAINTENANCE_SECRET;
const RESET_CONFIRMATION_SECRET = process.env.MARKET_INTEL_RESET_CONFIRMATION;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_MINUTE = Math.max(
  1,
  Number(process.env.MARKET_INTEL_RESET_RATE_LIMIT_PER_MINUTE ?? 3),
);
const RESET_ALLOWED_SHOPS = new Set(
  (process.env.MARKET_INTEL_RESET_ALLOWED_SHOPS ?? "")
    .split(",")
    .map((value) => normalizeShopIdentifier(value))
    .filter((value): value is string => typeof value === "string" && value.length > 0),
);

function secureEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const expected = Buffer.from(a);
  const actual = Buffer.from(b);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function resolveSecret(request: Request): string | null {
  return request.headers.get("x-maintenance-secret");
}

function resolveConfirmation(request: Request): string | null {
  return request.headers.get("x-maintenance-confirm");
}

function hasResetCredentialsInQuery(request: Request): boolean {
  const searchParams = new URL(request.url).searchParams;
  return ["maintenanceSecret", "confirm", "token"].some((name) => searchParams.has(name));
}

function normalizeShopIdentifier(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.hostname;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").split("/")[0] ?? null;
  }
}

function normalizeActor(actor: string): string {
  return normalizeShopIdentifier(actor) ?? actor.toLowerCase();
}

function isAllowedResetShop(shop: string | null | undefined): boolean {
  if (RESET_ALLOWED_SHOPS.size === 0) return true;
  const normalized = normalizeShopIdentifier(shop);
  return normalized ? RESET_ALLOWED_SHOPS.has(normalized) : false;
}

function requestMeta(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = (forwardedFor?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
  return {
    ip,
    userAgent: req.headers.get("user-agent") ?? "unknown",
  };
}

async function logResetAttempt(params: {
  actor: string;
  request: Request;
  outcome: "rejected" | "failed";
  reason: string;
  meta?: Record<string, unknown>;
}) {
  const { actor, request, outcome, reason, meta } = params;
  const resolvedMeta = { ...requestMeta(request), reason, outcome, ...meta };
  try {
    await prisma.auditLog.create({
      data: {
        actor,
        action: "market_intelligence_reset_attempt",
        entityType: "MarketIntelligence",
        entityId: "all",
        before: { state: "attempt" },
        after: { state: outcome, reason },
        meta: resolvedMeta,
      },
    });
  } catch (error) {
    console.error("[market-intelligence] failed to write reset attempt audit log", error);
  }
}

// Destructive: clears captured Market Intelligence data so capture can start fresh.
// Keeps tracking config (competitors/keywords/pages) but deactivates the noisy
// Meta keyword-search source that pulls in unrelated spam "story" ads.
// Guarded by authenticated shop session + maintenance controls + explicit confirmation.
export async function POST(req: Request) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  // Fail fast outside maintenance mode.
  if (process.env.MARKET_INTEL_RESET_MAINTENANCE !== "true") {
    return NextResponse.json(
      { error: "Reset is disabled until maintenance mode is enabled." },
      { status: 423 },
    );
  }

  // Public API-key fallback is intentionally rejected for this destructive path.
  // Use the authenticated Shopify session instead.
  if (req.headers.get("x-autopilot-api-key")) {
    await logResetAttempt({
      actor: "unknown",
      request: req,
      outcome: "rejected",
      reason: "public_api_key_blocked",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (hasResetCredentialsInQuery(req)) {
    await logResetAttempt({
      actor: "unknown",
      request: req,
      outcome: "rejected",
      reason: "credentials_in_query",
    });
    return NextResponse.json(
      { error: "Reset credentials must be provided in headers." },
      { status: 400 },
    );
  }

  const shop = await verifySessionToken(req);
  if (!shop) {
    await logResetAttempt({
      actor: "unknown",
      request: req,
      outcome: "rejected",
      reason: "invalid_session",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actor = (await getSessionUser(req)) ?? shop;
  if (!isAllowedResetShop(shop)) {
    await logResetAttempt({
      actor,
      request: req,
      outcome: "rejected",
      reason: "shop_not_allowed",
      meta: { shop },
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkRateLimit(`market-intel-reset:${normalizeActor(actor)}`, RATE_LIMIT_PER_MINUTE, RATE_LIMIT_WINDOW_MS)) {
    await logResetAttempt({
      actor,
      request: req,
      outcome: "rejected",
      reason: "rate_limited",
      meta: { shop },
    });
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const providedSecret = resolveSecret(req);
  if (!secureEqual(MAINTENANCE_SECRET, providedSecret)) {
    await logResetAttempt({
      actor,
      request: req,
      outcome: "rejected",
      reason: "invalid_maintenance_secret",
      meta: { shop },
    });
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  // Outside production, when no confirmation secret is configured, accept the
  // literal string "clear-captures" as a convenience token — but only compare
  // against it, never against the unset env var directly, so the "expected"
  // hint below actually describes a value that works.
  const devFallbackConfirmation = process.env.NODE_ENV !== "production" ? "clear-captures" : null;
  const effectiveConfirmationSecret = RESET_CONFIRMATION_SECRET ?? devFallbackConfirmation;

  const providedConfirmation = resolveConfirmation(req);
  if (!secureEqual(effectiveConfirmationSecret, providedConfirmation)) {
    const expected = RESET_CONFIRMATION_SECRET ? "a server-provided confirmation token" : devFallbackConfirmation;
    await logResetAttempt({
      actor,
      request: req,
      outcome: "rejected",
      reason: "invalid_confirmation",
      meta: { shop },
    });
    return NextResponse.json(
      { error: "Invalid confirmation token", expected },
      { status: 400 },
    );
  }

  const ownerToken = randomUUID();
  const lockAcquired = await acquireJobLock(RESET_JOB_NAME, {
    ownerToken,
    ttlMs: 5 * 60_000,
  });
  if (!lockAcquired) {
    await logResetAttempt({
      actor,
      request: req,
      outcome: "rejected",
      reason: "already_running",
      meta: { shop },
    });
    return NextResponse.json(
      { error: "A reset is already in progress." },
      { status: 429 },
    );
  }

  try {
    const summary = await prisma.$transaction(async (tx) => {
      // Delete captures. MarketInsight.adId is SetNull so order is not strict, but
      // we remove insights first for clarity. Tracking config is left intact.
      const insights = await tx.marketInsight.deleteMany({});
      const adCaptures = await tx.competitorAdCapture.deleteMany({});
      const ads = await tx.competitorAd.deleteMany({});
      const priceHistory = await tx.shoppingPriceHistory.deleteMany({});
      const shopping = await tx.shoppingResult.deleteMany({});
      const keywordResearch = await tx.keywordResearchResult.deleteMany({});

      // Deactivate the Meta keyword-search source(s) that surface spam story ads,
      // so future captures only pull from real named competitor pages.
      const deactivatedPages = await tx.competitorSocialPage.updateMany({
        where: { platform: "meta_keyword" },
        data: { active: false },
      });
      const deactivatedCompetitors = await tx.competitor.updateMany({
        where: { name: { contains: "Keyword Search", mode: "insensitive" } },
        data: { active: false },
      });

      await tx.auditLog.create({
        data: {
          actor,
          action: "market_intelligence_reset",
          entityType: "MarketIntelligence",
          entityId: "all",
          before: { state: "captured_data_present" },
          after: {
            deleted: {
              insights: insights.count,
              competitorAdCaptures: adCaptures.count,
              competitorAds: ads.count,
              shoppingPriceHistory: priceHistory.count,
              shoppingResults: shopping.count,
              keywordResearch: keywordResearch.count,
            },
            deactivated: {
              metaKeywordPages: deactivatedPages.count,
              keywordSearchCompetitors: deactivatedCompetitors.count,
            },
          },
          meta: {
            maintenanceSecretUsed: !!MAINTENANCE_SECRET,
            ip: requestMeta(req).ip,
            userAgent: requestMeta(req).userAgent,
          },
        },
      });

      return {
        insights: insights.count,
        competitorAdCaptures: adCaptures.count,
        competitorAds: ads.count,
        shoppingPriceHistory: priceHistory.count,
        shoppingResults: shopping.count,
        keywordResearch: keywordResearch.count,
        metaKeywordPages: deactivatedPages.count,
        keywordSearchCompetitors: deactivatedCompetitors.count,
      };
    }, {
      // Six unbounded deleteMany() over the largest capture tables run serially
      // here; the default 5s interactive-transaction timeout aborts (P2028) on
      // large datasets — exactly the data this maintenance action must clear.
      timeout: 110_000,
    });

    return NextResponse.json({
      ok: true,
      deleted: {
        insights: summary.insights,
        competitorAdCaptures: summary.competitorAdCaptures,
        competitorAds: summary.competitorAds,
        shoppingPriceHistory: summary.shoppingPriceHistory,
        shoppingResults: summary.shoppingResults,
        keywordResearch: summary.keywordResearch,
      },
      deactivated: {
        metaKeywordPages: summary.metaKeywordPages,
        keywordSearchCompetitors: summary.keywordSearchCompetitors,
      },
    });
  } catch (error) {
    console.error("[market-intelligence] reset failed", error);
    await logResetAttempt({
      actor,
      request: req,
      outcome: "failed",
      reason: "transaction_failed",
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    await prisma.auditLog.create({
      data: {
        actor,
        action: "market_intelligence_reset_failed",
        entityType: "MarketIntelligence",
        entityId: "all",
        before: { state: "attempted" },
        after: { state: "failed" },
        meta: {
          error: error instanceof Error ? error.message : String(error),
          maintenanceSecretUsed: !!MAINTENANCE_SECRET,
          ip: requestMeta(req).ip,
          userAgent: requestMeta(req).userAgent,
        },
      },
    }).catch(() => {});
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reset failed" },
      { status: 500 },
    );
  } finally {
    await releaseJobLock(RESET_JOB_NAME, ownerToken);
  }
}
