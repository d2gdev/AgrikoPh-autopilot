"use client";

import {
  Page,
  Layout,
  Text,
  Button,
  Banner,
  InlineStack,
  BlockStack,
  Divider,
  Toast,
} from "@shopify/polaris";
import { TERMINAL_RUN_STATUSES, formatLoadedAt } from "./components/dashboard/helpers";
import { StaleAlertBanner } from "./components/dashboard/sections/StaleAlertBanner";
import { PendingRecInbox } from "./components/dashboard/sections/PendingRecInbox";
import { OperationsRow } from "./components/dashboard/sections/OperationsRow";
import { PerformanceRow } from "./components/dashboard/sections/PerformanceRow";
import { IntelRow } from "./components/dashboard/sections/IntelRow";
import { SkillInsightsSection } from "./components/dashboard/sections/SkillInsightsSection";
import { JobHealthSection } from "./components/dashboard/sections/JobHealthSection";
import { TrendsSection } from "./components/dashboard/sections/TrendsSection";
import { RecentActivity } from "./components/dashboard/sections/RecentActivity";
import { useDashboardData } from "./components/dashboard/useDashboardData";

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const {
    statusPanel,
    auditPanel,
    jobHistoryPanel,
    gscMoversPanel,
    activityPanel,
    adTrendPanel,
    recAction,
    triggering,
    toast,
    setToast,
    mutationError,
    setMutationError,
    activeRun,
    load,
    triggerAll,
    triggerJob,
    approveRec,
    rejectRec,
    retryPanel,
    data,
    logs,
    jobHistory,
    gscMovers,
    activityDays,
    adTrend,
    loading,
    loadError,
    spend,
    spendSign,
    contentLiftValue,
    contentLiftSign,
    totalActionsThisMonth,
    sortedJobs,
    criticalJobs,
  } = useDashboardData();

  return (
    <>
      <Page
        title="Autopilot Dashboard"
        primaryAction={
          <Button onClick={triggerAll} loading={triggering} variant="primary">
            Run Now
          </Button>
        }
      >
        <Layout>
          {loadError && (
            <Layout.Section>
              <Banner tone="critical">
                <BlockStack gap="200">
                  <Text as="p">Failed to load dashboard data: {loadError}</Text>
                  <InlineStack>
                    <Button size="slim" onClick={() => void load(["status"])}>Retry status</Button>
                  </InlineStack>
                </BlockStack>
              </Banner>
            </Layout.Section>
          )}

          {statusPanel.status === "stale" && data && (
            <Layout.Section>
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p">
                    Showing stale dashboard status from {formatLoadedAt(statusPanel.loadedAt)}.
                    {statusPanel.error ? ` Refresh failed: ${statusPanel.error}` : ""}
                  </Text>
                  <InlineStack>
                    <Button size="slim" onClick={() => void load(["status"])}>Retry status</Button>
                  </InlineStack>
                </BlockStack>
              </Banner>
            </Layout.Section>
          )}

          {mutationError && (
            <Layout.Section>
              <Banner tone="critical" onDismiss={() => setMutationError(null)}>
                {mutationError}
              </Banner>
            </Layout.Section>
          )}

          {activeRun && !TERMINAL_RUN_STATUSES.has(activeRun.status) && (
            <Layout.Section>
              <Banner tone={activeRun.error ? "warning" : "info"}>
                <BlockStack gap="100">
                  <Text as="p" fontWeight="semibold">
                    {activeRun.label} is {activeRun.status}
                  </Text>
                  <Text as="p" tone="subdued">
                    Polling run status from /api/jobs/status.
                    {activeRun.error ? ` Last poll error: ${activeRun.error}` : ""}
                  </Text>
                </BlockStack>
              </Banner>
            </Layout.Section>
          )}

          {/* ── Stale job alert banner ── */}
          {data && criticalJobs.length > 0 && (
            <StaleAlertBanner criticalJobs={criticalJobs} />
          )}

          {/* ── Pending rec inbox ── */}
          {(data?.topPendingRecs?.length ?? 0) > 0 && (
            <PendingRecInbox
              pendingCount={data!.pendingCount}
              topPendingRecs={data!.topPendingRecs!}
              recAction={recAction}
              onApprove={approveRec}
              onReject={rejectRec}
            />
          )}

          {/* ── Operations row ── */}
          <OperationsRow loading={loading} data={data} />

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Performance row ── */}
          <PerformanceRow
            loading={loading}
            data={data}
            spend={spend}
            spendSign={spendSign}
            totalActionsThisMonth={totalActionsThisMonth}
            gscMoversPanel={gscMoversPanel}
            gscMovers={gscMovers}
            onRetryGscMovers={() => retryPanel("gscMovers")}
          />

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Intel row ── */}
          <IntelRow loading={loading} data={data} />

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Skill Insights ── */}
          <SkillInsightsSection loading={loading} data={data} />

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Job Health ── */}
          <JobHealthSection
            loading={loading}
            jobHistoryPanel={jobHistoryPanel}
            jobHistory={jobHistory}
            sortedJobs={sortedJobs}
            onRetryJobHistory={() => retryPanel("jobHistory")}
            onTrigger={triggerJob}
            onToast={setToast}
          />

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Trends ── */}
          <TrendsSection
            activityPanel={activityPanel}
            adTrendPanel={adTrendPanel}
            activityDays={activityDays}
            adTrend={adTrend}
            contentLift={data?.contentLift}
            contentLiftValue={contentLiftValue}
            contentLiftSign={contentLiftSign}
            onRetryActivity={() => retryPanel("activity")}
            onRetryAdTrend={() => retryPanel("adTrend")}
          />

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Recent Activity ── */}
          <RecentActivity
            auditPanel={auditPanel}
            logs={logs}
            onRetry={() => retryPanel("audit")}
          />
        </Layout>
      </Page>

      {toast && <Toast content={toast} onDismiss={() => setToast(null)} />}
    </>
  );
}
