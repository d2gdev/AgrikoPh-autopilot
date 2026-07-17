"use client";

import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Pagination,
  Select,
  SkeletonBodyText,
  Text,
  TextField,
} from "@shopify/polaris";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { SeoTaskForm } from "./SeoTaskForm";
import { SeoTaskRow } from "./SeoTaskRow";

export type SeoTaskBucket = "ready" | "waiting" | "scheduled" | "closed";

export type SeoTaskView = {
  id: string;
  version: number;
  taskType: string;
  title: string;
  targetUrl: string | null;
  topicalCluster: string | null;
  pageRole: string | null;
  priority: "P0" | "P1" | "P2" | "P3";
  earliestReviewAt: string;
  dueAt: string | null;
  requiresEvidence: boolean;
  evidenceStatus: string;
  status: "open" | "completed" | "cancelled";
  completionPreflight: {
    status: "clear" | "already_handled" | "closed";
    basis: "task_and_audit_history";
    checkedAt: string;
  };
  bucket: SeoTaskBucket;
  overdue: boolean;
};

export type SeoTaskDetail = SeoTaskView & {
  description: string;
  ownerSurface: string;
  destinationPath: string | null;
  evidenceRequirement: unknown;
  evidenceSnapshot: unknown;
  lastEvaluatedAt: string | null;
  sourceType: string;
  sourceKey: string;
  completedAt: string | null;
  completionNote: string | null;
};

type ListResponse = {
  tasks: SeoTaskView[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  counts: Record<SeoTaskBucket, number>;
  asOf: string;
};

const BUCKETS: Array<{ value: SeoTaskBucket; label: string }> = [
  { value: "ready", label: "Ready now" },
  { value: "waiting", label: "Waiting for evidence" },
  { value: "scheduled", label: "Scheduled" },
  { value: "closed", label: "Closed" },
];

const TASK_TYPES = [
  { label: "All task types", value: "all" },
  { label: "Canonical transfer", value: "canonical_transfer_review" },
  { label: "CTR experiment", value: "ctr_experiment_review" },
  { label: "Indexation", value: "indexation_review" },
  { label: "Content quality", value: "content_quality_review" },
  { label: "Cohort", value: "cohort_review" },
  { label: "Technical", value: "technical_review" },
  { label: "Other", value: "other" },
];

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  return typeof body.error === "string" ? body.error.slice(0, 300) : fallback;
}

export function SeoTaskBoard() {
  const authFetch = useAuthFetch();
  const requestRef = useRef(0);
  const [bucket, setBucket] = useState<SeoTaskBucket>("ready");
  const [priority, setPriority] = useState("all");
  const [taskType, setTaskType] = useState("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [counts, setCounts] = useState<Record<SeoTaskBucket, number>>({
    ready: 0,
    waiting: 0,
    scheduled: 0,
    closed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setData(null);
    setListError(null);
    const shared = new URLSearchParams({ priority, taskType, q: query });
    const listParams = new URLSearchParams(shared);
    listParams.set("bucket", bucket);
    listParams.set("page", String(page));
    listParams.set("pageSize", "25");
    try {
      const response = await authFetch(`/api/seo/tasks?${listParams.toString()}`);
      if (requestRef.current !== requestId) return;
      if (!response.ok) {
        const message = await responseError(response, "SEO task list is unavailable.");
        if (requestRef.current === requestId) setListError(message);
        return;
      }
      const result = await response.json() as ListResponse;
      if (requestRef.current !== requestId) return;
      setData(result);
      setCounts(result.counts);
    } catch {
      if (requestRef.current === requestId) {
        setListError("SEO task list is unavailable.");
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [authFetch, bucket, page, priority, query, taskType]);

  useEffect(() => { void load(); }, [load]);

  function selectBucket(next: SeoTaskBucket) {
    setBucket(next);
    setPage(1);
  }

  function applySearch() {
    setQuery(searchDraft.trim());
    setPage(1);
  }

  return (
    <Page
      title="SEO Tasks"
      subtitle="Review work when its date and evidence are ready."
      primaryAction={{ content: adding ? "Close form" : "Add task", onAction: () => setAdding((value) => !value) }}
      secondaryActions={[{ content: "Refresh", onAction: () => void load() }]}
    >
      <Layout>
        {adding && (
          <Layout.Section>
            <SeoTaskForm onSaved={() => { setAdding(false); void load(); }} onCancel={() => setAdding(false)} />
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" wrap>
                {BUCKETS.map((item) => (
                  <Button
                    key={item.value}
                    variant={bucket === item.value ? "primary" : "secondary"}
                    accessibilityLabel={`${item.label}, ${counts[item.value]} ${counts[item.value] === 1 ? "task" : "tasks"}`}
                    onClick={() => selectBucket(item.value)}
                  >
                    {`${item.label} (${counts[item.value]})`}
                  </Button>
                ))}
              </InlineStack>
              <InlineStack gap="300" wrap blockAlign="end">
                <TextField
                  label="Search SEO tasks"
                  value={searchDraft}
                  onChange={setSearchDraft}
                  autoComplete="off"
                  type="search"
                />
                <Button onClick={applySearch}>Search</Button>
                <Select
                  label="Priority"
                  value={priority}
                  onChange={(value) => { setPriority(value); setPage(1); }}
                  options={[
                    { label: "All priorities", value: "all" },
                    ...["P0", "P1", "P2", "P3"].map((value) => ({ label: value, value })),
                  ]}
                />
                <Select
                  label="Task type"
                  value={taskType}
                  onChange={(value) => { setTaskType(value); setPage(1); }}
                  options={TASK_TYPES}
                />
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          {listError && <Banner tone="critical">{listError}</Banner>}
          {loading && !data ? (
            <Card><SkeletonBodyText lines={5} /></Card>
          ) : data?.tasks.length ? (
            <BlockStack gap="200">
              {data.tasks.map((task) => <SeoTaskRow key={task.id} task={task} onChanged={load} />)}
              <InlineStack align="center">
                <Pagination
                  hasPrevious={page > 1}
                  hasNext={data.hasMore}
                  onPrevious={() => setPage((value) => Math.max(1, value - 1))}
                  onNext={() => setPage((value) => value + 1)}
                  accessibilityLabels={{ previous: "Previous page", next: "Next page" }}
                />
              </InlineStack>
            </BlockStack>
          ) : (
            <Card>
              <BlockStack gap="100">
                <Text as="p" variant="headingMd">
                  {query || priority !== "all" || taskType !== "all" ? "No tasks match these filters" : `No ${bucket} SEO tasks`}
                </Text>
                <Text as="p" tone="subdued">
                  {query || priority !== "all" || taskType !== "all"
                    ? "Clear or change the filters to see other work."
                    : "There is no work in this review state yet."}
                </Text>
              </BlockStack>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
