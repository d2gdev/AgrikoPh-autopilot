export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAppAuth, getSessionUser, PERMISSIONS, requirePermission } from "@/lib/auth";

const KEY = "BRAND_GUIDELINES";

const DEFAULT_GUIDELINES = `FOLLOW THIS WRITING STYLE:

- Use clear, simple language.
- Be spartan and informative.
- Use short, impactful sentences.
- Use active voice; avoid passive voice.
- Focus on practical, actionable insights.
- Use bullet point lists in social media posts.
- Use data and examples to support claims when possible.
- Use "you" and "your" to directly address the reader.
- AVOID using em dashes anywhere. Use only commas, periods, or other standard punctuation. If you need to connect ideas, use a period or semicolon, never an em dash.
- AVOID constructions like "not just this, but also this".
- AVOID metaphors and clichés.
- AVOID generalizations.
- AVOID common setup language including: in conclusion, in closing, etc.
- AVOID output warnings or notes, just the output requested.
- AVOID unnecessary adjectives and adverbs.
- AVOID hashtags.
- AVOID semicolons.
- AVOID markdown.
- AVOID asterisks.
- AVOID these words: can, may, just, that, very, really, literally, actually, certainly, probably, basically, could, maybe, delve, embark, enlightening, esteemed, shed light, craft, crafting, imagine, realm, game-changer, unlock, discover, skyrocket, abyss, not alone, in a world where, revolutionize, disruptive, utilize, utilizing, dive deep, tapestry, illuminate, unveil, pivotal, intricate, elucidate, hence, furthermore, however, harness, exciting, groundbreaking, cutting-edge, remarkable, it remains to be seen, glimpse into, navigating, landscape, stark, testament, in summary, in conclusion, moreover, boost, skyrocketing, opened up, powerful, inquiries, ever-evolving`;

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  let row = await prisma.guardrailConfig.findUnique({ where: { key: KEY } });
  if (!row) {
    row = await prisma.guardrailConfig.create({
      data: { key: KEY, value: DEFAULT_GUIDELINES, label: "Brand & Writing Guidelines", valueType: "text" },
    });
  }
  return NextResponse.json({ guidelines: row.value });
}

export async function PUT(req: NextRequest) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const authError = await requirePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (authError) return authError;

  const body = await req.json().catch(() => ({}));
  const guidelines = typeof body.guidelines === "string" ? body.guidelines : "";

  await prisma.guardrailConfig.upsert({
    where: { key: KEY },
    update: { value: guidelines, updatedBy: (await getSessionUser(req)) ?? "operator" },
    create: { key: KEY, value: guidelines, valueType: "text", label: "Brand & Writing Guidelines", updatedBy: (await getSessionUser(req)) ?? "operator" },
  });

  return NextResponse.json({ ok: true });
}
