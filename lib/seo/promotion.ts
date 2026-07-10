const BLOG_HANDLE = /^[a-z0-9][a-z0-9_-]*$/i;

export type SeoPromotionSkipReason = "missingArticle" | "nonBlogExistingPage";

export type SeoPromotionDecision =
  | { kind: "proposal"; proposalType: "seo-fix" | "content-refresh" | "new-content" }
  | { kind: "skip"; reason: SeoPromotionSkipReason };

export function articleHandleFromBlogPage(page: string | null | undefined): string | null {
  if (!page) return null;
  let path = page;
  try {
    path = new URL(page).pathname;
  } catch {
    path = page.split(/[?#]/)[0] ?? page;
  }
  const parts = path.split("/").filter(Boolean);
  const blogs = parts.findIndex((part) => part.toLowerCase() === "blogs");
  const handle = blogs >= 0 ? parts[blogs + 2] : null;
  return handle && BLOG_HANDLE.test(handle) ? handle.toLowerCase() : null;
}

export function classifySeoPromotion(input: {
  issue?: "missing-meta" | "thin-content";
  opportunityType?: string;
  page?: string | null;
  requestedHandle?: string | null;
  matchedArticle: { handle: string } | null;
}): SeoPromotionDecision {
  if (input.issue === "missing-meta") {
    return input.matchedArticle
      ? { kind: "proposal", proposalType: "seo-fix" }
      : { kind: "skip", reason: "missingArticle" };
  }
  if (input.issue === "thin-content") {
    return input.matchedArticle
      ? { kind: "proposal", proposalType: "content-refresh" }
      : { kind: "skip", reason: "missingArticle" };
  }

  const pageHandle = input.requestedHandle ?? articleHandleFromBlogPage(input.page);
  if (input.page && !pageHandle) return { kind: "skip", reason: "nonBlogExistingPage" };
  if (pageHandle && !input.matchedArticle) return { kind: "skip", reason: "missingArticle" };
  if (!input.matchedArticle) return { kind: "proposal", proposalType: "new-content" };
  if (input.opportunityType === "striking_distance") {
    return { kind: "proposal", proposalType: "content-refresh" };
  }
  return { kind: "proposal", proposalType: "seo-fix" };
}
