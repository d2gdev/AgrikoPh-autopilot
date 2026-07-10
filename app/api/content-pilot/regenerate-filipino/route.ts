export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { detectFilipino, extractDraftText } from "@/lib/content-pilot/detect-filipino";
import { generateDraft } from "@/lib/content-pilot/generate-draft";
import { publishDraft } from "@/lib/content-pilot/publish-draft";
import { fetchBlogArticles } from "@/lib/shopify-admin";

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

// Apply step: regenerate flagged Filipino drafts in English and republish published
// ones to Shopify. Pass ?id=<proposalId> to do exactly one; omit to process all flagged.
export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const onlyId = new URL(req.url).searchParams.get("id");

  try {
    // Re-detect the candidate set server-side (don't trust the caller).
    const proposals = await prisma.contentProposal.findMany({
      where: {
        draftContent: { not: Prisma.JsonNull },
        ...(onlyId ? { id: onlyId } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });

    const targets = proposals.filter((p) => detectFilipino(extractDraftText(p.draftContent)).isFilipino);
    if (targets.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, results: [], note: "No Filipino drafts matched." });
    }

    // Fetch Shopify article context once for all targets.
    const articles = await fetchBlogArticles();

    const results = [];
    for (const proposal of targets) {
      const beforeText = extractDraftText(proposal.draftContent).slice(0, 140);
      try {
        const article = proposal.articleHandle
          ? articles.find((a) => a.handle === proposal.articleHandle) ?? null
          : null;

        const draftContent = await generateDraft(proposal, article);

        // Safety: confirm the regenerated draft is no longer Filipino before publishing.
        if (detectFilipino(extractDraftText(draftContent)).isFilipino) {
          results.push({ id: proposal.id, title: proposal.title, status: "still_filipino", beforeText });
          continue;
        }

        const updated = await prisma.contentProposal.update({
          where: { id: proposal.id },
          data: { draftContent: draftContent as object, draftGeneratedAt: new Date(), draftError: null },
        });
        await prisma.contentProposalDraftHistory.create({
          data: { proposalId: proposal.id, savedBy: "regenerate-filipino", draftContent: draftContent as object, reason: "regenerated" },
        });

        const afterText = extractDraftText(draftContent).slice(0, 140);

        // Republish only if it was already published live.
        let republished = false;
        if (proposal.publishedAt) {
          await publishDraft(updated);
          await prisma.contentProposal.update({
            where: { id: proposal.id },
            data: { draftStatus: "published", publishedAt: new Date() },
          });
          republished = true;
        }

        results.push({ id: proposal.id, title: proposal.title, status: "ok", republished, beforeText, afterText });
      } catch (err) {
        console.error(`[content-pilot] Filipino regeneration failed for ${proposal.id}`, err);
        results.push({ id: proposal.id, title: proposal.title, status: "error", error: "Regeneration failed. Please retry.", beforeText });
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error("[content-pilot] regenerate-filipino apply failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Apply failed" },
      { status: 500 },
    );
  }
}
