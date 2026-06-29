export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchProductImages } from "@/lib/shopify-admin";
import { getSessionShop } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import OpenAI from "openai";

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

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultHeaders: {
    "HTTP-Referer": "https://agrikoph.com",
    "X-Title": "Agriko Autopilot",
  },
});

const AltTextInput = z.object({
  imageId: z.string().max(100),
  productId: z.string().max(100),
  imageUrl: z.string().url().max(500),
  productTitle: z.string().max(200),
});

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
  const shop = await getSessionShop(req);
  if (!shop) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const forceRefresh = new URL(req.url).searchParams.get("refresh") === "1";
    return NextResponse.json(await loadImagesPayload(forceRefresh));
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const shop = await getSessionShop(req);
  if (!shop) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!checkRateLimit(`alttext:${shop}`, 30, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded — max 30 alt-text generations per minute" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = AltTextInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { imageId, productId, imageUrl, productTitle } = parsed.data;

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4-6",
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

    const altText = (response.choices[0]?.message?.content ?? "").trim();
    return NextResponse.json({ altText, imageId, productId });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
