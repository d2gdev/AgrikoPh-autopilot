export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSessionShop, getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { detectFilipino, extractDraftText } from "@/lib/content-pilot/detect-filipino";
import { generateProposalDraft } from "@/lib/content-pilot/generation-service";
import { publishContentProposal } from "@/lib/content-pilot/publish-service";
import { z } from "zod";
import { CONTENT_PROPOSAL_PUBLISHABLE_STATUSES } from "@/lib/content-pilot/proposal-state";

// Read-only scan: find content drafts that appear to be written in Filipino so they
// can be regenerated in English. Mutating regeneration lives in a separate step.
export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const proposals = await prisma.contentProposal.findMany({
      where: { draftContent: { not: Prisma.JsonNull } },
      select: {
        id: true,
        proposalType: true,
        title: true,
        status: true,
        draftStatus: true,
        articleHandle: true,
        publishedAt: true,
        draftContent: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    const candidates = [];
    let scanned = 0;
    for (const p of proposals) {
      const text = extractDraftText(p.draftContent);
      if (!text) continue;
      scanned++;
      const verdict = detectFilipino(text);
      if (verdict.isFilipino) {
        candidates.push({
          id: p.id,
          proposalType: p.proposalType,
          title: p.title,
          status: p.status,
          draftStatus: p.draftStatus,
          articleHandle: p.articleHandle,
          published: p.publishedAt != null,
          score: verdict.score,
          matchedCount: verdict.matchedCount,
          wordCount: verdict.wordCount,
          sample: verdict.sample,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      scanned,
      filipinoCount: candidates.length,
      candidates,
    });
  } catch (error) {
    console.error("[content-pilot] regenerate-filipino scan failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scan failed" },
      { status: 500 },
    );
  }
}

// Apply step: regenerate explicitly selected Filipino drafts and optionally republish
// published ones to Shopify.
export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_PUBLISH);
  if (permissionError) return permissionError;
  const actor = (await getSessionUser(req)) ?? "operator";
  const shop = (await getSessionShop(req)) ?? "unknown-shop";
  const rateKey = `${shop}:${actor}`;
  if (!checkRateLimit(`regenerate-filipino:${rateKey}`, 5, 60_000)) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  const schema = z.object({ proposalIds: z.array(z.string().min(1)).min(1).max(25), confirmation: z.literal("REGENERATE_FILIPINO"), republishPublished: z.boolean() }).strict();
  let body: z.infer<typeof schema>;
  try { body = schema.parse(await req.json()); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  if (new Set(body.proposalIds).size !== body.proposalIds.length) return NextResponse.json({ error: "Duplicate proposal IDs" }, { status: 400 });

  try {
    // Re-detect the candidate set server-side (don't trust the caller).
    const proposals = await prisma.contentProposal.findMany({ where: { id: { in: body.proposalIds } } });

    const results = [];
    const found = new Set(proposals.map((p) => p.id));
    for (const id of body.proposalIds) if (!found.has(id)) results.push({ id, status: "conflict" });
    for (const proposal of proposals) {
      const originalText = extractDraftText(proposal.draftContent);
      const beforeText = originalText.slice(0, 140);
      try {
        // Regeneration is only valid for proposals that are publishable. Keep
        // legacy rows without a status compatible, but never process an
        // explicitly pending/rejected target.
        if (proposal.status && !(CONTENT_PROPOSAL_PUBLISHABLE_STATUSES as readonly string[]).includes(proposal.status)) {
          results.push({ id: proposal.id, status: "conflict" });
          continue;
        }
        const verdict = detectFilipino(extractDraftText(proposal.draftContent));
        if (!verdict.isFilipino) { results.push({ id: proposal.id, status: "still_filipino" }); continue; }
        const generated = await generateProposalDraft({ prismaClient: prisma as any, proposalId: proposal.id, actor, preservePublishedReceipt: Boolean(proposal.publishedAt) });
        if (generated.kind !== "ready") { results.push({ id: proposal.id, status: generated.kind === "conflict" ? "conflict" : "failed" }); continue; }
        const generatedText = extractDraftText(generated.proposal.draftContent);
        const generatedVerdict = detectFilipino(generatedText);
        // Re-check generated output server-side. Legacy/null statuses are valid,
        // and unchanged output is still Filipino even if detection is uncertain.
        if (generatedVerdict.isFilipino || generatedText.trim() === originalText.trim()) {
          results.push({ id: proposal.id, status: "still_filipino" }); continue;
        }
        if (proposal.publishedAt && body.republishPublished) {
          const published = await publishContentProposal({ prismaClient: prisma, proposalId: proposal.id, actor, trigger: "maintenance" });
          results.push({ id: proposal.id, status: published.kind === "published" || published.kind === "published_with_warnings" ? "ok" : "failed", republished: true });
        } else results.push({ id: proposal.id, status: "ok", republished: false });
      } catch (err) {
        console.error(`[content-pilot] Filipino regeneration failed for ${proposal.id}`, err);
        results.push({ id: proposal.id, title: proposal.title, status: "error", error: "Regeneration failed. Please retry.", beforeText });
      }
    }

    const counts = results.reduce((a, r: any) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {} as Record<string, number>);
    counts.succeeded = counts.ok ?? 0;
    counts.failed = (counts.failed ?? 0) + (counts.error ?? 0);
    const hasNonSuccess = results.some((r: any) => r.status !== "ok");
    return NextResponse.json({ ok: !hasNonSuccess, processed: results.length, results, counts }, { status: hasNonSuccess ? 207 : 200 });
  } catch (error) {
    console.error("[content-pilot] regenerate-filipino apply failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Apply failed" },
      { status: 500 },
    );
  }
}
