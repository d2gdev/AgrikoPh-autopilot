import { BlockStack, Layout, Text } from "@shopify/polaris";
import { StatGrid } from "@/components/ui/stat-grid";
import type { DashboardData, FatigueItem, SearchTermItem, CompetitorItem } from "../types";
import { StatCardSkeleton } from "../helpers";
import { FatigueCard, SearchTermCard, CompetitorCard } from "../InsightCards";

export function SkillInsightsSection({
  loading,
  data,
}: {
  loading: boolean;
  data: DashboardData | null;
}) {
  return (
    <Layout.Section>
      <BlockStack gap="300">
        <Text variant="headingMd" as="h2">Skill Insights</Text>
        <StatGrid>
          {loading ? (
            <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
          ) : (() => {
            const insights = data?.latestInsights ?? [];
            const fatigue = insights.find((i) => i.insightType === "fatigue-report");
            const searchTerms = insights.find((i) => i.insightType === "search-term-opportunities");
            const competitors = insights.find((i) => i.insightType === "competitor-analysis");
            return (
              <>
                <FatigueCard
                  items={(fatigue?.items ?? []) as FatigueItem[]}
                  updatedAt={fatigue?.createdAt ?? null}
                />
                <SearchTermCard
                  items={(searchTerms?.items ?? []) as SearchTermItem[]}
                  updatedAt={searchTerms?.createdAt ?? null}
                />
                <CompetitorCard
                  items={(competitors?.items ?? []) as CompetitorItem[]}
                  updatedAt={competitors?.createdAt ?? null}
                />
              </>
            );
          })()}
        </StatGrid>
      </BlockStack>
    </Layout.Section>
  );
}
