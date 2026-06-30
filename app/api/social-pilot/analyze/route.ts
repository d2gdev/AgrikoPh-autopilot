export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionShop, getSessionUser, requireAppAuth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAiClient } from "@/lib/ai/client";

const sanitize = (s: string) => s.replace(/[<>"]/g, "").slice(0, 300);

const PostInputSchema = z.object({
  message: z.string().max(500).transform(sanitize).optional(),
  platform: z.string().max(50).optional(),
  likes: z.number().optional(),
  comments: z.number().optional(),
  shares: z.number().optional(),
  reach: z.number().optional(),
}).passthrough();

const SocialRequestSchema = z.object({
  posts: z.array(PostInputSchema).max(50),
});

const SocialAnalysisSchema = z.object({
  summary: z.string().max(1000).optional(),
  bestContentType: z.string().max(1000).optional(),
  bestTime: z.string().max(500).optional(),
  recommendations: z.array(z.string().max(1000)).max(10).optional(),
}).passthrough();

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const actor = await getSessionShop(req) ?? await getSessionUser(req) ?? "embedded-app";
  if (!checkRateLimit(`social-analyze:${actor}`, 5, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 5 analyses per minute" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = SocialRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { posts } = parsed.data;

  if (posts.length === 0) {
    return NextResponse.json({ error: "No post data provided" }, { status: 400 });
  }

  const postSummary = posts.slice(0, 30).map((p: Record<string, unknown>) => ({
    caption: typeof p.message === "string" ? p.message.slice(0, 120) : null,
    createdTime: p.createdTime,
    likes: p.likes,
    comments: p.comments,
    shares: p.shares,
    totalEngagement: (p.likes as number ?? 0) + (p.comments as number ?? 0) + (p.shares as number ?? 0),
  }));

  try {
    const ai = await getAiClient({
      deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
      openRouterModel: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4-6",
    });
    const response = await ai.client.chat.completions.create({
      model: ai.model,
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: `You are a social media strategist for Agriko (agrikoph.com), a Philippine health food brand.
Analyze Facebook organic post performance and provide actionable content strategy insights.
Format your response as a JSON object with this exact shape:
{
  "summary": "2-sentence overall performance summary",
  "bestContentType": "describe what type of content performs best and why",
  "bestTime": "best day/time pattern observed from the data",
  "recommendations": [
    "Specific content recommendation 1",
    "Specific content recommendation 2",
    "Specific content recommendation 3"
  ]
}`,
        },
        {
          role: "user",
          content: `Analyze these Facebook posts for Agriko:\n\`\`\`json\n${JSON.stringify(postSummary, null, 2)}\n\`\`\``,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let analysisData: unknown;
    try {
      analysisData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      console.error("[social-pilot/analyze] LLM returned invalid JSON:", raw?.slice(0, 200));
      return NextResponse.json({ error: "AI returned invalid response" }, { status: 502 });
    }
    if (!analysisData || typeof analysisData !== "object" || Array.isArray(analysisData)) {
      return NextResponse.json({ error: "AI returned unexpected format" }, { status: 502 });
    }
    const analysis = SocialAnalysisSchema.safeParse(analysisData);
    if (!analysis.success) {
      console.error("[social-pilot/analyze] LLM returned invalid shape:", analysis.error.flatten());
      return NextResponse.json({ error: "AI returned unexpected format" }, { status: 502 });
    }

    return NextResponse.json({ analysis: analysis.data });
  } catch (err) {
    console.error("[social-pilot/analyze]", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
