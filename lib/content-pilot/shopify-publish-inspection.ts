import type { ContentProposal } from "@prisma/client";
import { resolveArticleHandle, resolveInternalLinkSourceHandle } from "@/lib/content-pilot/publish-draft";
import { sanitizeHtmlServer } from "@/lib/content-pilot/sanitize-html-server";
import { shopifyFetch } from "@/lib/shopify-admin";

type ShopifyArticle = {
  id: string;
  handle: string;
  title: string;
  body: string;
  seoTitle: { value: string | null } | null;
  seoDescription: { value: string | null } | null;
};

type Inspection =
  | { kind: "applied"; shopifyId: string; handle: string }
  | { kind: "not_applied" }
  | { kind: "ambiguous" };

const ARTICLE_READ = `
  query ContentPilotPublishInspection($query: String!) {
    articles(first: 10, query: $query) {
      edges { node {
        id handle title body
        seoTitle: metafield(namespace: "global", key: "title_tag") { value }
        seoDescription: metafield(namespace: "global", key: "description_tag") { value }
      } }
    }
  }
`;

async function readArticles(query: string): Promise<ShopifyArticle[]> {
  const result = await shopifyFetch<{ articles: { edges: Array<{ node: ShopifyArticle }> } }>(ARTICLE_READ, { query });
  return result.articles.edges.map(({ node }) => node);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Read-only, proposal-specific evidence for an interrupted Shopify publish.
 * It intentionally reports `not_applied` only when the current target article
 * is present and contradicts the exact operation. Absence and unsupported
 * shapes remain ambiguous so reconciliation never authorizes a duplicate write.
 */
export async function inspectPublishOutcome(proposal: ContentProposal): Promise<Inspection> {
  const draft = record(proposal.draftContent);
  if (!draft) return { kind: "ambiguous" };

  if (proposal.proposalType === "new-content") {
    const title = typeof draft.title === "string" ? draft.title : null;
    const bodyHtml = typeof draft.bodyHtml === "string" ? sanitizeHtmlServer(draft.bodyHtml) : null;
    if (!title || !bodyHtml) return { kind: "ambiguous" };
    const articles = await readArticles(`title:'${title.replace(/'/g, "\\'")}'`);
    const article = articles.find((candidate) => candidate.title === title && candidate.body.trim() === bodyHtml.trim());
    return article ? { kind: "applied", shopifyId: article.id, handle: article.handle } : { kind: "ambiguous" };
  }

  const handle = proposal.proposalType === "internal-link"
    ? resolveInternalLinkSourceHandle(proposal)
    : resolveArticleHandle(proposal);
  if (!handle) return { kind: "ambiguous" };
  const articles = await readArticles(`handle:'${handle.replace(/'/g, "\\'")}'`);
  const article = articles.find((candidate) => candidate.handle === handle);
  if (!article) return { kind: "ambiguous" };

  if (proposal.proposalType === "seo-fix") {
    const metaTitle = typeof draft.metaTitle === "string" ? draft.metaTitle : null;
    const metaDescription = typeof draft.metaDescription === "string" ? draft.metaDescription : null;
    if (!metaTitle || !metaDescription) return { kind: "ambiguous" };
    return article.seoTitle?.value === metaTitle && article.seoDescription?.value === metaDescription
      ? { kind: "applied", shopifyId: article.id, handle: article.handle }
      : { kind: "not_applied" };
  }

  if (proposal.proposalType === "internal-link") {
    return article.body.includes(`data-cp-link="${proposal.id}"`)
      ? { kind: "applied", shopifyId: article.id, handle: article.handle }
      : { kind: "not_applied" };
  }

  const bodyHtml = typeof draft.bodyHtml === "string" ? sanitizeHtmlServer(draft.bodyHtml) : null;
  if (!bodyHtml) return { kind: "ambiguous" };
  return article.body.trim() === bodyHtml.trim()
    ? { kind: "applied", shopifyId: article.id, handle: article.handle }
    : { kind: "not_applied" };
}
