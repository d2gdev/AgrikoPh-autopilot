"use client";

import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineStack,
  Layout,
  Page,
  SkeletonBodyText,
  Text,
  TextField,
} from "@shopify/polaris";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";

type BacklogStatus = "open" | "completed";

type BacklogItem = {
  id: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  title: string;
  description: string;
  dueAt: string;
  status: BacklogStatus;
  createdBy: string;
  updatedBy: string;
  completedAt: string | null;
  overdue: boolean;
};

type BacklogResponse = {
  items: BacklogItem[];
  counts: { open: number; completed: number };
  asOf: string;
};

function formatDueDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function dateInputValue(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dueDateToIso(value: string): string {
  return new Date(`${value}T23:59:59.999+08:00`).toISOString();
}

export default function BacklogPage() {
  const authFetch = useAuthFetch();
  const [status, setStatus] = useState<BacklogStatus>("open");
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [counts, setCounts] = useState({ open: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<"new" | BacklogItem | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (nextStatus: BacklogStatus) => {
    setLoading(true);
    setError(null);
    const response = await authFetch(
      `/api/backlog?status=${nextStatus}`,
    ).catch(() => null);
    if (!response?.ok) {
      const body = await response?.json().catch(() => ({})) as
        { error?: string } | undefined;
      setItems([]);
      setCounts({ open: 0, completed: 0 });
      setError(body?.error ?? "Backlog could not be loaded.");
      setLoading(false);
      return;
    }
    const body = await response.json() as BacklogResponse;
    setItems(body.items);
    setCounts(body.counts);
    setLoading(false);
  }, [authFetch]);

  useEffect(() => {
    void load(status);
  }, [load, status]);

  function openCreate() {
    setEditor("new");
    setTitle("");
    setDescription("");
    setDueDate("");
    setError(null);
  }

  function openEdit(item: BacklogItem) {
    setEditor(item);
    setTitle(item.title);
    setDescription(item.description);
    setDueDate(dateInputValue(item.dueAt));
    setError(null);
  }

  async function save() {
    if (!title.trim() || !description.trim() || !dueDate || saving) return;
    setSaving(true);
    setError(null);
    const creating = editor === "new";
    const url = creating
      ? "/api/backlog"
      : `/api/backlog/${(editor as BacklogItem).id}`;
    const body = creating
      ? {
          title: title.trim(),
          description: description.trim(),
          dueAt: dueDateToIso(dueDate),
        }
      : {
          action: "edit",
          expectedVersion: (editor as BacklogItem).version,
          fields: {
            title: title.trim(),
            description: description.trim(),
            dueAt: dueDateToIso(dueDate),
          },
        };
    const response = await authFetch(url, {
      method: creating ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!response?.ok) {
      const result = await response?.json().catch(() => ({})) as
        { error?: string } | undefined;
      setError(result?.error ?? "Backlog item could not be saved.");
      setSaving(false);
      return;
    }
    setEditor(null);
    setSaving(false);
    await load(status);
  }

  async function changeStatus(item: BacklogItem) {
    setError(null);
    const action = item.status === "open" ? "complete" : "reopen";
    const response = await authFetch(`/api/backlog/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        expectedVersion: item.version,
      }),
    }).catch(() => null);
    if (!response?.ok) {
      const result = await response?.json().catch(() => ({})) as
        { error?: string } | undefined;
      setError(result?.error ?? "Backlog item could not be updated.");
      return;
    }
    await load(status);
  }

  async function remove(item: BacklogItem) {
    if (!window.confirm(`Delete "${item.title}" from the backlog?`)) return;
    setError(null);
    const response = await authFetch(`/api/backlog/${item.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: item.version }),
    }).catch(() => null);
    if (!response?.ok) {
      const result = await response?.json().catch(() => ({})) as
        { error?: string } | undefined;
      setError(result?.error ?? "Backlog item could not be deleted.");
      return;
    }
    await load(status);
  }

  const valid = Boolean(title.trim() && description.trim() && dueDate);

  return (
    <Page
      title="Backlog"
      subtitle="Deferred work and checks that need a clear due date."
      primaryAction={{
        content: "Add backlog item",
        onAction: openCreate,
      }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {error && <Banner tone="critical">{error}</Banner>}
            <InlineStack gap="200">
              <Button
                variant={status === "open" ? "primary" : undefined}
                accessibilityLabel={`Open backlog, ${counts.open} ${
                  counts.open === 1 ? "item" : "items"
                }`}
                onClick={() => setStatus("open")}
              >
                {`Open (${counts.open})`}
              </Button>
              <Button
                variant={status === "completed" ? "primary" : undefined}
                accessibilityLabel={`Completed backlog, ${counts.completed} ${
                  counts.completed === 1 ? "item" : "items"
                }`}
                onClick={() => setStatus("completed")}
              >
                {`Completed (${counts.completed})`}
              </Button>
            </InlineStack>

            {editor && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {editor === "new" ? "Add backlog item" : "Edit backlog item"}
                  </Text>
                  <TextField
                    label="Title"
                    value={title}
                    onChange={setTitle}
                    autoComplete="off"
                  />
                  <TextField
                    label="Description"
                    value={description}
                    onChange={setDescription}
                    multiline={3}
                    autoComplete="off"
                  />
                  <TextField
                    label="Due date"
                    type="date"
                    value={dueDate}
                    onChange={setDueDate}
                    autoComplete="off"
                  />
                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      onClick={() => void save()}
                      loading={saving}
                      disabled={!valid}
                    >
                      {editor === "new" ? "Create item" : "Save changes"}
                    </Button>
                    <Button onClick={() => setEditor(null)}>Cancel</Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {loading ? (
              <Card>
                <SkeletonBodyText lines={4} />
              </Card>
            ) : items.length === 0 ? (
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    {status === "open"
                      ? "No open backlog items"
                      : "No completed backlog items"}
                  </Text>
                  <Text as="p" tone="subdued">
                    {status === "open"
                      ? "Add deferred work here when it needs a firm follow-up date."
                      : "Completed items remain available here for reference."}
                  </Text>
                </BlockStack>
              </Card>
            ) : (
              <Card>
                <BlockStack gap="400">
                  {items.map((item, index) => (
                    <BlockStack gap="200" key={item.id}>
                      {index > 0 && <Divider />}
                      <InlineStack align="space-between" gap="300">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                              {item.title}
                            </Text>
                            {item.overdue ? (
                              <Badge tone="critical">Overdue</Badge>
                            ) : item.status === "completed" ? (
                              <Badge tone="success">Completed</Badge>
                            ) : (
                              <Badge tone="attention">Open</Badge>
                            )}
                          </InlineStack>
                          <Text as="p">{item.description}</Text>
                          <Text as="p" tone={item.overdue ? "critical" : "subdued"}>
                            Due {formatDueDate(item.dueAt)}
                          </Text>
                        </BlockStack>
                        <InlineStack gap="200">
                          <Button
                            onClick={() => openEdit(item)}
                            accessibilityLabel={`Edit ${item.title}`}
                          >
                            Edit
                          </Button>
                          <Button
                            onClick={() => void changeStatus(item)}
                            accessibilityLabel={`${
                              item.status === "open" ? "Complete" : "Reopen"
                            } ${item.title}`}
                          >
                            {item.status === "open" ? "Complete" : "Reopen"}
                          </Button>
                          <Button
                            tone="critical"
                            onClick={() => void remove(item)}
                            accessibilityLabel={`Delete ${item.title}`}
                          >
                            Delete
                          </Button>
                        </InlineStack>
                      </InlineStack>
                    </BlockStack>
                  ))}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
