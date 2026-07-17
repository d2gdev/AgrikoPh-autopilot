"use client";

import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import type { SeoTaskDetail } from "./SeoTaskBoard";

const TYPE_OPTIONS = [
  { value: "canonical_transfer_review", label: "Canonical transfer" },
  { value: "ctr_experiment_review", label: "CTR experiment" },
  { value: "indexation_review", label: "Indexation" },
  { value: "content_quality_review", label: "Content quality" },
  { value: "cohort_review", label: "Cohort" },
  { value: "technical_review", label: "Technical" },
  { value: "other", label: "Other" },
];

function localDateTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function SeoTaskForm({
  task,
  onSaved,
  onCancel,
}: {
  task?: SeoTaskDetail;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const authFetch = useAuthFetch();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [taskType, setTaskType] = useState(task?.taskType ?? "other");
  const [priority, setPriority] = useState(task?.priority ?? "P2");
  const [targetUrl, setTargetUrl] = useState(task?.targetUrl ?? "");
  const [topicalCluster, setTopicalCluster] = useState(task?.topicalCluster ?? "");
  const [pageRole, setPageRole] = useState(task?.pageRole ?? "");
  const [earliestReviewAt, setEarliestReviewAt] = useState(localDateTime(task?.earliestReviewAt));
  const [dueAt, setDueAt] = useState(localDateTime(task?.dueAt ?? undefined));
  const [requiresEvidence, setRequiresEvidence] = useState(task?.requiresEvidence ?? true);
  const [evidenceRequirement, setEvidenceRequirement] = useState(
    JSON.stringify(
      task?.evidenceRequirement ?? {
        note: "Record the evidence reviewed and the resulting decision.",
      },
      null,
      2,
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = Boolean(title.trim() && description.trim() && earliestReviewAt);

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    let parsedEvidenceRequirement: Record<string, unknown>;
    try {
      const parsed = JSON.parse(evidenceRequirement);
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("not an object");
      }
      parsedEvidenceRequirement = parsed as Record<string, unknown>;
    } catch {
      setError("Evidence requirement must be a valid JSON object.");
      setSaving(false);
      return;
    }
    const common = {
      title: title.trim(),
      description: description.trim(),
      targetUrl: targetUrl.trim() || null,
      topicalCluster: topicalCluster.trim() || null,
      pageRole: pageRole.trim() || null,
      priority,
      earliestReviewAt: new Date(earliestReviewAt).toISOString(),
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      requiresEvidence,
      evidenceRequirement: parsedEvidenceRequirement,
    };
    let body: Record<string, unknown>;
    if (task) {
      const fields: Record<string, unknown> = {};
      const candidates: Record<string, unknown> = common;
      const original: Record<string, unknown> = {
        title: task.title,
        description: task.description,
        targetUrl: task.targetUrl,
        topicalCluster: task.topicalCluster,
        pageRole: task.pageRole,
        priority: task.priority,
        earliestReviewAt: new Date(task.earliestReviewAt).toISOString(),
        dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
        requiresEvidence: task.requiresEvidence,
        evidenceRequirement: task.evidenceRequirement,
      };
      for (const [key, value] of Object.entries(candidates)) {
        if (JSON.stringify(value) !== JSON.stringify(original[key])) fields[key] = value;
      }
      if (Object.keys(fields).length === 0) {
        setError("Make a change before saving.");
        setSaving(false);
        return;
      }
      body = {
        action: "edit",
        expectedVersion: task.version,
        fields,
      };
    } else {
      body = {
      ...common,
      taskType,
      ownerSurface: "seo",
      destinationPath: "/seo-pillar",
      evidenceStatus: requiresEvidence ? "waiting" : "not_required",
      evidenceSnapshot: null,
      sourceType: "operator",
      sourceKey: `${taskType}:${title.trim().toLowerCase()}:${new Date(earliestReviewAt).toISOString()}`,
      sourceData: { createdFrom: "seo-tasks-workboard" },
      };
    }
    const response = await authFetch(task ? `/api/seo/tasks/${task.id}` : "/api/seo/tasks", {
      method: task ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!response?.ok) {
      const result = await response?.json().catch(() => ({})) as { error?: string } | undefined;
      setError(result?.error?.slice(0, 300) ?? "The SEO task could not be saved.");
      setSaving(false);
      return;
    }
    onSaved();
  }

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">{task ? "Edit SEO task" : "Add SEO task"}</Text>
        {error && <Banner tone="critical">{error}</Banner>}
        <TextField label="Title" value={title} onChange={setTitle} autoComplete="off" />
        <TextField label="Description" value={description} onChange={setDescription} multiline={3} autoComplete="off" />
        {!task && <Select label="Task type" value={taskType} onChange={setTaskType} options={TYPE_OPTIONS} />}
        <Select
          label="Priority"
          value={priority}
          onChange={(value) => setPriority(value as "P0" | "P1" | "P2" | "P3")}
          options={["P0", "P1", "P2", "P3"].map((value) => ({ label: value, value }))}
        />
        <TextField label="Target path" value={targetUrl} onChange={setTargetUrl} autoComplete="off" />
        <TextField label="Topical cluster" value={topicalCluster} onChange={setTopicalCluster} autoComplete="off" />
        <TextField label="Page role" value={pageRole} onChange={setPageRole} autoComplete="off" />
        <TextField label="Earliest review" type="datetime-local" value={earliestReviewAt} onChange={setEarliestReviewAt} autoComplete="off" />
        <TextField label="Due date" type="datetime-local" value={dueAt} onChange={setDueAt} autoComplete="off" />
        <Checkbox label="Requires evidence" checked={requiresEvidence} onChange={setRequiresEvidence} />
        <TextField label="Evidence requirement" value={evidenceRequirement} onChange={setEvidenceRequirement} multiline={3} autoComplete="off" />
        <InlineStack gap="200">
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!valid}>
            {task ? "Save changes" : "Create task"}
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
