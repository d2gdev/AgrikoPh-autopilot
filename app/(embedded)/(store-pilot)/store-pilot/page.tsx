"use client";

import {
  Page, Layout, Card, Text, Badge, InlineStack, BlockStack, ProgressBar, DataTable, Tabs, Button, Banner, Toast, Select, TextField,
} from "@shopify/polaris";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthFetch, withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { getCache, setCache } from "@/lib/client-cache";
import { priorityTone } from "@/lib/ui/tones";
import { ApplyMapTaskModal } from "./components/ApplyMapTaskModal";
import { isTopicalMapTask, MapTaskDetails } from "./components/MapTaskDetails";

interface ProductImage {
  id: string;
  productId: string;
  productTitle: string;
  url: string;
  altText: string | null;
}

interface ImagesData {
  images: ProductImage[];
  total: number;
  missingAltText: number;
}

interface StoreTask {
  id: string;
  createdAt: string;
  taskType: string;
  targetType: string;
  targetId: string | null;
  targetUrl: string | null;
  title: string;
  description: string;
  proposedState: Record<string, unknown>;
  sourceData: Record<string, unknown>;
  priority: string;
  status: "pending" | "applying" | "reconciliation_needed" | "failed" | "completed" | "dismissed";
  completedAt: string | null;
  completionNote: string | null;
}

interface StoreTaskPage {
  tasks: StoreTask[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

type ExecutionClass = "actionable" | "advisory";
type TaskStatus = StoreTask["status"];
type SummaryKey = `${ExecutionClass}:${TaskStatus}`;

const PAGE_SIZE = 50;
const EXECUTION_TABS: Array<{ id: ExecutionClass; content: string }> = [
  { id: "actionable", content: "Actionable" },
  { id: "advisory", content: "Advisory" },
];
const STATUS_OPTIONS = [
  { label: "Pending", value: "pending" },
  { label: "Applying", value: "applying" },
  { label: "Reconciliation needed", value: "reconciliation_needed" },
  { label: "Failed", value: "failed" },
  { label: "Completed", value: "completed" },
  { label: "Dismissed", value: "dismissed" },
];
const summaryQueries = [
  ["actionable", "pending"],
  ["advisory", "pending"],
  ["actionable", "applying"],
  ["actionable", "reconciliation_needed"],
  ["actionable", "completed"],
  ["advisory", "completed"],
  ["actionable", "failed"],
  ["advisory", "failed"],
] as const;

function formatTaskType(type: string) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={priorityTone(priority)}>{priority}</Badge>;
}

function storeTaskUrl(params: Record<string, string | number>) {
  return `/api/store-tasks?${new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString()}`;
}

export default function StorePilotReportPage() {
  const authFetch = useAuthFetch();
  const router = useRouter();
  const [data, setData] = useState<ImagesData | null>(() => getCache<ImagesData>("/api/images"));
  const [loading, setLoading] = useState(() => !getCache("/api/images"));
  const [executionClass, setExecutionClass] = useState<ExecutionClass>("actionable");
  const [status, setStatus] = useState<TaskStatus>("pending");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [taskPage, setTaskPage] = useState<StoreTaskPage>({
    tasks: [], total: 0, page: 1, pageSize: PAGE_SIZE, hasMore: false,
  });
  const [summaryCounts, setSummaryCounts] = useState<Partial<Record<SummaryKey, number>>>({});
  const [tasksLoading, setTasksLoading] = useState(true);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [syncingMap, setSyncingMap] = useState(false);
  const [applyingTaskId, setApplyingTaskId] = useState<string | null>(null);
  const [selectedMapTask, setSelectedMapTask] = useState<StoreTask | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const mutationBusyRef = useRef(false);
  const mutationBusy = Boolean(syncingMap || applyingTaskId || updatingTaskId);

  function beginMutation(): boolean {
    if (mutationBusyRef.current) return false;
    mutationBusyRef.current = true;
    return true;
  }

  function endMutation() {
    mutationBusyRef.current = false;
  }

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    setTaskError(null);
    try {
      const activeParams: Record<string, string | number> = {
        executionClass, status, page, pageSize: PAGE_SIZE,
      };
      if (submittedSearch) activeParams.q = submittedSearch;
      const [activeResponse, ...summaryResponses] = await Promise.all([
        authFetch(storeTaskUrl(activeParams)),
        ...summaryQueries.map(([summaryClass, summaryStatus]) => authFetch(storeTaskUrl({
          executionClass: summaryClass,
          status: summaryStatus,
          page: 1,
          pageSize: 1,
        }))),
      ]);
      const [activePayload, ...summaryPayloads] = await Promise.all([
        activeResponse.json(),
        ...summaryResponses.map((response) => response.json()),
      ]);
      if (!activeResponse.ok) throw new Error(activePayload.error ?? "Store tasks failed to load.");
      const failedSummary = summaryResponses.findIndex((response) => !response.ok);
      if (failedSummary !== -1) {
        throw new Error(summaryPayloads[failedSummary]?.error ?? "Store task summaries failed to load.");
      }
      setTaskPage(activePayload as StoreTaskPage);
      setSummaryCounts(Object.fromEntries(summaryQueries.map(([summaryClass, summaryStatus], index) => [
        `${summaryClass}:${summaryStatus}`,
        Number(summaryPayloads[index]?.total ?? 0),
      ])) as Partial<Record<SummaryKey, number>>);
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Store tasks failed to load.");
    } finally {
      setTasksLoading(false);
    }
  }, [authFetch, executionClass, page, status, submittedSearch]);

  useEffect(() => {
    authFetch("/api/images")
      .then((response) => response.json())
      .then((nextData) => { setCache("/api/images", nextData); setData(nextData); setLoading(false); })
      .catch(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  async function updateTask(id: string, nextStatus: "completed" | "dismissed") {
    if (!beginMutation()) return;
    setUpdatingTaskId(id);
    setTaskError(null);
    try {
      const response = await authFetch("/api/store-tasks", {
        method: "PATCH",
        body: JSON.stringify({ id, status: nextStatus }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Task update failed.");
      await loadTasks();
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Task update failed.");
    } finally {
      setUpdatingTaskId(null);
      endMutation();
    }
  }

  async function syncTopicalMap() {
    if (!beginMutation()) return;
    setSyncingMap(true);
    setTaskError(null);
    try {
      const response = await authFetch("/api/store-tasks/topical-map/sync", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Topical-map synchronization failed.");
      await loadTasks();
      setToastMessage("Topical-map tasks synchronized.");
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Topical-map synchronization failed.");
    } finally {
      setSyncingMap(false);
      endMutation();
    }
  }

  async function applySelectedMapTask() {
    if (!selectedMapTask || !beginMutation()) return;
    setApplyingTaskId(selectedMapTask.id);
    setTaskError(null);
    try {
      const response = await authFetch(`/api/store-tasks/${selectedMapTask.id}/apply`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Topical-map change could not be applied.");
      setSelectedMapTask(null);
      await loadTasks();
      setToastMessage("The topical-map change was approved and queued.");
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Topical-map change could not be applied.");
    } finally {
      setApplyingTaskId(null);
      endMutation();
    }
  }

  async function selectMapTask(task: StoreTask) {
    setTaskError(null);
    try {
      const response = await authFetch(`/api/store-tasks/${task.id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Task detail failed to load.");
      setSelectedMapTask({ ...task, ...payload.task });
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "Task detail failed to load.");
    }
  }

  function submitSearch() {
    setPage(1);
    setSubmittedSearch(search.trim().slice(0, 200));
  }

  const total = data?.total ?? 0;
  const missing = data?.missingAltText ?? 0;
  const optimized = total - missing;
  const pct = total > 0 ? Math.round((optimized / total) * 100) : 0;
  const count = (summaryClass: ExecutionClass, summaryStatus: TaskStatus) => summaryCounts[`${summaryClass}:${summaryStatus}`] ?? 0;
  const queueCards = [
    ["Actionable", count("actionable", "pending")],
    ["Advisory", count("advisory", "pending")],
    ["Applying/Reconciliation", count("actionable", "applying") + count("actionable", "reconciliation_needed")],
    ["Completed", count("actionable", "completed") + count("advisory", "completed")],
    ["Failed", count("actionable", "failed") + count("advisory", "failed")],
  ] as const;

  const byProduct: Record<string, { title: string; total: number; missing: number }> = {};
  for (const image of data?.images ?? []) {
    if (!byProduct[image.productId]) byProduct[image.productId] = { title: image.productTitle, total: 0, missing: 0 };
    byProduct[image.productId]!.total++;
    if (!image.altText) byProduct[image.productId]!.missing++;
  }
  const rows = Object.values(byProduct).map((product) => [
    product.title,
    String(product.total),
    product.missing > 0 ? <Badge tone="warning">{`${product.missing} missing`}</Badge> : <Badge tone="success">All optimized</Badge>,
  ]);

  const taskRows = taskPage.tasks.map((task) => {
    const mapTask = isTopicalMapTask(task);
    const executable = mapTask && task.sourceData.executable === true;
    return [
      <BlockStack key={`${task.id}-task`} gap="100">
        <InlineStack gap="200" wrap>
          <PriorityBadge priority={task.priority} />
          <Badge>{formatTaskType(task.taskType)}</Badge>
          <Badge tone="info">{formatTaskType(task.targetType)}</Badge>
        </InlineStack>
        <Text as="p" fontWeight="semibold">{task.title}</Text>
        <Text as="p" tone="subdued" variant="bodySm">{task.description}</Text>
        {!mapTask && task.targetUrl ? <Text as="p" tone="subdued" variant="bodySm">{task.targetUrl}</Text> : null}
        {mapTask ? <MapTaskDetails task={task} compact /> : null}
        {task.completionNote ? <Text as="p" tone={task.status === "failed" || task.status === "reconciliation_needed" ? "critical" : "subdued"} variant="bodySm">{task.completionNote}</Text> : null}
      </BlockStack>,
      formatDate(task.createdAt),
      status === "pending" ? (
        <InlineStack key={`${task.id}-actions`} gap="200" wrap={false}>
          {executionClass === "actionable" && mapTask && executable ? <Button size="slim" onClick={() => selectMapTask(task)} disabled={mutationBusy}>Apply</Button> : null}
          {executionClass === "actionable" && !mapTask ? <Button size="slim" onClick={() => updateTask(task.id, "completed")} loading={updatingTaskId === task.id} disabled={mutationBusy}>Complete</Button> : null}
          <Button size="slim" tone="critical" variant="plain" onClick={() => updateTask(task.id, "dismissed")} loading={updatingTaskId === task.id} disabled={mutationBusy}>Dismiss</Button>
        </InlineStack>
      ) : status === "failed" ? (
        <Button key={`${task.id}-retry`} size="slim" onClick={syncTopicalMap} loading={syncingMap} disabled={mutationBusy}>Re-sync/retry</Button>
      ) : formatDate(task.completedAt),
    ];
  });

  return (
    <Page
      title="Store Pilot"
      subtitle="Shopify store optimization overview"
      secondaryActions={[{ content: "Manage Images", onAction: () => router.push(withShopifyContextUrl("/images")) }]}
    >
      <Layout>
        <Layout.Section>
          <InlineStack gap="400" wrap>
            {queueCards.map(([label, value]) => (
              <Card key={label}>
                <BlockStack gap="100">
                  <Text variant="headingSm" as="h3" tone="subdued">{label}</Text>
                  <Text variant="heading2xl" as="p">{tasksLoading ? "—" : value}</Text>
                </BlockStack>
              </Card>
            ))}
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">Store Task Queue</Text>
                  <Text as="p" tone="subdued">Review actionable work separately from advisory topical-map references.</Text>
                </BlockStack>
                <InlineStack gap="200" wrap>
                  <Button onClick={syncTopicalMap} loading={syncingMap} disabled={tasksLoading || mutationBusy}>Sync topical map</Button>
                  <Button onClick={loadTasks} loading={tasksLoading} disabled={mutationBusy}>Refresh</Button>
                </InlineStack>
              </InlineStack>
              {taskError ? <Banner tone="critical">{taskError}</Banner> : null}
              <Tabs
                tabs={EXECUTION_TABS}
                selected={executionClass === "actionable" ? 0 : 1}
                onSelect={(selected) => { setExecutionClass(EXECUTION_TABS[selected]!.id); setPage(1); }}
              />
              <InlineStack gap="300" blockAlign="end" wrap>
                <Select
                  label="Status"
                  options={STATUS_OPTIONS}
                  value={status}
                  onChange={(value) => { setStatus(value as TaskStatus); setPage(1); }}
                />
                <TextField label="Search Store Tasks" type="search" value={search} onChange={setSearch} autoComplete="off" />
                <Button onClick={submitSearch}>Search</Button>
              </InlineStack>
              {tasksLoading ? (
                <Text as="p" tone="subdued">Loading tasks...</Text>
              ) : taskRows.length === 0 ? (
                <Text as="p" tone="subdued">{executionClass === "actionable" ? "No actionable tasks match these filters." : "No advisory references match these filters."}</Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Task", "Created", status === "pending" ? "Action" : "Closed"]}
                  rows={taskRows}
                />
              )}
              <InlineStack align="space-between" blockAlign="center" wrap>
                <Button disabled={page === 1 || tasksLoading} onClick={() => setPage((value) => value - 1)}>Previous page</Button>
                <Text as="p">Page {taskPage.page} · {taskPage.total} matching tasks</Text>
                <Button disabled={!taskPage.hasMore || tasksLoading} onClick={() => setPage((value) => value + 1)}>Next page</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Image optimization</Text>
              <InlineStack gap="400" wrap>
                {[["Total Images", total], ["Alt Text Missing", missing], ["Optimized", optimized], ["SEO Coverage", `${pct}%`]].map(([label, value]) => (
                  <BlockStack key={label} gap="100">
                    <Text variant="headingSm" as="h3" tone="subdued">{label}</Text>
                    <Text variant="heading2xl" as="p">{loading ? "—" : value}</Text>
                  </BlockStack>
                ))}
              </InlineStack>
              {!loading && total > 0 ? (
                <BlockStack gap="200">
                  <ProgressBar progress={pct} tone={pct === 100 ? "success" : pct > 50 ? "highlight" : "critical"} />
                  <Text as="p" tone="subdued">{optimized} of {total} images have alt text</Text>
                </BlockStack>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">By Product</Text>
              {loading ? <Text as="p" tone="subdued">Loading…</Text> : rows.length === 0 ? <Text as="p" tone="subdued">No products found.</Text> : (
                <DataTable columnContentTypes={["text", "numeric", "text"]} headings={["Product", "Images", "Alt Text Status"]} rows={rows} />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      <ApplyMapTaskModal
        open={Boolean(selectedMapTask)}
        task={selectedMapTask}
        loading={Boolean(selectedMapTask && applyingTaskId === selectedMapTask.id)}
        disabled={mutationBusy}
        onClose={() => setSelectedMapTask(null)}
        onConfirm={applySelectedMapTask}
      />
      {toastMessage ? <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
    </Page>
  );
}
