import { BlockStack, Card, Layout, Text } from "@shopify/polaris";
import type { PanelState } from "@/lib/dashboard/client-state";
import type { JobHistoryMap, PerJobHealth } from "../types";
import { PanelNotice } from "../helpers";
import { JobRow, JobHealthSkeleton } from "../JobHealth";

export function JobHealthSection({
  loading,
  jobHistoryPanel,
  jobHistory,
  sortedJobs,
  onRetryJobHistory,
  onTrigger,
  onToast,
}: {
  loading: boolean;
  jobHistoryPanel: PanelState<JobHistoryMap>;
  jobHistory: JobHistoryMap;
  sortedJobs: PerJobHealth[];
  onRetryJobHistory: () => void;
  onTrigger: (jobName: string) => void;
  onToast: (message: string) => void;
}) {
  return (
    <Layout.Section>
      <Card>
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text variant="headingMd" as="h2">Job Health</Text>
            <Text as="p" tone="subdued">
              Row colour: green = on track, amber = one cycle missed (&gt;26h), red = two+ cycles missed (&gt;50h). Dots = last 7 runs, newest right.
            </Text>
          </BlockStack>
          <PanelNotice
            panel={jobHistoryPanel}
            label="Job history"
            staleLabel="Job history"
            onRetry={onRetryJobHistory}
          />
          {loading ? (
            <JobHealthSkeleton />
          ) : !sortedJobs.length ? (
            <Text as="p" tone="subdued">No job history yet.</Text>
          ) : (
            <BlockStack gap="150">
              {sortedJobs.map((job) => (
                <JobRow
                  key={job.jobName}
                  job={job}
                  history={jobHistory[job.jobName] ?? []}
                  onTrigger={onTrigger}
                  onToast={onToast}
                />
              ))}
            </BlockStack>
          )}
        </BlockStack>
      </Card>
    </Layout.Section>
  );
}
