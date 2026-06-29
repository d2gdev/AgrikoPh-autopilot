"use client";

import {
  Page, Layout, Card, Text, Button, Badge, BlockStack, InlineStack,
  Tabs, EmptyState, Spinner, Collapsible, Modal, TextField, Banner,
} from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";

interface Recommendation {
  id: string;
  platform: string;
  skillName: string;
  actionType: string;
  targetEntityName: string;
  currentValue: string | null;
  proposedValue: string | null;
  changePercent: number | null;
  rationale: string;
  estimatedImpact: string | null;
  guardStatus: string;
  guardReason: string | null;
  status: string;
  confidenceScore: number | null;
  createdAt: string;
  executedAt: string | null;
  executionResult: Record<string, unknown> | null;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const TABS = [
  { id: "pending",           content: "Pending" },
  { id: "override_approved", content: "Override Approved" },
  { id: "executed",          content: "Executed" },
  { id: "failed",            content: "Failed" },
  { id: "rejected",          content: "Rejected" },
];

const PAGE_SIZE = 25;

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function responseError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({})) as { error?: unknown };
  return typeof data.error === "string" ? data.error : `${fallback} (${res.status})`;
}

export default function RecommendationsPage() {
  const authFetch = useAuthFetch();
  const [selected, setSelected] = useState(0);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideText, setOverrideText] = useState("");
  const [pendingOverrideId, setPendingOverrideId] = useState<string | null>(null);

  const status = TABS[selected]!.id;

  const load = useCallback((reset = true) => {
    const offset = reset ? 0 : recs.length;
    if (reset) { setLoading(true); setRecs([]); }
    else setLoadingMore(true);
    setLoadError(null);

    authFetch(`/api/recommendations?status=${status}&limit=${PAGE_SIZE}&offset=${offset}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await responseError(r, "Failed to load recommendations"));
        return r.json();
      })
      .then((d) => {
        setTotal(d.total ?? 0);
        setRecs((prev) => reset ? (d.recommendations ?? []) : [...prev, ...(d.recommendations ?? [])]);
      })
      .catch((err) => {
        setLoadError(errorMessage(err));
      })
      .finally(() => { setLoading(false); setLoadingMore(false); });
  }, [status, recs.length, authFetch]);

  useEffect(() => { load(true); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function approve(id: string) {
    setApprovingId(id);
    setActionError(null);

    try {
      const res = await authFetch(`/api/recommendations/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await responseError(res, "Approve failed"));

      setRecs((prev) => prev.filter((rec) => rec.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setApprovingId(null);
    }
  }

  function openRejectModal(id: string) {
    setRejectingId(id);
    setRejectReason("");
    setRejectModalOpen(true);
  }

  function overrideHardBlock(id: string) {
    setPendingOverrideId(id);
    setOverrideText("");
    setOverrideModalOpen(true);
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function guardBadge(gs: string) {
    if (gs === "hard_block") return <Badge tone="critical">Hard Block</Badge>;
    if (gs === "soft_flag")  return <Badge tone="warning">Soft Flag</Badge>;
    return <Badge tone="success">Clear</Badge>;
  }

  function platformBadge(p: string) {
    if (p === "google_ads") return <Badge tone="info">Google</Badge>;
    if (p === "meta")       return <Badge>Meta</Badge>;
    return <Badge>Both</Badge>;
  }

  function statusBadge(s: string) {
    if (s === "executed")          return <Badge tone="success">Executed</Badge>;
    if (s === "failed")            return <Badge tone="critical">Failed</Badge>;
    if (s === "rejected")          return <Badge tone="warning">Rejected</Badge>;
    if (s === "override_approved") return <Badge tone="attention">Override Approved</Badge>;
    if (s === "executing")         return <Badge tone="info">Executing</Badge>;
    return null;
  }

  return (
    <Page title="Recommendations">
      <Layout>
        <Layout.Section>
          <Tabs tabs={TABS} selected={selected} onSelect={(i) => { setSelected(i); }} />
        </Layout.Section>

        {(loadError || actionError) && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => { setLoadError(null); setActionError(null); }}>
              <Text as="p">{loadError ?? actionError}</Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          {loading ? (
            <Card>
              <InlineStack align="center" gap="200">
                <Spinner size="small" />
                <Text as="p" tone="subdued">Loading…</Text>
              </InlineStack>
            </Card>
          ) : recs.length === 0 ? (
            <EmptyState heading="No recommendations" image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg">
              <Text as="p">
                {status === "pending"
                  ? "Run the analyzer from the Dashboard to generate recommendations."
                  : status === "override_approved"
                  ? "No override-approved recommendations pending execution."
                  : status === "failed"
                  ? "No failed executions."
                  : `No ${status} recommendations.`}
              </Text>
            </EmptyState>
          ) : (
            <BlockStack gap="400">
              <Text as="p" tone="subdued">Showing {recs.length} of {total}</Text>

              {recs.map((rec) => (
                <Card key={rec.id}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <InlineStack gap="200" wrap>
                        {platformBadge(rec.platform)}
                        <Text variant="headingSm" as="h3">{rec.skillName}</Text>
                        {guardBadge(rec.guardStatus)}
                        {statusBadge(rec.status)}
                      </InlineStack>
                      <BlockStack gap="050" inlineAlign="end">
                        {rec.confidenceScore != null && (
                          <Text as="p" tone="subdued" variant="bodySm">
                            {Math.round(rec.confidenceScore * 100)}% confidence
                          </Text>
                        )}
                        <Text as="p" tone="subdued" variant="bodySm">
                          Created {timeAgo(rec.createdAt)}
                        </Text>
                      </BlockStack>
                    </InlineStack>

                    <BlockStack gap="100">
                      <Text variant="headingMd" as="h2">{rec.targetEntityName}</Text>
                      <Text as="p" tone="subdued">{rec.actionType.replace(/_/g, " ")}</Text>
                      {rec.currentValue && rec.proposedValue && (
                        <InlineStack gap="200">
                          <Text as="p">{rec.currentValue}</Text>
                          <Text as="p">→</Text>
                          <Text
                            as="p"
                            tone={rec.changePercent != null && rec.changePercent > 0 ? "success" : "critical"}
                          >
                            {rec.proposedValue}
                            {rec.changePercent != null && ` (${rec.changePercent > 0 ? "+" : ""}${rec.changePercent.toFixed(1)}%)`}
                          </Text>
                        </InlineStack>
                      )}
                    </BlockStack>

                    <Text as="p" tone="subdued">{rec.rationale}</Text>

                    {rec.estimatedImpact && (
                      <Text as="p" tone="success">{rec.estimatedImpact}</Text>
                    )}

                    {rec.executedAt && (
                      <Text as="p" tone="subdued">Executed {timeAgo(rec.executedAt)}</Text>
                    )}

                    {rec.guardReason && (
                      <Text as="p" tone="critical">⚠ {rec.guardReason}</Text>
                    )}

                    {rec.executionResult && (
                      <BlockStack gap="100">
                        <Button
                          size="slim"
                          variant="plain"
                          onClick={() => toggleExpanded(rec.id)}
                        >
                          {expanded.has(rec.id) ? "Hide" : "Show"} execution detail
                        </Button>
                        <Collapsible open={expanded.has(rec.id)} id={`exec-${rec.id}`}>
                          <div style={{ fontFamily: "monospace", fontSize: 12, background: "#f6f6f6", padding: 10, borderRadius: 6, overflowX: "auto" }}>
                            {JSON.stringify(rec.executionResult, null, 2)}
                          </div>
                        </Collapsible>
                      </BlockStack>
                    )}

                    {status === "pending" && (
                      <InlineStack gap="300">
                        {rec.guardStatus !== "hard_block" && (
                          <Button
                            variant="primary"
                            tone="success"
                            loading={approvingId === rec.id}
                            disabled={approvingId !== null && approvingId !== rec.id}
                            onClick={() => approve(rec.id)}
                          >
                            Approve
                          </Button>
                        )}
                        {rec.guardStatus === "hard_block" && (
                          <Button
                            variant="primary"
                            tone="critical"
                            onClick={() => overrideHardBlock(rec.id)}
                          >
                            Override Hard Block
                          </Button>
                        )}
                        <Button tone="critical" onClick={() => openRejectModal(rec.id)}>Reject</Button>
                      </InlineStack>
                    )}
                  </BlockStack>
                </Card>
              ))}

              {recs.length < total && (
                <Button onClick={() => load(false)} loading={loadingMore}>
                  {`Load more (${total - recs.length} remaining)`}
                </Button>
              )}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>

      <Modal
        open={rejectModalOpen}
        onClose={() => { setRejectModalOpen(false); setRejectingId(null); setRejectReason(""); }}
        title="Reject recommendation"
        primaryAction={{
          content: "Reject",
          destructive: true,
          onAction: async () => {
            if (!rejectingId) return;
            await authFetch(`/api/recommendations/${rejectingId}/reject`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ note: rejectReason || undefined }),
            });
            setRejectModalOpen(false);
            setRejectingId(null);
            setRejectReason("");
            load(true);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => { setRejectModalOpen(false); setRejectingId(null); setRejectReason(""); } }]}
      >
        <Modal.Section>
          <TextField
            label="Reason for rejection"
            value={rejectReason}
            onChange={setRejectReason}
            multiline={3}
            autoComplete="off"
          />
        </Modal.Section>
      </Modal>
      <Modal
        open={overrideModalOpen}
        onClose={() => { setOverrideModalOpen(false); setPendingOverrideId(null); setOverrideText(""); }}
        title="Override hard block"
        primaryAction={{
          content: "Submit override",
          onAction: async () => {
            if (!pendingOverrideId || !overrideText.trim()) return;
            await authFetch(`/api/recommendations/${pendingOverrideId}/request-override`, {
              method: "POST",
              body: JSON.stringify({ justification: overrideText }),
            });
            setOverrideModalOpen(false);
            setPendingOverrideId(null);
            setOverrideText("");
            load(true);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => { setOverrideModalOpen(false); setPendingOverrideId(null); setOverrideText(""); } }]}
      >
        <Modal.Section>
          <TextField
            label="Override reason"
            value={overrideText}
            onChange={setOverrideText}
            autoComplete="off"
            multiline={3}
            helpText="Explain why you are overriding the guardrail hard block"
          />
        </Modal.Section>
      </Modal>
    </Page>
  );
}
