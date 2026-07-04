"use client";

import {
  Text,
  Button,
  Badge,
  InlineStack,
  BlockStack,
  Collapsible,
  SkeletonBodyText,
  Icon,
} from "@shopify/polaris";
import { ChevronUpIcon, ChevronDownIcon } from "@shopify/polaris-icons";
import { useState } from "react";
import { timeAgo } from "@/lib/format";
import type { PerJobHealth, JobRunEntry } from "./types";
import {
  STATUS_DOT_COLOR,
  stalenessTone,
  stalenessStyle,
  errorMessage,
  domId,
} from "./helpers";

export function TrendDots({ runs }: { runs: JobRunEntry[] }) {
  if (runs.length === 0) return <Text as="span" tone="subdued">no history</Text>;
  const ordered = [...runs].reverse();
  const summary = `Last ${ordered.length} runs: ${ordered.map((run) => `${run.status} ${timeAgo(run.startedAt)}`).join(", ")}`;
  return (
    <InlineStack gap="050" blockAlign="center">
      <span role="img" aria-label={summary} style={{ display: "inline-flex", gap: 4 }}>
      {ordered.map((run, i) => (
        <span
          key={i}
          title={`${run.status} — ${timeAgo(run.startedAt)}`}
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: STATUS_DOT_COLOR[run.status] ?? "var(--p-color-bg-fill-tertiary)",
            flexShrink: 0,
          }}
        />
      ))}
      </span>
    </InlineStack>
  );
}

export function JobRow({
  job,
  history,
  onTrigger,
  onToast,
}: {
  job: PerJobHealth;
  history: JobRunEntry[];
  onTrigger: (jobName: string) => void;
  onToast: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const tone = stalenessTone(job.lastSuccessAt);
  const panelId = `job-${domId(job.jobName)}`;

  const statusTone =
    job.lastStatus === "success" ? "success"
    : job.lastStatus === "partial" ? "warning"
    : job.lastStatus === "failed" ? "critical"
    : job.lastStatus === "queued" || (job.queuedCount ?? 0) > 0 ? "info"
    : "new";

  return (
    <div style={{ ...stalenessStyle(tone), padding: "12px 16px" }}>
      <BlockStack gap="200">
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", width: "100%", textAlign: "left" }}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? "Collapse" : "Expand"} details for ${job.label ?? job.jobName}`}
        >
          <InlineStack align="space-between" blockAlign="center" wrap>
            <InlineStack gap="300" blockAlign="center">
              <Text as="p" fontWeight="semibold">{job.label ?? job.jobName}</Text>
              <Badge tone={statusTone as "success" | "warning" | "critical" | "new" | "info"}>
                {job.lastStatus ?? "never run"}
              </Badge>
              <TrendDots runs={history} />
            </InlineStack>
            <InlineStack gap="300" blockAlign="center">
              {(job.queuedCount ?? 0) > 0 && (
                <Text as="p" tone="subdued">Queued: {job.queuedCount}</Text>
              )}
              <Text as="p" tone="subdued">
                {job.lastStartedAt ? timeAgo(job.lastStartedAt) : "never run"}
              </Text>
              <Icon source={open ? ChevronUpIcon : ChevronDownIcon} tone="subdued" />
            </InlineStack>
          </InlineStack>
        </button>

        <Collapsible id={panelId} open={open}>
          <BlockStack gap="200">
            <InlineStack gap="400" align="space-between" blockAlign="center">
              <InlineStack gap="400">
                <Text as="p" tone="subdued">
                  Last success: {job.lastSuccessAt ? timeAgo(job.lastSuccessAt) : "never"}
                </Text>
                {job.lastStartedAt && (
                  <Text as="p" tone="subdued">
                    Last run: {new Date(job.lastStartedAt).toLocaleString()}
                  </Text>
                )}
              </InlineStack>
              <Button
                size="slim"
                disabled={job.manualTriggerEnabled === false}
                onClick={() => onTrigger(job.jobName)}
              >
                Run now
              </Button>
            </InlineStack>
            {job.manualTriggerEnabled === false && (
              <Text as="p" tone="subdued">
                {job.manualTriggerDisabledReason ?? "Manual trigger is unavailable for this job."}
              </Text>
            )}
            {job.errorExcerpt && (
              <BlockStack gap="100">
                <pre
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    background: "#fff4f4",
                    padding: "8px 12px",
                    borderRadius: 4,
                    margin: 0,
                    maxHeight: 120,
                    overflow: "auto",
                  }}
                >
                  {job.errorExcerpt}
                </pre>
                <Button
                  size="slim"
                  onClick={() => {
                    void navigator.clipboard.writeText(job.errorExcerpt!)
                      .then(() => {
                        setCopied(true);
                        onToast("Error copied to clipboard");
                        setTimeout(() => setCopied(false), 2000);
                      })
                      .catch((err) => {
                        onToast(`Copy failed: ${errorMessage(err)}`);
                      });
                  }}
                >
                  {copied ? "Copied!" : "Copy error"}
                </Button>
              </BlockStack>
            )}
          </BlockStack>
        </Collapsible>
      </BlockStack>
    </div>
  );
}

export function JobHealthSkeleton() {
  return (
    <BlockStack gap="200">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{ padding: "12px 16px", backgroundColor: "#f6f6f7", borderRadius: 8 }}>
          <SkeletonBodyText lines={1} />
        </div>
      ))}
    </BlockStack>
  );
}
