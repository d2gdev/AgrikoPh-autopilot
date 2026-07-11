export interface ArticlePage<TArticle> {
  articles: TArticle[];
  total: number;
  page: number;
  pages: number;
}

export async function loadAllArticlePages<TArticle>(
  fetchPage: (page: number) => Promise<ArticlePage<TArticle>>,
): Promise<{ articles: TArticle[]; total: number }> {
  const first = await fetchPage(1);
  const pageCount = Number.isInteger(first.pages) && first.pages > 0 ? first.pages : 1;
  const articles = [...first.articles];

  for (let page = 2; page <= pageCount; page++) {
    const next = await fetchPage(page);
    articles.push(...next.articles);
  }

  return { articles, total: first.total };
}
