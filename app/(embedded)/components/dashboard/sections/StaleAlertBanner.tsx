import { Banner, Layout, Text } from "@shopify/polaris";
import type { PerJobHealth } from "../types";

export function StaleAlertBanner({ criticalJobs }: { criticalJobs: PerJobHealth[] }) {
  return (
    <Layout.Section>
      <Banner tone="critical">
        <Text as="p" fontWeight="semibold">
          {`${criticalJobs.length} job${criticalJobs.length !== 1 ? "s" : ""} missed 2+ cycles: ${criticalJobs.map((j) => j.label ?? j.jobName).join(", ")}`}
        </Text>
      </Banner>
    </Layout.Section>
  );
}
