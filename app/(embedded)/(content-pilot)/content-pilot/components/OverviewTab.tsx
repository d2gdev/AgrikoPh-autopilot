import {
  Badge,
  Button,
  BlockStack,
  Box,
  DataTable,
  InlineStack,
  Link,
  Pagination,
  Spinner,
  Text,
} from "@shopify/polaris";

import type { ArticleRow, TopicCluster, LinkGraphData } from "./types";
import { fmt, ScoreBadge } from "./helpers";

export function OverviewTab({
  articles,
  clusters,
  linkGraph,
  loading,
  articlesError,
  page,
  pages,
  onPageChange,
  onOpenBrief,
}: {
  articles: ArticleRow[];
  clusters: TopicCluster[];
  linkGraph: LinkGraphData | null;
  loading: boolean;
  articlesError: boolean; // Fix #3 — distinguish timeout from genuinely empty
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
  onOpenBrief: () => void;
}) {
  const articleStorefrontUrl = (article: { blogHandle: string; handle: string }) =>
    `https://agrikoph.com/blogs/${encodeURIComponent(article.blogHandle)}/${encodeURIComponent(article.handle)}`;
  const articleLink = (article: { blogHandle: string; handle: string; title: string }) => (
    <Link url={articleStorefrontUrl(article)} external>
      {article.title}
    </Link>
  );
  const articleRows = articles.map((a) => [
    articleLink(a),
    fmt(a.publishedAt),
    <ScoreBadge key={a.handle} score={a.seoScore} />,
    a.topics.join(", ") || "—",
    String(a.internalLinks ?? 0),
    String(a.inboundCount ?? 0),
  ]);

  const clusterRows = clusters.slice(0, 15).map((c) => [
    c.topic,
    String(c.articleCount),
    String(c.keywordCount),
    <Badge
      key={c.topic}
      tone={c.gapScore >= 80 ? "critical" : c.gapScore >= 40 ? "attention" : "success"}
    >
      {String(c.gapScore)}
    </Badge>,
  ]);

  const orphanRows = (linkGraph?.orphans ?? []).slice(0, 10).map((a) => [
    articleLink(a),
    String(a.outboundLinks ?? 0),
  ]);

  const hubRows = (linkGraph?.hubs ?? []).map((a) => [
    articleLink(a),
    String(a.inboundCount ?? 0),
    String(a.outboundLinks ?? 0),
  ]);

  if (loading) {
    return (
      <InlineStack align="center">
        <Spinner size="small" />
      </InlineStack>
    );
  }

  return (
    <BlockStack gap="600">
      <BlockStack gap="300">
        <Text variant="headingMd" as="h2">
          Topic Cluster Gaps
        </Text>
        <Text as="p" tone="subdued">
          Gap score 0–100. Higher = more content needed.
        </Text>
        <InlineStack>
          <Button onClick={onOpenBrief}>View mapped content work</Button>
        </InlineStack>
        {clusterRows.length === 0 ? (
          <Text as="p" tone="subdued">
            Run the indexer to populate topic data.
          </Text>
        ) : (
          <BlockStack gap="200">
            <DataTable
              columnContentTypes={["text", "numeric", "numeric", "text"]}
              headings={["Topic", "Articles", "Keywords", "Gap Score"]}
              rows={clusterRows}
            />
          </BlockStack>
        )}
      </BlockStack>

      <InlineStack gap="400" align="start" blockAlign="start" wrap>
        <Box minWidth="45%">
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">
              Orphan Articles
            </Text>
            <Text as="p" tone="subdued">
              No inbound internal links — low crawl priority.
            </Text>
            {orphanRows.length === 0 ? (
              <Text as="p" tone="subdued">
                No orphans found.
              </Text>
              ) : (
                <BlockStack gap="200">
                  <DataTable
                    columnContentTypes={["text", "numeric"]}
                    headings={["Article", "Out-links"]}
                    rows={orphanRows}
                  />
                </BlockStack>
            )}
          </BlockStack>
        </Box>
        <Box minWidth="45%">
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">
              Hub Articles
            </Text>
            <Text as="p" tone="subdued">
              Most-linked-to — pillar content candidates.
            </Text>
            {hubRows.length === 0 ? (
              <Text as="p" tone="subdued">
                Run the indexer first.
              </Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric"]}
                headings={["Article", "In-links", "Out-links"]}
                rows={hubRows}
              />
            )}
          </BlockStack>
        </Box>
      </InlineStack>

      <BlockStack gap="300">
        <Text variant="headingMd" as="h2">
          Indexed Articles
        </Text>
        {articlesError ? (
          <Text as="p" tone="subdued">
            Articles failed to load — try refreshing the page.
          </Text>
        ) : articleRows.length === 0 ? (
          <Text as="p" tone="subdued">
            No articles indexed yet. Click &ldquo;Run Indexer&rdquo; to analyse your blog posts.
          </Text>
        ) : (
          <BlockStack gap="300">
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "numeric", "numeric"]}
              headings={["Title", "Published", "SEO Score", "Topics", "Out-links", "In-links"]}
              rows={articleRows}
            />
            {pages > 1 && (
              <InlineStack align="center" gap="300" blockAlign="center">
                <Text as="p" tone="subdued">{`Page ${page} of ${pages}`}</Text>
                <Pagination
                  hasPrevious={page > 1}
                  onPrevious={() => onPageChange(page - 1)}
                  hasNext={page < pages}
                  onNext={() => onPageChange(page + 1)}
                />
              </InlineStack>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </BlockStack>
  );
}
