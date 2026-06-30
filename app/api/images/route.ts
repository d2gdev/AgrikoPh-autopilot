export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchProductImages } from "@/lib/shopify-admin";
import { getSessionShop, getSessionUser, requireAppAuth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAiClient } from "@/lib/ai/client";

type ImagesPayload = {
  images: Awaited<ReturnType<typeof fetchProductImages>>;
  total: number;
  missingAltText: number;
  cachedAt: string;
  cacheTtlMs: number;
};

const IMAGE_CACHE_TTL_MS = 60_000;

let imagesCache: { expiresAt: number; payload: ImagesPayload } | null = null;
let imagesInFlight: Promise<ImagesPayload> | null = null;

const AltTextInput = z.object({
  imageId: z.string().max(100),
  productId: z.string().max(100),
  imageUrl: z.string().url().max(500),
  productTitle: z.string().max(200),
});

const GeneratedAltTextSchema = z.string().trim().min(1).max(125);

function normalizeAltText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

async function loadImagesPayload(forceRefresh: boolean): Promise<ImagesPayload> {
  const now = Date.now();
  if (!forceRefresh && imagesCache && imagesCache.expiresAt > now) {
    return imagesCache.payload;
  }
  if (!forceRefresh && imagesInFlight) return imagesInFlight;

  const request = (async () => {
    const images = await fetchProductImages();
    const payload: ImagesPayload = {
      images,
      total: images.length,
      missingAltText: images.filter((i) => !i.altText).length,
      cachedAt: new Date().toISOString(),
      cacheTtlMs: IMAGE_CACHE_TTL_MS,
    };
    imagesCache = { expiresAt: Date.now() + IMAGE_CACHE_TTL_MS, payload };
    return payload;
  })();

  imagesInFlight = request;
  try {
    return await request;
  } finally {
    if (imagesInFlight === request) imagesInFlight = null;
  }
}

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const forceRefresh = new URL(req.url).searchParams.get("refresh") === "1";
    return NextResponse.json(await loadImagesPayload(forceRefresh));
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const actor = await getSessionShop(req) ?? await getSessionUser(req) ?? "embedded-app";
  if (!checkRateLimit(`alttext:${actor}`, 30, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded — max 30 alt-text generations per minute" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = AltTextInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { imageId, productId, imageUrl, productTitle } = parsed.data;

  try {
    const ai = await getAiClient({
      deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
      openRouterModel: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4-6",
    });
    const response = await ai.client.chat.completions.create({
      model: ai.model,
      max_tokens: 60,
      messages: [
        {
          role: "system",
          content:
            "You are an SEO copywriter for Agriko (agrikoph.com), a Philippine health food brand. Write concise, keyword-rich alt text.",
        },
        {
          role: "user",
          content: `Product: ${productTitle}\nImage URL: ${imageUrl}\nWrite alt text under 125 characters. Reply with ONLY the alt text, no quotes, no explanation.`,
        },
      ],
    });

    const altText = normalizeAltText(response.choices[0]?.message?.content ?? "");
    const validated = GeneratedAltTextSchema.safeParse(altText);
    if (!validated.success) {
      return NextResponse.json({ error: "AI returned invalid alt text" }, { status: 502 });
    }
    return NextResponse.json({ altText: validated.data, imageId, productId });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
