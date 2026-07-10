export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const keywordSchema = z.object({
  keyword: z.string().trim().min(1),
  category: z.string().trim().optional().nullable(),
  locationName: z.string().trim().optional().nullable(),
  languageCode: z.string().trim().min(2).max(8).optional().nullable(),
});

const competitorPageSchema = z.object({
  name: z.string().trim().min(1),
  domain: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  pages: z.array(z.object({
    platform: z.string().trim().min(1).default("facebook"),
    pageName: z.string().trim().min(1),
    pageId: z.string().trim().optional().nullable().transform((value) => value?.trim() || null),
    pageUrl: z.string().trim().optional().nullable(),
  })).optional().default([]).superRefine((pages, ctx) => {
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      if (!page) continue;

      const platform = page.platform.toLowerCase();
      if (["facebook", "instagram", "meta", "meta_keyword"].includes(platform) && !page.pageId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pages", index, "pageId"],
          message: `pageId is required for ${platform} pages.`,
        });
      }

      if (page.pageId && !/^\d+$/.test(page.pageId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pages", index, "pageId"],
          message: "pageId must be a numeric Meta page id.",
        });
      }
    }
  }),
});

const bodySchema = z.object({
  keywords: z.array(keywordSchema).optional().default([]),
  competitors: z.array(competitorPageSchema).optional().default([]),
});

function buildSocialPageIdentity(input: {
  platform: string;
  competitorId: string;
  pageId: string | null;
  pageName: string;
}): string {
  const platform = input.platform.toLowerCase();
  if (input.pageId) {
    return `${platform}|${input.pageId}`;
  }
  return `${platform}|${input.competitorId}|${input.pageName.trim()}`;
}

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const [keywords, competitors] = await Promise.all([
      prisma.marketKeyword.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.competitor.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { socialPages: { orderBy: { createdAt: "desc" } } },
      }),
    ]);

    return NextResponse.json({ keywords, competitors });
  } catch (err) {
    // Return a JSON error body so the client surfaces the cause instead of
    // failing on an empty-body 500.
    console.error("[market-intelligence/config] GET failed:", err);
    return NextResponse.json({ error: "Failed to load configuration" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  // Parse defensively: a malformed/empty body would otherwise throw here —
  // outside the try below — and surface as an empty-body 500 the client can't
  // read ("Unexpected end of JSON input") instead of a clear 400.
  const rawBody = await req.json().catch(() => null);
  if (rawBody === null) {
    return NextResponse.json({ error: "Invalid or empty JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const created = { keywords: 0, competitors: 0, pages: 0 };

  try {
    for (const keyword of parsed.data.keywords) {
      const locationName = keyword.locationName ?? process.env.MARKET_INTEL_DEFAULT_LOCATION ?? "Philippines";
      const languageCode = keyword.languageCode ?? "en";
      const identity = {
        keyword: keyword.keyword.trim(),
        locationName: locationName.trim() || null,
        languageCode: languageCode.trim().toLowerCase(),
      };
      const existing = await prisma.marketKeyword.findFirst({
        where: {
          keyword: identity.keyword,
          locationName: identity.locationName,
          languageCode: identity.languageCode,
        },
      });
      if (existing) {
        await prisma.marketKeyword.update({
          where: { id: existing.id },
          data: { category: keyword.category, active: true },
        });
      } else {
        try {
          await prisma.marketKeyword.create({
            data: { ...identity, category: keyword.category },
          });
        } catch (error: unknown) {
          if ((error as { code?: string }).code !== "P2002") throw error;
          const raced = await prisma.marketKeyword.findFirst({ where: identity });
          if (!raced) throw error;
          await prisma.marketKeyword.update({
            where: { id: raced.id },
            data: { category: keyword.category, active: true },
          });
        }
      }
      created.keywords++;
    }

    for (const competitorInput of parsed.data.competitors) {
      const competitor = await prisma.competitor.upsert({
        where: { name: competitorInput.name },
        create: {
          name: competitorInput.name,
          domain: competitorInput.domain,
          notes: competitorInput.notes,
        },
        update: {
          domain: competitorInput.domain,
          notes: competitorInput.notes,
          active: true,
        },
      });
      created.competitors++;

      for (const page of competitorInput.pages) {
        const normalizedPage = {
          platform: page.platform.toLowerCase(),
          pageName: page.pageName,
          pageId: page.pageId,
          pageUrl: page.pageUrl,
        };
        const identityKey = buildSocialPageIdentity({
          platform: normalizedPage.platform,
          competitorId: competitor.id,
          pageId: normalizedPage.pageId,
          pageName: normalizedPage.pageName,
        });

        // Upsert directly on identityKey (unique) instead of find-then-create/update:
        // the prior check-then-write left a window where two concurrent identical
        // submissions could both pass the "not found" check and both attempt create,
        // throwing an uncaught P2002 unique-constraint violation.
        await prisma.competitorSocialPage.upsert({
          where: { identityKey },
          create: {
            competitorId: competitor.id,
            platform: normalizedPage.platform,
            pageName: normalizedPage.pageName,
            pageId: normalizedPage.pageId,
            pageUrl: normalizedPage.pageUrl,
            identityKey,
          },
          update: {
            competitorId: competitor.id,
            pageName: normalizedPage.pageName,
            pageUrl: normalizedPage.pageUrl,
            active: true,
            ...(normalizedPage.pageId ? { pageId: normalizedPage.pageId } : {}),
          },
        });
        created.pages++;
      }
    }

    return NextResponse.json({ ok: true, created });
  } catch (err) {
    console.error("[market-intelligence/config] save failed:", err);
    return NextResponse.json(
      { error: "Failed to save configuration", partial: created },
      { status: 500 },
    );
  }
}
