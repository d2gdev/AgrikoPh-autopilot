import { prisma } from "@/lib/db";
import { fetchBlogArticles } from "@/lib/shopify-admin";

export interface SourceDoc {
  sourceType: string;
  sourceId: string;
  text: string;
  metadata: Record<string, unknown>;
}

function stripHtml(html: string | null | undefined): string {
  return (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function joinNonEmpty(parts: (string | null | undefined)[]): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join("\n");
}

function push(docs: SourceDoc[], doc: SourceDoc) {
  if (doc.text.trim()) docs.push(doc);
}

export async function collectSourceDocs(): Promise<SourceDoc[]> {
  const docs: SourceDoc[] = [];

  // Articles: body text is not persisted in ArticleRecord — pull live from Shopify.
  const articles = await fetchBlogArticles();
  for (const a of articles) {
    push(docs, {
      sourceType: "article",
      sourceId: a.id,
      text: joinNonEmpty([a.title, stripHtml(a.bodyHtml)]),
      metadata: { title: a.title, url: a.onlineStoreUrl ?? null, handle: a.handle },
    });
  }

  const reviews = await prisma.productReview.findMany({
    select: { id: true, text: true, productTitle: true },
  });
  for (const r of reviews) {
    push(docs, {
      sourceType: "review",
      sourceId: r.id,
      text: r.text ?? "",
      metadata: { title: r.productTitle },
    });
  }

  const proposals = await prisma.contentProposal.findMany({
    select: { id: true, title: true, description: true },
  });
  for (const p of proposals) {
    push(docs, {
      sourceType: "brief",
      sourceId: p.id,
      text: joinNonEmpty([p.title, p.description]),
      metadata: { title: p.title },
    });
  }

  const insights = await prisma.marketInsight.findMany({
    select: { id: true, title: true, summary: true },
  });
  for (const m of insights) {
    push(docs, {
      sourceType: "market_insight",
      sourceId: m.id,
      text: joinNonEmpty([m.title, m.summary]),
      metadata: { title: m.title },
    });
  }

  const recs = await prisma.recommendation.findMany({
    select: { id: true, rationale: true, estimatedImpact: true, targetEntityName: true },
  });
  for (const rec of recs) {
    push(docs, {
      sourceType: "recommendation",
      sourceId: rec.id,
      text: joinNonEmpty([rec.rationale, rec.estimatedImpact]),
      metadata: { title: rec.targetEntityName },
    });
  }

  const ads = await prisma.competitorAd.findMany({
    select: { id: true, adCopy: true, adCopyEn: true, headline: true, headlineEn: true, description: true },
  });
  for (const ad of ads) {
    push(docs, {
      sourceType: "competitor_ad",
      sourceId: ad.id,
      text: joinNonEmpty([ad.headlineEn ?? ad.headline, ad.adCopyEn ?? ad.adCopy, ad.description]),
      metadata: {},
    });
  }

  return docs;
}
