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

  const [keywords, competitors] = await Promise.all([
    prisma.marketKeyword.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.competitor.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { socialPages: { orderBy: { createdAt: "desc" } } },
    }),
  ]);

  return NextResponse.json({ keywords, competitors });
}

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const created = { keywords: 0, competitors: 0, pages: 0 };

  for (const keyword of parsed.data.keywords) {
    const locationName = keyword.locationName ?? process.env.MARKET_INTEL_DEFAULT_LOCATION ?? "Philippines";
    const languageCode = keyword.languageCode ?? "en";
    await prisma.marketKeyword.upsert({
      where: {
        keyword_locationName_languageCode: {
          keyword: keyword.keyword,
          locationName,
          languageCode,
        },
      },
      create: {
        keyword: keyword.keyword,
        category: keyword.category,
        locationName,
        languageCode,
      },
      update: {
        category: keyword.category,
        locationName,
        languageCode,
        active: true,
      },
    });
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

      const existingPage = await prisma.competitorSocialPage.findFirst({
        where: {
          platform: normalizedPage.platform,
          ...(normalizedPage.pageId
            ? { pageId: normalizedPage.pageId }
            : { pageName: normalizedPage.pageName, competitorId: competitor.id }),
        },
      });
      if (existingPage) {
        await prisma.competitorSocialPage.update({
          where: { id: existingPage.id },
          data: {
            competitorId: competitor.id,
            pageName: normalizedPage.pageName,
            pageUrl: normalizedPage.pageUrl,
            active: true,
            identityKey,
            ...(normalizedPage.pageId ? { pageId: normalizedPage.pageId } : {}),
          },
        });
      } else {
        await prisma.competitorSocialPage.create({
          data: {
            competitorId: competitor.id,
            platform: normalizedPage.platform,
            pageName: normalizedPage.pageName,
            pageId: normalizedPage.pageId,
            pageUrl: normalizedPage.pageUrl,
            identityKey,
          },
        });
      }
      created.pages++;
    }
  }

  return NextResponse.json({ ok: true, created });
}
