"use client";

import {
  Page, Layout, Card, Text, Badge, InlineStack, BlockStack, ProgressBar, DataTable, Tabs, Button, Banner, Toast,
} from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
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
  status: "pending" | "completed" | "dismissed";
  completedAt: string | null;
  completionNote: string | null;
}

interface TaskBucket {
  tasks: StoreTask[];
  total: number;
}

const TASK_TABS = [
  { id: "pending", content: "Pending" },
  { id: "completed", content: "Completed" },
  { id: "dismissed", content: "Dismissed" },
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

export default function StorePilotReportPage() {
  const authFetch = useAuthFetch();
  const router = useRouter();
  const [data, setData] = useState<ImagesData | null>(() => getCache<ImagesData>("/api/images"));
  const [loading, setLoading] = useState(() => !getCache("/api/images"));
  const [taskTab, setTaskTab] = useState(0);
  const [taskBuckets, setTaskBuckets] = useState<Record<(typeof TASK_TABS)[number]["id"], TaskBucket>>({
    pending: { tasks: [], total: 0 },
    completed: { tasks: [], total: 0 },
    dismissed: { tasks: [], total: 0 },
  });
  const [tasksLoading, setTasksLoading] = useState(true);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [syncingMap, setSyncingMap] = useState(false);
  const [applyingTaskId, setApplyingTaskId] = useState<string | null>(null);
  const [selectedMapTask, setSelectedMapTask] = useState<StoreTask | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    setTaskError(null);
    try {
      const entries = await Promise.all(
        TASK_TABS.map(async (tab) => {
          const res = await authFetch(`/api/store-tasks?status=${tab.id}`);
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? `Failed to load ${tab.id} tasks`);
          return [tab.id, { tasks: json.tasks ?? [], total: json.total ?? 0 }] as const;
        }),
      );
      setTaskBuckets(Object.fromEntries(entries) as Record<(typeof TASK_TABS)[number]["id"], TaskBucket>);
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Store tasks failed to load.");
    } finally {
      setTasksLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    authFetch("/api/images")
      .then((r) => r.json())
      .then((d) => { setCache("/api/images", d); setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  async function updateTask(id: string, status: "completed" | "dismissed") {
    setUpdatingTaskId(id);
    setTaskError(null);
    try {
      const res = await authFetch("/api/store-tasks", {
        method: "PATCH",
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Task update failed.");
      await loadTasks();
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Task update failed.");
    } finally {
      setUpdatingTaskId(null);
    }
  }

  async function syncTopicalMap() {
    setSyncingMap(true);
    setTaskError(null);
    try {
      const res = await authFetch("/api/store-tasks/topical-map/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Topical-map synchronization failed.");
      await loadTasks();
      setToastMessage("Topical-map tasks synchronized.");
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Topical-map synchronization failed.");
    } finally {
      setSyncingMap(false);
    }
  }

  async function applySelectedMapTask() {
    if (!selectedMapTask) return;
    setApplyingTaskId(selectedMapTask.id);
    setTaskError(null);
    try {
      const res = await authFetch(`/api/store-tasks/${selectedMapTask.id}/apply`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Topical-map change could not be applied.");
      setSelectedMapTask(null);
      await loadTasks();
      setToastMessage("The topical-map change was applied.");
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Topical-map change could not be applied.");
    } finally {
      setApplyingTaskId(null);
    }
  }

  const total = data?.total ?? 0;
  const missing = data?.missingAltText ?? 0;
  const optimized = total - missing;
  const pct = total > 0 ? Math.round((optimized / total) * 100) : 0;
  const activeTaskStatus = TASK_TABS[taskTab]!.id;
  const activeTasks = taskBuckets[activeTaskStatus]?.tasks ?? [];
  const pendingTaskCount = taskBuckets.pending.total;
  const completedTaskCount = taskBuckets.completed.total;
  const dismissedTaskCount = taskBuckets.dismissed.total;

  // Group images by product for the table
  const byProduct: Record<string, { title: string; total: number; missing: number }> = {};
  for (const img of data?.images ?? []) {
    if (!byProduct[img.productId]) {
      byProduct[img.productId] = { title: img.productTitle, total: 0, missing: 0 };
    }
    byProduct[img.productId]!.total++;
    if (!img.altText) byProduct[img.productId]!.missing++;
  }

  const rows = Object.values(byProduct).map((p) => [
    p.title,
    String(p.total),
    p.missing > 0 ? (
      <Badge tone="warning">{`${p.missing} missing`}</Badge>
    ) : (
      <Badge tone="success">All optimized</Badge>
    ),
  ]);

  const taskRows = activeTasks.map((task) => {
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
      {task.targetUrl ? (
        <Text as="p" tone="subdued" variant="bodySm">{task.targetUrl}</Text>
      ) : null}
      {mapTask ? <MapTaskDetails task={task} compact /> : null}
    </BlockStack>,
    formatDate(task.createdAt),
    activeTaskStatus === "pending" ? (
      <InlineStack key={`${task.id}-actions`} gap="200" wrap={false}>
        {mapTask ? (executable ? <Button size="slim" onClick={() => setSelectedMapTask(task)} disabled={Boolean(updatingTaskId || applyingTaskId || syncingMap)}>Apply</Button> : null) : (
          <Button size="slim" onClick={() => updateTask(task.id, "completed")} loading={updatingTaskId === task.id}>Complete</Button>
        )}
        <Button
          size="slim"
          tone="critical"
          variant="plain"
          onClick={() => updateTask(task.id, "dismissed")}
          loading={updatingTaskId === task.id}
          disabled={Boolean(updatingTaskId || applyingTaskId || syncingMap)}
        >
          Dismiss
        </Button>
      </InlineStack>
    ) : (
      formatDate(task.completedAt)
    ),
    ];
  });

  return (
    <Page
      title="Store Pilot"
      subtitle="Shopify store optimization overview"
      secondaryActions={[
        { content: "Manage Images", onAction: () => router.push(withShopifyContextUrl("/images")) },
      ]}
    >
      <Layout>
        <Layout.Section>
          <InlineStack gap="400" wrap>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">Pending Tasks</Text>
                <Text variant="heading2xl" as="p">{tasksLoading ? "—" : pendingTaskCount}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">Completed</Text>
                <Text variant="heading2xl" as="p">{tasksLoading ? "—" : completedTaskCount}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">Dismissed</Text>
                <Text variant="heading2xl" as="p">{tasksLoading ? "—" : dismissedTaskCount}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">Total Images</Text>
                <Text variant="heading2xl" as="p">{loading ? "—" : total}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">Alt Text Missing</Text>
                <Text variant="heading2xl" as="p">{loading ? "—" : missing}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">Optimized</Text>
                <Text variant="heading2xl" as="p">{loading ? "—" : optimized}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">SEO Coverage</Text>
                <Text variant="heading2xl" as="p">{loading ? "—" : `${pct}%`}</Text>
              </BlockStack>
            </Card>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">Store Task Queue</Text>
                  <Text as="p" tone="subdued">Review routed market and store opportunities before changing Shopify or pricing decisions.</Text>
                </BlockStack>
                <InlineStack gap="200" wrap>
                  <Button onClick={syncTopicalMap} loading={syncingMap} disabled={tasksLoading || Boolean(updatingTaskId || applyingTaskId)}>Sync topical map</Button>
                  <Button onClick={loadTasks} loading={tasksLoading} disabled={syncingMap || Boolean(updatingTaskId || applyingTaskId)}>Refresh</Button>
                </InlineStack>
              </InlineStack>
              {taskError ? (
                <Banner tone="critical">{taskError}</Banner>
              ) : null}
              <Tabs
                tabs={TASK_TABS.map((tab) => ({
                  id: tab.id,
                  content: `${tab.content} (${taskBuckets[tab.id]?.total ?? 0})`,
                }))}
                selected={taskTab}
                onSelect={setTaskTab}
              />
              {tasksLoading ? (
                <Text as="p" tone="subdued">Loading tasks...</Text>
              ) : taskRows.length === 0 ? (
                <Text as="p" tone="subdued">No {activeTaskStatus} store tasks.</Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Task", "Created", activeTaskStatus === "pending" ? "Action" : "Closed"]}
                  rows={taskRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {!loading && total > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Alt Text Coverage</Text>
                <ProgressBar progress={pct} tone={pct === 100 ? "success" : pct > 50 ? "highlight" : "critical"} />
                <Text as="p" tone="subdued">{optimized} of {total} images have alt text</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">By Product</Text>
              {loading ? (
                <Text as="p" tone="subdued">Loading…</Text>
              ) : rows.length === 0 ? (
                <Text as="p" tone="subdued">No products found.</Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "numeric", "text"]}
                  headings={["Product", "Images", "Alt Text Status"]}
                  rows={rows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      <ApplyMapTaskModal
        open={Boolean(selectedMapTask)}
        task={selectedMapTask}
        loading={Boolean(selectedMapTask && applyingTaskId === selectedMapTask.id)}
        onClose={() => setSelectedMapTask(null)}
        onConfirm={applySelectedMapTask}
      />
      {toastMessage ? <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
    </Page>
  );
}
