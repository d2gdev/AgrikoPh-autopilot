"use client";

import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { SeoTaskForm } from "./SeoTaskForm";
import type { SeoTaskDetail, SeoTaskView } from "./SeoTaskBoard";

function formatDate(value: string | null): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function bucketReason(task: SeoTaskView): string {
  if (task.bucket === "closed") return task.status === "completed" ? "Completed" : "Cancelled";
  if (task.bucket === "scheduled") return `Review opens ${formatDate(task.earliestReviewAt)}`;
  if (task.bucket === "ready") return "Review date reached and evidence is ready";
  return task.requiresEvidence ? `Waiting for ${task.evidenceStatus.replace("_", " ")} evidence` : "Waiting for review readiness";
}

export function SeoTaskRow({ task, onChanged }: { task: SeoTaskView; onChanged: () => void }) {
  const authFetch = useAuthFetch();
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<SeoTaskDetail | null>(null);
  const [history, setHistory] = useState<Array<{
    id: string;
    action: string;
    actor: string;
    createdAt: string;
  }> | null>(null);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<"evidence" | "complete" | "cancel" | null>(null);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [evidenceStatus, setEvidenceStatus] = useState(task.evidenceStatus);
  const [evidenceSnapshot, setEvidenceSnapshot] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleExpanded() {
    const opening = !expanded;
    setExpanded(opening);
    if (!opening || detail !== null) return;
    const response = await authFetch(`/api/seo/tasks/${task.id}`).catch(() => null);
    if (!response?.ok) {
      setError("Decision history could not be loaded.");
      return;
    }
    const result = await response.json() as {
      task?: Omit<SeoTaskDetail, "bucket" | "overdue">;
      history?: Array<{
        id: string;
        action: string;
        actor: string;
        createdAt: string;
      }>;
    };
    if (!result.task) {
      setError("Task details could not be loaded.");
      return;
    }
    const loadedDetail = { ...task, ...result.task };
    setDetail(loadedDetail);
    setEvidenceStatus(loadedDetail.evidenceStatus);
    setEvidenceSnapshot(
      loadedDetail.evidenceSnapshot ? JSON.stringify(loadedDetail.evidenceSnapshot, null, 2) : "",
    );
    setHistory(result.history ?? []);
  }

  async function mutate(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    const response = await authFetch(`/api/seo/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: task.version, ...body }),
    }).catch(() => null);
    if (!response?.ok) {
      const result = await response?.json().catch(() => ({})) as { error?: string } | undefined;
      setError(result?.error?.slice(0, 300) ?? "The SEO task could not be updated.");
      setSaving(false);
      return;
    }
    setSaving(false);
    setAction(null);
    setNote("");
    setConfirmed(false);
    setExpanded(false);
    setDetail(null);
    setHistory(null);
    onChanged();
  }

  function saveEvidence() {
    let snapshot: unknown = null;
    if (evidenceSnapshot.trim()) {
      try {
        snapshot = JSON.parse(evidenceSnapshot);
      } catch {
        setError("Evidence snapshot must be valid JSON.");
        return;
      }
    }
    void mutate({ action: "update_evidence", evidenceStatus, evidenceSnapshot: snapshot });
  }

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
          <BlockStack gap="100">
            <InlineStack gap="150" wrap>
              <Badge tone={task.priority === "P0" ? "critical" : task.priority === "P1" ? "warning" : undefined}>
                {task.priority}
              </Badge>
              <Badge>{task.taskType.replaceAll("_", " ")}</Badge>
              <Text as="h2" variant="headingMd">{task.title}</Text>
            </InlineStack>
            <Text as="p" tone="subdued">
              {task.targetUrl ?? "No target path"} · {task.topicalCluster ?? "No cluster"} · {task.pageRole ?? "No page role"}
            </Text>
            <Text as="p">
              {bucketReason(task)}. Evidence: {task.evidenceStatus.replace("_", " ")}.
              {task.overdue ? " Overdue." : ""}
            </Text>
          </BlockStack>
          <Button
            accessibilityLabel={`${expanded ? "Hide" : "View"} details for ${task.title}`}
            disclosure={expanded ? "up" : "down"}
            onClick={() => void toggleExpanded()}
          >
            {expanded ? "Hide details" : "View details"}
          </Button>
        </InlineStack>

        {expanded && (
          <>
            <Divider />
            {detail === null ? (
              <Text as="p" tone="subdued">Loading task details…</Text>
            ) : (
            <BlockStack gap="300">
              <Text as="p">{detail.description}</Text>
              <Text as="p"><strong>Review date:</strong> {formatDate(detail.earliestReviewAt)}</Text>
              <Text as="p"><strong>Due date:</strong> {formatDate(detail.dueAt)}</Text>
              <Text as="p"><strong>Evidence required:</strong> {JSON.stringify(detail.evidenceRequirement)}</Text>
              <Text as="p"><strong>Evidence snapshot:</strong> {detail.evidenceSnapshot ? JSON.stringify(detail.evidenceSnapshot) : "None recorded"}</Text>
              <Text as="p"><strong>Source:</strong> {detail.sourceType} · {detail.sourceKey}</Text>
              {detail.destinationPath && <Button variant="plain" url={detail.destinationPath}>Open destination</Button>}
              {detail.completionNote && <Text as="p"><strong>Decision note:</strong> {detail.completionNote}</Text>}
              <Text as="h3" variant="headingSm">Decision history</Text>
              {history === null ? (
                <Text as="p" tone="subdued">Loading decision history…</Text>
              ) : history.length === 0 ? (
                <Text as="p" tone="subdued">No decision history yet.</Text>
              ) : (
                <BlockStack gap="100">
                  {history.map((entry) => (
                    <Text as="p" key={entry.id}>
                      {entry.action.replaceAll("_", " ")} · {entry.actor} · {formatDate(entry.createdAt)}
                    </Text>
                  ))}
                </BlockStack>
              )}
              {error && <Banner tone="critical">{error}</Banner>}

              {detail.status === "open" && (
                <InlineStack gap="200" wrap>
                  <Button onClick={() => { setEditing((value) => !value); setAction(null); }}>Edit task</Button>
                  <Button onClick={() => { setAction("evidence"); setEditing(false); }}>Update evidence</Button>
                  {detail.bucket === "ready" && (
                    <Button onClick={() => { setAction("complete"); setEditing(false); }}>Complete task</Button>
                  )}
                  <Button tone="critical" onClick={() => { setAction("cancel"); setEditing(false); }}>Cancel task</Button>
                </InlineStack>
              )}

              {editing && (
                <SeoTaskForm
                  task={detail}
                  onSaved={() => {
                    setEditing(false);
                    setExpanded(false);
                    setDetail(null);
                    setHistory(null);
                    onChanged();
                  }}
                  onCancel={() => setEditing(false)}
                />
              )}

              {action === "evidence" && (
                <BlockStack gap="200">
                  <Select
                    label="Evidence status"
                    value={evidenceStatus}
                    onChange={setEvidenceStatus}
                    options={(detail.requiresEvidence
                      ? ["waiting", "insufficient", "sufficient"]
                      : ["not_required"]).map((value) => ({ label: value.replace("_", " "), value }))}
                  />
                  <TextField
                    label="Evidence snapshot JSON"
                    value={evidenceSnapshot}
                    onChange={setEvidenceSnapshot}
                    multiline={4}
                    autoComplete="off"
                  />
                  <InlineStack gap="200">
                    <Button variant="primary" onClick={saveEvidence} loading={saving}>Save evidence</Button>
                    <Button onClick={() => setAction(null)}>Cancel</Button>
                  </InlineStack>
                </BlockStack>
              )}

              {(action === "complete" || action === "cancel") && (
                <div role="group" aria-label={`${action === "complete" ? "Complete" : "Cancel"} ${task.title}`}>
                  <BlockStack gap="200">
                    <TextField
                      label={action === "complete" ? "Completion note" : "Cancellation note"}
                      value={note}
                      onChange={setNote}
                      multiline={3}
                      autoComplete="off"
                    />
                    <Checkbox
                      label={action === "complete"
                        ? "I confirm this evidence was reviewed"
                        : "I confirm this task should be cancelled"}
                      checked={confirmed}
                      onChange={setConfirmed}
                    />
                    <InlineStack gap="200">
                      <Button
                        variant="primary"
                        tone={action === "cancel" ? "critical" : undefined}
                        disabled={!note.trim() || !confirmed}
                        loading={saving}
                        onClick={() => void mutate({ action, note: note.trim() })}
                      >
                        {action === "complete" ? "Confirm completion" : "Confirm cancellation"}
                      </Button>
                      <Button onClick={() => setAction(null)}>Back</Button>
                    </InlineStack>
                  </BlockStack>
                </div>
              )}
            </BlockStack>
            )}
          </>
        )}
      </BlockStack>
    </Card>
  );
}
