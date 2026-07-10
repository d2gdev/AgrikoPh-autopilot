export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createContentProposalOnce } from "@/lib/content-pilot/create-proposal";
import { getSessionShop, getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { chatCompletionWithFailover } from "@/lib/ai/client";
import { parseJsonArray } from "@/lib/seo/ai-output";
import { classifyPriority } from "@/lib/content-pilot/priority-score";
import { hasMissingMeta } from "@/lib/seo/meta";
import {
  CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES,
  contentProposalDedupeKey,
} from "@/lib/content-pilot/proposal-dedupe";

const MAX_TASKS = 8;

const DecomposedTaskSchema = z.object({
  type: z.enum(["new-content", "internal-link", "content-refresh", "seo-fix"]),
  title: z.string().trim().min(1).max(180),
  targetKeyword: z.string().trim().max(160).optional(),
  idealWordCount: z.coerce.number().int().min(300).max(5_000).optional(),
  fromArticle: z.string().trim().max(180).optional(),
  toArticle: z.string().trim().max(180).optional(),
  suggestedAnchorText: z.string().trim().max(120).optional(),
  articleHandle: z.string().trim().max(180).optional(),
  targetWordCount: z.coerce.number().int().min(300).max(5_000).optional(),
  targetQuery: z.string().trim().max(160).optional(),
});
const DecomposedTasksSchema = z.array(DecomposedTaskSchema).max(MAX_TASKS * 2);
type DecomposedTask = z.infer<typeof DecomposedTaskSchema>;

export async function POST(req: NextRequest) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`seo-decompose:${actor}`, 8, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 8 decompositions per minute" }, { status: 429 });
  }

  let body: { recommendation?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const recommendation = typeof body.recommendation === "string" ? body.recommendation.trim() : "";
  if (!recommendation) {
    return NextResponse.json({ error: "No recommendation provided" }, { status: 400 });
  }

  const isBulkMeta =
    /meta\s*(title|description|tag)|title\s*tag/i.test(recommendation) &&
    /\ball\b|every|systematic|template|articles/i.test(recommendation);

  // Ground the AI in real articles so it can only reference handles that exist.
  const articleRecords = await prisma.articleRecord.findMany({
    select: { handle: true, title: true, wordCount: true, seoData: true },
    orderBy: { handle: "asc" },
    ...(isBulkMeta ? {} : { take: 200 }),
  });
  const handleSet = new Set(articleRecords.map((a) => a.handle));
  const wordCountByHandle = new Map(articleRecords.map((a) => [a.handle, a.wordCount ?? 0]));

  const rows: Array<Record<string, unknown>> = [];
  let dropped = 0;
  let capped = false;

  // A bulk meta strategy ("systematic meta titles/descriptions for all articles")
  // can't be expressed as a handful of AI tasks — fan out deterministically to
  // EVERY article currently missing meta, bypassing the AI cap.
  if (isBulkMeta) {
    for (const a of articleRecords) {
      if (!hasMissingMeta(a.seoData)) continue;
      rows.push({
        proposalType: "seo-fix",
        changeType: "update",
        articleHandle: a.handle,
        priority: classifyPriority(65),
        impact: "High",
        effort: "Low",
        title: `Fix meta: ${a.title}`,
        description: `From strategy: ${recommendation}`,
        proposedState: { articleHandle: a.handle, targetQuery: a.title },
        sourceData: { source: "seo-pilot-recommendation", strategy: recommendation },
      });
    }
  } else {
  // ── AI: decompose the strategy into concrete, typed tasks ──
  let tasks: DecomposedTask[] = [];
  try {
    const response = await chatCompletionWithFailover(
      {
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content: `You break an SEO strategy into concrete, individually-actionable tasks for Agriko (agrikoph.com), a Philippine health-food blog (organic rice, black rice, moringa, ginger, herbal superfoods).

Output ONLY a JSON array (no prose, no markdown) of at most ${MAX_TASKS} tasks. Each task is one of these shapes:

new-content (write a brand-new article):
{ "type": "new-content", "title": "<article title>", "targetKeyword": "<primary keyword>", "idealWordCount": 1200 }

internal-link (add a link from one existing article to another):
{ "type": "internal-link", "title": "<short description>", "fromArticle": "<existing-handle>", "toArticle": "<existing-handle>", "suggestedAnchorText": "<anchor text>" }

content-refresh (expand/improve an existing article):
{ "type": "content-refresh", "title": "<short description>", "articleHandle": "<existing-handle>", "targetWordCount": 1500 }

seo-fix (rewrite the meta title/description of an existing article):
{ "type": "seo-fix", "title": "<short description>", "articleHandle": "<existing-handle>", "targetQuery": "<primary keyword>" }

RULES:
- For internal-link, content-refresh and seo-fix you MUST use handles from the provided article list — never invent handles.
- Prefer the most specific, highest-leverage tasks. If a strategy is broad (e.g. "every article needs 3 internal links"), emit only the few most valuable concrete instances, not one per article.
- Keep titles concise and specific. Return [] if no concrete task applies.`,
          },
          {
            role: "user",
            content: `Strategy to decompose:
"${recommendation}"

Existing articles (handle — title — wordCount):
${articleRecords.slice(0, 120).map((a) => `${a.handle} — ${a.title} — ${a.wordCount ?? 0}w`).join("\n")}`,
          },
        ],
      },
      { deepseekModel: "deepseek-v4-pro", openRouterModel: "deepseek/deepseek-v4-pro", requestOptions: { signal: AbortSignal.timeout(25_000) } }
    );

    const rawContent = response.content ?? (response as unknown as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonArray(rawContent, DecomposedTasksSchema);
    if (!parsed.ok) return NextResponse.json({ error: "AI returned invalid structured output" }, { status: 502 });
    tasks = parsed.data;
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || /timeout/i.test(err.message))) return NextResponse.json({ error: "AI decomposition timed out" }, { status: 504 });
    const status = (err as { status?: number })?.status;
    if (status === 401 || status === 403 || status === 429 || status === 503 || (err instanceof Error && /(provider|api key|configured|authentication|unauthorized)/i.test(err.message))) return NextResponse.json({ error: "AI provider unavailable" }, { status: 503 });
    return NextResponse.json({ error: "AI decomposition failed. Please try again." }, { status: 502 });
  }

  // ── Validate + normalise into ContentProposal rows ──
  capped = tasks.length > MAX_TASKS;

  for (const task of tasks.slice(0, MAX_TASKS)) {
    if (!task || typeof task.title !== "string" || !task.title.trim()) { dropped++; continue; }
    const title = task.title.trim();

    if (task.type === "new-content") {
      rows.push({
        proposalType: "new-content",
        changeType: "new_article",
        articleHandle: null,
        priority: classifyPriority(60),
        impact: "Medium",
        effort: "High",
        title,
        description: `From strategy: ${recommendation}`,
        proposedState: {
          title,
          suggestedTitle: title,
          targetKeyword: task.targetKeyword ?? title,
          idealWordCount: task.idealWordCount ?? 1200,
        },
        sourceData: { source: "seo-pilot-recommendation", strategy: recommendation },
      });
    } else if (task.type === "internal-link") {
      // Both endpoints must be real articles, or the draft generator can't act on it.
      if (!task.fromArticle || !task.toArticle || !handleSet.has(task.fromArticle) || !handleSet.has(task.toArticle)) {
        dropped++; continue;
      }
      rows.push({
        proposalType: "internal-link",
        changeType: "internal_link",
        articleHandle: task.fromArticle,
        priority: classifyPriority(50),
        impact: "Medium",
        effort: "Low",
        title,
        description: `From strategy: ${recommendation}`,
        proposedState: {
          fromArticle: task.fromArticle,
          toArticle: task.toArticle,
          suggestedAnchorText: task.suggestedAnchorText ?? "",
        },
        sourceData: { source: "seo-pilot-recommendation", strategy: recommendation },
      });
    } else if (task.type === "seo-fix") {
      if (!task.articleHandle || !handleSet.has(task.articleHandle)) { dropped++; continue; }
      rows.push({
        proposalType: "seo-fix",
        changeType: "update",
        articleHandle: task.articleHandle,
        priority: classifyPriority(65),
        impact: "High",
        effort: "Low",
        title,
        description: `From strategy: ${recommendation}`,
        proposedState: {
          articleHandle: task.articleHandle,
          targetQuery: task.targetQuery ?? title,
        },
        sourceData: { source: "seo-pilot-recommendation", strategy: recommendation },
      });
    } else if (task.type === "content-refresh") {
      if (!task.articleHandle || !handleSet.has(task.articleHandle)) { dropped++; continue; }
      const current = wordCountByHandle.get(task.articleHandle) ?? 0;
      rows.push({
        proposalType: "content-refresh",
        changeType: "update",
        articleHandle: task.articleHandle,
        priority: classifyPriority(55),
        impact: "Medium",
        effort: "Medium",
        title,
        description: `From strategy: ${recommendation}`,
        proposedState: {
          action: "expand",
          articleHandle: task.articleHandle,
          currentWordCount: current,
          targetWordCount: task.targetWordCount ?? Math.max(1200, current * 2),
        },
        sourceData: { source: "seo-pilot-recommendation", strategy: recommendation },
      });
    } else {
      dropped++;
    }
  }
  } // end AI decomposition branch

  if (rows.length === 0) {
    return NextResponse.json({ created: 0, skipped: 0, dropped, capped, proposals: [] });
  }

  // Dedup against existing active/terminal proposals by logical proposal key,
  // not only title. AI decomposition can reword task titles for the same article
  // action, and rejected/published history must still block regeneration.
  let skipped = 0;

  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.contentProposal.findMany({
      where: { status: { in: CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES } },
      select: { articleHandle: true, proposalType: true, title: true, proposedState: true },
    });
    const existingKeys = new Set(existing.map(contentProposalDedupeKey));
    const seenInBatch = new Set<string>();

    const toCreate = rows.filter((r) => {
      const key = contentProposalDedupeKey({
        articleHandle: typeof r.articleHandle === "string" ? r.articleHandle : null,
        proposalType: String(r.proposalType),
        title: String(r.title),
        proposedState: r.proposedState,
      });
      if (existingKeys.has(key) || seenInBatch.has(key)) { skipped++; return false; }
      seenInBatch.add(key);
      return true;
    });

    if (toCreate.length === 0) return [];
    const results = [];
    for (const r of toCreate) {
      const result = await createContentProposalOnce(tx, r as never);
      if (result.created) results.push(result.proposal); else skipped++;
    }
    return results;
  });

  if (created.length > 0) {
    try {
      const actor = (await getSessionUser(req)) ?? "operator";
      await prisma.auditLog.create({
        data: {
          actor,
          action: "seo_recommendation_decomposed",
          entityType: "ContentProposal",
          entityId: created.map((p) => p.id).join(","),
          meta: { created: created.length, skipped, dropped, capped },
        },
      });
    } catch { /* audit log is best-effort */ }
  }

  return NextResponse.json({
    created: created.length,
    skipped,
    dropped,
    capped,
    proposals: created.map((p) => ({ id: p.id, title: p.title, type: p.proposalType })),
  });
}
