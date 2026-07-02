export type DashboardJobName =
  | "dashboard-refresh"
  | "fetch-ads-data"
  | "fetch-blog-content"
  | "fetch-seo-data"
  | "fetch-gsc-data"
  | "snapshot-seo-history"
  | "fetch-market-intel"
  | "fetch-keyword-research"
  | "run-skills"
  | "execute-approved"
  | "index-knowledge"
  | "check-outcomes";

export type DashboardJobTriggerStrategy = "queued" | "cron" | "disabled";

export type DashboardJobDefinition = {
  name: DashboardJobName;
  label: string;
  manualTriggerEnabled: boolean;
  manualTriggerDisabledReason?: string;
  triggerStrategy: DashboardJobTriggerStrategy;
  cronPath?: string;
  cronCadence?: string;
  queueInput?: Record<string, unknown>;
  expectedCadenceHours?: number;
};

export const DASHBOARD_JOB_REGISTRY = [
  {
    name: "dashboard-refresh",
    label: "Dashboard Refresh",
    manualTriggerEnabled: true,
    triggerStrategy: "queued",
    cronCadence: "on demand",
    expectedCadenceHours: 24,
  },
  {
    name: "fetch-ads-data",
    label: "Fetch Ads Data",
    manualTriggerEnabled: true,
    triggerStrategy: "cron",
    cronPath: "/api/cron/fetch-ads-data",
    cronCadence: "daily",
    expectedCadenceHours: 24,
  },
  {
    name: "fetch-blog-content",
    label: "Fetch Blog Content",
    manualTriggerEnabled: false,
    manualTriggerDisabledReason: "Blog indexing is triggered by content workflows and scheduled cron.",
    triggerStrategy: "disabled",
    cronPath: "/api/cron/fetch-blog-content",
    cronCadence: "daily",
    expectedCadenceHours: 24,
  },
  {
    name: "fetch-seo-data",
    label: "Fetch SEO Data",
    manualTriggerEnabled: true,
    triggerStrategy: "cron",
    cronPath: "/api/cron/fetch-seo-data",
    cronCadence: "daily",
    expectedCadenceHours: 24,
  },
  {
    name: "fetch-gsc-data",
    label: "Fetch GSC Data",
    manualTriggerEnabled: true,
    triggerStrategy: "cron",
    cronPath: "/api/cron/fetch-gsc-data",
    cronCadence: "daily",
    expectedCadenceHours: 24,
  },
  {
    name: "snapshot-seo-history",
    label: "Snapshot SEO History",
    manualTriggerEnabled: false,
    manualTriggerDisabledReason: "SEO history snapshots are created after SEO data refreshes.",
    triggerStrategy: "disabled",
    cronPath: "/api/cron/snapshot-seo-history",
    cronCadence: "daily",
    expectedCadenceHours: 24,
  },
  {
    name: "fetch-market-intel",
    label: "Fetch Market Intelligence",
    manualTriggerEnabled: true,
    triggerStrategy: "queued",
    cronCadence: "daily",
    queueInput: { profile: "smoke" },
    expectedCadenceHours: 24,
  },
  {
    name: "fetch-keyword-research",
    label: "Fetch Keyword Research",
    manualTriggerEnabled: true,
    triggerStrategy: "queued",
    cronCadence: "weekly",
    expectedCadenceHours: 168,
  },
  {
    name: "run-skills",
    label: "Run Skills",
    manualTriggerEnabled: true,
    triggerStrategy: "cron",
    cronPath: "/api/cron/run-skills",
    cronCadence: "daily",
    expectedCadenceHours: 24,
  },
  {
    name: "execute-approved",
    label: "Execute Approved Recommendations",
    manualTriggerEnabled: true,
    triggerStrategy: "cron",
    cronPath: "/api/cron/execute-approved",
    cronCadence: "daily",
    expectedCadenceHours: 24,
  },
  {
    name: "index-knowledge",
    label: "Index Knowledge Base",
    manualTriggerEnabled: true,
    triggerStrategy: "cron",
    cronPath: "/api/cron/index-knowledge",
    cronCadence: "daily",
    expectedCadenceHours: 24,
  },
  {
    name: "check-outcomes",
    label: "Check Recommendation Outcomes",
    manualTriggerEnabled: true,
    triggerStrategy: "cron",
    cronPath: "/api/cron/check-outcomes",
    cronCadence: "daily",
    expectedCadenceHours: 24,
  },
] as const satisfies readonly DashboardJobDefinition[];

export const DASHBOARD_JOB_NAMES = DASHBOARD_JOB_REGISTRY.map((job) => job.name);

export const TRIGGERABLE_DASHBOARD_JOBS = DASHBOARD_JOB_REGISTRY.filter(
  (job) => job.manualTriggerEnabled,
);

export function getDashboardJob(name: string): DashboardJobDefinition | null {
  return DASHBOARD_JOB_REGISTRY.find((job) => job.name === name) ?? null;
}

export type QueuedDashboardJobName = Extract<
  DashboardJobName,
  "dashboard-refresh" | "fetch-market-intel" | "fetch-keyword-research"
>;

export const QUEUED_DASHBOARD_JOB_NAMES = DASHBOARD_JOB_REGISTRY
  .filter((job) => job.triggerStrategy === "queued")
  .map((job) => job.name) as QueuedDashboardJobName[];

export function isQueuedDashboardJob(name: DashboardJobName): name is QueuedDashboardJobName {
  return getDashboardJob(name)?.triggerStrategy === "queued";
}

export function isQueuedDashboardJobName(name: string): name is QueuedDashboardJobName {
  return (QUEUED_DASHBOARD_JOB_NAMES as string[]).includes(name);
}
