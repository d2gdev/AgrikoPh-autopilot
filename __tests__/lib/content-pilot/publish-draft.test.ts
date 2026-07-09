import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentProposal } from "@prisma/client";

vi.mock("@/lib/shopify-admin", () => ({
  shopifyFetch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    articleRecord: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/content-pilot/generate-draft", async () => {
  const { z } = await import("zod");
  const bodyHtmlSchema = z.object({ bodyHtml: z.string().trim().min(1) });
  return {
    getDraftSchema: (proposalType: string) => {
      switch (proposalType) {
        case "seo-fix":
          return z.object({
            metaTitle: z.string().trim().min(1).max(70),
            metaDescription: z.string().trim().min(1).max(320),
          });
        case "internal-link":
          return z.object({
            suggestedParagraph: z.string().trim().min(1),
            anchorText: z.string().trim().min(1),
            targetHandle: z.string().trim().min(1),
          });
        case "new-content":
          return z.object({
            title: z.string().trim().min(1),
            bodyHtml: z.string().trim().min(1),
            tags: z.array(z.string()),
            metaDescription: z.string().trim().min(1),
          });
        default:
          return bodyHtmlSchema;
      }
    },
  };
});

import { shopifyFetch } from "@/lib/shopify-admin";
import { prisma } from "@/lib/db";
import { publishDraft, resolveArticleHandle, resolveInternalLinkSourceHandle } from "@/lib/content-pilot/publish-draft";

const mockShopifyFetch = vi.mocked(shopifyFetch);
const mockPrisma = prisma as unknown as {
  articleRecord: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

function proposal(overrides: Partial<ContentProposal>): ContentProposal {
  const now = new Date("2026-06-24T00:00:00.000Z");
  return {
    id: "proposal-1",
    createdAt: now,
    updatedAt: now,
    articleHandle: null,
    proposalType: "content-refresh",
    changeType: "update",
    priority: "P2",
    impact: "medium",
    effort: "medium",
    title: "Refresh article",
    description: "Refresh article content",
    proposedState: {},
    sourceData: {},
    status: "approved",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    draftContent: {
      bodyHtml: "<h2>Updated section</h2><p>Useful refreshed article copy.</p>",
    },
    draftGeneratedAt: now,
    draftStatus: "ready",
    draftError: null,
    publishedAt: null,
    shopifyArticleId: null,
    publishedHandle: null,
    scheduledPublishAt: null,
    baselineSeoScore: null,
    followUpSeoScore: null,
    followUpScoredAt: null,
    citations: null,
    ...overrides,
  };
}

describe("resolveArticleHandle", () => {
  it("uses a top-level articleHandle when present", () => {
    expect(resolveArticleHandle(proposal({ articleHandle: "organic-black-rice" }))).toBe(
      "organic-black-rice"
    );
  });

  it("infers the handle from nested Shopify article URLs", () => {
    expect(
      resolveArticleHandle(
        proposal({
          sourceData: {
            gsc: {
              pairs: [
                {
                  page: "https://agrikoph.com/blogs/news/where-to-buy-organic-rice-in-the-philippines?utm=1",
                },
              ],
            },
          },
        })
      )
    ).toBe("where-to-buy-organic-rice-in-the-philippines");
  });

  it("uses proposedState.articleHandle for older promoted proposals", () => {
    expect(
      resolveArticleHandle(
        proposal({
          proposedState: { articleHandle: "red-rice-vs-black-rice" },
        })
      )
    ).toBe("red-rice-vs-black-rice");
  });
});

describe("publishDraft", () => {
  beforeEach(() => {
    mockShopifyFetch.mockReset();
    mockPrisma.articleRecord.findUnique.mockReset();
    mockPrisma.articleRecord.findUnique.mockResolvedValue(null);
  });

  it("publishes content-refresh proposals that only carry a Shopify URL", async () => {
    mockShopifyFetch.mockImplementation(async (query: string, variables?: Record<string, unknown>) => {
      if (query.includes("ArticleByHandle")) {
        return { articles: { edges: [{ node: { id: "gid://shopify/Article/123" } }] } };
      }
      if (query.includes("ArticleUpdate")) {
        return {
          articleUpdate: {
            article: { id: "gid://shopify/Article/123" },
            userErrors: [],
          },
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    const result = await publishDraft(
      proposal({
        sourceData: {
          page: "https://agrikoph.com/blogs/news/where-to-buy-organic-rice-in-the-philippines",
        },
      })
    );

    expect(result).toEqual({
      shopifyId: "gid://shopify/Article/123",
      handle: "where-to-buy-organic-rice-in-the-philippines",
    });
    expect(mockShopifyFetch).toHaveBeenCalledWith(
      expect.stringContaining("ArticleByHandle"),
      { query: "handle:'where-to-buy-organic-rice-in-the-philippines'" }
    );
  });

  it("still blocks existing-article proposals with no resolvable handle", async () => {
    await expect(publishDraft(proposal({ sourceData: { source: "seo-pilot" } }))).rejects.toThrow(
      'Proposal type "content-refresh" requires an articleHandle or a Shopify article URL in proposal data'
    );
    expect(mockShopifyFetch).not.toHaveBeenCalled();
  });

  it("does not require an articleHandle for new-content proposals", async () => {
    let createVariables: Record<string, unknown> | undefined;
    mockShopifyFetch.mockImplementation(async (query: string, variables?: Record<string, unknown>) => {
      if (query.includes("blogs(first: 20)")) {
        return { blogs: { edges: [{ node: { id: "gid://shopify/Blog/1", handle: "news" } }] } };
      }
      if (query.includes("ArticleCreate")) {
        createVariables = variables;
        return {
          articleCreate: {
            article: { id: "gid://shopify/Article/999", handle: "new-guide" },
            userErrors: [],
          },
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    const result = await publishDraft(
      proposal({
        proposalType: "new-content",
        proposedState: { blogHandle: "news" },
        draftContent: {
          title: "New Guide",
          bodyHtml: "<h2>Guide</h2><p>Useful article copy.</p>",
          tags: ["rice"],
          metaDescription: "A useful guide from Agriko.",
        },
      })
    );

    expect(result).toEqual({ shopifyId: "gid://shopify/Article/999", handle: "new-guide" });
    expect(createVariables).toMatchObject({
      article: {
        metafields: expect.arrayContaining([
          expect.objectContaining({
            namespace: "global",
            key: "title_tag",
            value: "New Guide",
            type: "single_line_text_field",
          }),
          expect.objectContaining({
            namespace: "global",
            key: "description_tag",
            value: "A useful guide from Agriko.",
            type: "multi_line_text_field",
          }),
          expect.objectContaining({
            namespace: "custom",
            key: "article_system_template",
            value: "guide",
            type: "single_line_text_field",
          }),
          expect.objectContaining({
            namespace: "custom",
            key: "article_system_profile",
            value: "rice",
            type: "single_line_text_field",
          }),
        ]),
      },
    });
  });

  it("uses targetKeyword fallback when publishing generic new-content drafts", async () => {
    let createVariables: Record<string, unknown> | undefined;
    mockShopifyFetch.mockImplementation(async (query: string, variables?: Record<string, unknown>) => {
      if (query.includes("blogs(first: 20)")) {
        return { blogs: { edges: [{ node: { id: "gid://shopify/Blog/1", handle: "news" } }] } };
      }
      if (query.includes("ArticleCreate")) {
        createVariables = variables;
        return {
          articleCreate: {
            article: { id: "gid://shopify/Article/1100", handle: "generic-black-rice-guide" },
            userErrors: [],
          },
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    await publishDraft(
      proposal({
        proposalType: "new-content",
        proposedState: { blogHandle: "news", targetKeyword: "organic black rice philippines" },
        draftContent: {
          title: "A Practical Guide for Filipino Families",
          bodyHtml: "<h2>Guide</h2><p>Useful article copy.</p>",
          tags: [],
          metaDescription: "A practical guide from Agriko.",
        },
      })
    );

    expect(createVariables).toMatchObject({
      article: {
        tags: expect.arrayContaining([
          "black rice",
          "rice-type:black-rice",
          "organic black rice philippines",
        ]),
        metafields: expect.arrayContaining([
          expect.objectContaining({
            namespace: "custom",
            key: "article_system_template",
            value: "guide",
          }),
          expect.objectContaining({
            namespace: "custom",
            key: "article_system_profile",
            value: "rice",
          }),
        ]),
      },
    });
  });

  it("publishes clean turmeric tags when draft tags contain rice noise", async () => {
    let createVariables: Record<string, unknown> | undefined;
    mockShopifyFetch.mockImplementation(async (query: string, variables?: Record<string, unknown>) => {
      if (query.includes("blogs(first: 20)")) {
        return { blogs: { edges: [{ node: { id: "gid://shopify/Blog/1", handle: "news" } }] } };
      }
      if (query.includes("ArticleCreate")) {
        createVariables = variables;
        return {
          articleCreate: {
            article: { id: "gid://shopify/Article/1101", handle: "turmeric-clean-tags" },
            userErrors: [],
          },
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    await publishDraft(
      proposal({
        proposalType: "new-content",
        proposedState: { blogHandle: "news" },
        draftContent: {
          title: "Turmeric Tea Philippines: Benefits, How to Brew, and Best Options",
          bodyHtml: "<h2>Turmeric tea</h2><p>Useful article copy.</p>",
          tags: ["organic rice philippines", "black rice", "turmeric tea philippines"],
          metaDescription: "A practical turmeric tea guide.",
        },
      })
    );

    expect(createVariables).toMatchObject({
      article: {
        tags: ["turmeric tea philippines", "turmeric"],
      },
    });
  });

  it("classifies buying-intent black rice posts as rice buying guides", async () => {
    let createVariables: Record<string, unknown> | undefined;
    mockShopifyFetch.mockImplementation(async (query: string, variables?: Record<string, unknown>) => {
      if (query.includes("blogs(first: 20)")) {
        return { blogs: { edges: [{ node: { id: "gid://shopify/Blog/1", handle: "news" } }] } };
      }
      if (query.includes("ArticleCreate")) {
        createVariables = variables;
        return {
          articleCreate: {
            article: { id: "gid://shopify/Article/1000", handle: "best-black-rice-brands" },
            userErrors: [],
          },
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    await publishDraft(
      proposal({
        proposalType: "new-content",
        proposedState: { blogHandle: "news" },
        draftContent: {
          title: "How to Choose the Best Black Rice Brands in the Philippines",
          bodyHtml: "<h2>Brand guide</h2><p>Useful article copy.</p>",
          tags: ["black rice", "organic rice"],
          metaDescription: "A practical black rice buying guide.",
        },
      })
    );

    expect(createVariables).toMatchObject({
      article: {
        metafields: expect.arrayContaining([
          expect.objectContaining({
            namespace: "custom",
            key: "article_system_template",
            value: "buying-guide",
          }),
          expect.objectContaining({
            namespace: "custom",
            key: "article_system_profile",
            value: "rice",
          }),
        ]),
      },
    });
  });

  it("lets turmeric titles override noisy rice tags", async () => {
    let createVariables: Record<string, unknown> | undefined;
    mockShopifyFetch.mockImplementation(async (query: string, variables?: Record<string, unknown>) => {
      if (query.includes("blogs(first: 20)")) {
        return { blogs: { edges: [{ node: { id: "gid://shopify/Blog/1", handle: "news" } }] } };
      }
      if (query.includes("ArticleCreate")) {
        createVariables = variables;
        return {
          articleCreate: {
            article: { id: "gid://shopify/Article/1001", handle: "turmeric-tea-guide" },
            userErrors: [],
          },
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    await publishDraft(
      proposal({
        proposalType: "new-content",
        proposedState: { blogHandle: "news" },
        draftContent: {
          title: "Turmeric Tea Philippines: Benefits, How to Brew, and Best Options",
          bodyHtml: "<h2>Turmeric tea</h2><p>Useful article copy.</p>",
          tags: ["organic rice philippines", "best black rice brands philippines", "turmeric tea philippines"],
          metaDescription: "A practical turmeric tea guide.",
        },
      })
    );

    expect(createVariables).toMatchObject({
      article: {
        metafields: expect.arrayContaining([
          expect.objectContaining({
            namespace: "custom",
            key: "article_system_template",
            value: "guide",
          }),
          expect.objectContaining({
            namespace: "custom",
            key: "article_system_profile",
            value: "turmeric",
          }),
        ]),
      },
    });
  });

  it("enriches missing article tags before publishing new content", async () => {
    let createVariables: Record<string, unknown> | undefined;
    mockShopifyFetch.mockImplementation(async (query: string, variables?: Record<string, unknown>) => {
      if (query.includes("blogs(first: 20)")) {
        return { blogs: { edges: [{ node: { id: "gid://shopify/Blog/1", handle: "news" } }] } };
      }
      if (query.includes("ArticleCreate")) {
        createVariables = variables;
        return {
          articleCreate: {
            article: { id: "gid://shopify/Article/1002", handle: "black-rice-brands" },
            userErrors: [],
          },
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    await publishDraft(
      proposal({
        proposalType: "new-content",
        proposedState: { blogHandle: "news" },
        draftContent: {
          title: "How to Choose the Best Black Rice Brands in the Philippines",
          bodyHtml: "<h2>Black rice brands</h2><p>Useful article copy.</p>",
          tags: [],
          metaDescription: "A practical black rice buying guide.",
        },
      })
    );

    expect(createVariables).toMatchObject({
      article: {
        tags: [
          "organic rice",
          "organic rice philippines",
          "black rice",
          "rice-type:black-rice",
          "organic black rice philippines",
          "buying guide",
        ],
        metafields: expect.arrayContaining([
          expect.objectContaining({
            namespace: "custom",
            key: "article_system_template",
            value: "buying-guide",
          }),
          expect.objectContaining({
            namespace: "custom",
            key: "article_system_profile",
            value: "rice",
          }),
        ]),
      },
    });
  });

  it("keeps SEO and article-system metafields when retrying an existing new-content article", async () => {
    let updateVariables: Record<string, unknown> | undefined;
    mockShopifyFetch.mockImplementation(async (query: string, variables?: Record<string, unknown>) => {
      if (query.includes("ArticleUpdate")) {
        updateVariables = variables;
        return {
          articleUpdate: {
            article: { id: "gid://shopify/Article/existing", handle: "turmeric-tea-guide" },
            userErrors: [],
          },
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    await publishDraft(
      proposal({
        proposalType: "new-content",
        proposedState: { blogHandle: "news" },
        shopifyArticleId: "gid://shopify/Article/existing",
        draftContent: {
          title: "Turmeric Tea Philippines: Benefits, How to Brew, and Best Options",
          bodyHtml: "<h2>Turmeric tea</h2><p>Useful article copy.</p>",
          tags: [],
          metaDescription: "A practical turmeric tea guide.",
        },
      })
    );

    expect(updateVariables).toMatchObject({
      id: "gid://shopify/Article/existing",
      article: {
        tags: ["turmeric", "turmeric tea philippines"],
        metafields: expect.arrayContaining([
          expect.objectContaining({
            namespace: "global",
            key: "title_tag",
            value: "Turmeric Tea Philippines: Benefits, How to Brew, and Best Options",
          }),
          expect.objectContaining({
            namespace: "global",
            key: "description_tag",
            value: "A practical turmeric tea guide.",
          }),
          expect.objectContaining({
            namespace: "custom",
            key: "article_system_template",
            value: "guide",
          }),
          expect.objectContaining({
            namespace: "custom",
            key: "article_system_profile",
            value: "turmeric",
          }),
        ]),
      },
    });
  });

  it("resolves internal-link source handles from proposedState.fromArticle", () => {
    expect(
      resolveInternalLinkSourceHandle(
        proposal({
          proposalType: "internal-link",
          articleHandle: "target-article",
          proposedState: {
            fromArticle: "source-article",
            toArticle: "target-article",
          },
        }),
      ),
    ).toBe("source-article");
  });

  it("publishes internal-link proposals into the source article, not the target article", async () => {
    mockShopifyFetch.mockImplementation(async (query: string, variables?: Record<string, unknown>) => {
      if (query.includes("ArticleByHandle")) {
        expect(variables).toEqual({ query: "handle:'source-article'" });
        return { articles: { edges: [{ node: { id: "gid://shopify/Article/source" } }] } };
      }
      if (query.includes("ArticleBody")) {
        return { article: { body: "<p>Existing source body.</p>" } };
      }
      if (query.includes("ArticleUpdate")) {
        expect(variables).toMatchObject({
          id: "gid://shopify/Article/source",
        });
        expect((variables?.article as { body: string }).body).toContain("/blogs/news/target-article");
        return {
          articleUpdate: {
            article: { id: "gid://shopify/Article/source" },
            userErrors: [],
          },
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    const result = await publishDraft(
      proposal({
        proposalType: "internal-link",
        articleHandle: "target-article",
        proposedState: {
          fromArticle: "source-article",
          toArticle: "target-article",
        },
        draftContent: {
          suggestedParagraph: 'Read more about <a href="/blogs/news/target-article">target article</a>.',
          anchorText: "target article",
          targetHandle: "target-article",
        },
      }),
    );

    expect(result).toEqual({ shopifyId: "gid://shopify/Article/source", handle: "source-article" });
  });

  it("falls back to indexed Shopify article ids when handle search returns no result", async () => {
    mockPrisma.articleRecord.findUnique.mockResolvedValue({ shopifyId: "gid://shopify/Article/indexed" });
    mockShopifyFetch.mockImplementation(async (query: string, variables?: Record<string, unknown>) => {
      if (query.includes("ArticleByHandle")) {
        expect(variables).toEqual({ query: "handle:'indexed-article'" });
        return { articles: { edges: [] } };
      }
      if (query.includes("ArticleExists")) {
        expect(variables).toEqual({ id: "gid://shopify/Article/indexed" });
        return { article: { id: "gid://shopify/Article/indexed" } };
      }
      if (query.includes("MetafieldsSet")) {
        expect(variables).toMatchObject({
          metafields: expect.arrayContaining([
            expect.objectContaining({ ownerId: "gid://shopify/Article/indexed" }),
          ]),
        });
        return {
          metafieldsSet: {
            metafields: [{ id: "gid://shopify/Metafield/1" }],
            userErrors: [],
          },
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    const result = await publishDraft(
      proposal({
        proposalType: "seo-fix",
        articleHandle: "indexed-article",
        draftContent: {
          metaTitle: "Indexed article title",
          metaDescription: "Indexed article description.",
        },
      }),
    );

    expect(result).toEqual({ shopifyId: "gid://shopify/Article/indexed", handle: "indexed-article" });
    expect(mockPrisma.articleRecord.findUnique).toHaveBeenCalledWith({
      where: { handle: "indexed-article" },
      select: { shopifyId: true },
    });
  });

  it("rejects stale indexed article ids when Shopify no longer has the article", async () => {
    mockPrisma.articleRecord.findUnique.mockResolvedValue({ shopifyId: "gid://shopify/Article/stale" });
    mockShopifyFetch.mockImplementation(async (query: string, variables?: Record<string, unknown>) => {
      if (query.includes("ArticleByHandle")) {
        expect(variables).toEqual({ query: "handle:'stale-article'" });
        return { articles: { edges: [] } };
      }
      if (query.includes("ArticleExists")) {
        expect(variables).toEqual({ id: "gid://shopify/Article/stale" });
        return { article: null };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    await expect(
      publishDraft(
        proposal({
          proposalType: "seo-fix",
          articleHandle: "stale-article",
          draftContent: {
            metaTitle: "Stale article title",
            metaDescription: "Stale article description.",
          },
        }),
      ),
    ).rejects.toThrow("Target article 'stale-article' no longer exists in Shopify");
  });

  it("rejects a seo-fix draft whose metaTitle exceeds 70 chars before any Shopify call", async () => {
    await expect(
      publishDraft(
        proposal({
          proposalType: "seo-fix",
          articleHandle: "some-article",
          draftContent: {
            metaTitle: "x".repeat(71),
            metaDescription: "ok description",
          },
        }),
      ),
    ).rejects.toThrow();
    expect(mockShopifyFetch).not.toHaveBeenCalled();
  });
});
