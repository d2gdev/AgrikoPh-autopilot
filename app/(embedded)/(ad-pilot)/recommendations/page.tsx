"use client";

import {
  Page, Layout, Card, Text, Button, Badge, BlockStack, InlineStack,
  Tabs, EmptyState, Collapsible, Modal, TextField, Select, Banner, Toast,
} from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { ApproveConfirmationModal } from "@/components/ui/approve-confirmation-modal";
import { timeAgo } from "@/lib/format";
import { recommendationStatusTone } from "@/lib/ui/tones";
import { ListSkeleton } from "@/components/ui/states";

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
  const [confirmRec, setConfirmRec] = useState<Recommendation | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideText, setOverrideText] = useState("");
  const [pendingOverrideId, setPendingOverrideId] = useState<string | null>(null);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; undoId?: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [sortKey, setSortKey] = useState("newest");

  const status = TABS[selected]!.id;

  const load = useCallback((reset = true) => {
    const offset = reset ? 0 : recs.length;
    if (reset) { setLoading(true); setRecs([]); }
    else setLoadingMore(true);
    setLoadError(null);

    const platformParam = platform === "all" ? "" : `&platform=${platform}`;
    authFetch(`/api/recommendations?status=${status}&limit=${PAGE_SIZE}&offset=${offset}${platformParam}`)
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
  }, [status, platform, recs.length, authFetch]);

  useEffect(() => { load(true); }, [status, platform]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setConfirmRec(null);
      setToast({ message: "Approved — queued for live execution", undoId: id });
    } catch (err) {
      setConfirmRec(null);
      setActionError(errorMessage(err));
    } finally {
      setApprovingId(null);
    }
  }

  async function undoReview(id: string) {
    setUndoing(true);
    try {
      const res = await authFetch(`/api/recommendations/${id}/revert`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await responseError(res, "Undo failed"));
      setToast({ message: "Decision reverted — back in Pending" });
      load(true);
    } catch (err) {
      setToast(null);
      setActionError(errorMessage(err));
    } finally {
      setUndoing(false);
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
    const labels: Record<string, string> = {
      executed: "Executed",
      failed: "Failed",
      rejected: "Rejected",
      override_approved: "Override Approved",
      executing: "Executing",
    };
    const tone = recommendationStatusTone(s);
    if (!tone) return null;
    return <Badge tone={tone}>{labels[s] ?? s}</Badge>;
  }

  const query = searchQuery.trim().toLowerCase();
  const filtered = query
    ? recs.filter((rec) =>
        [rec.targetEntityName, rec.skillName, rec.rationale].some((field) =>
          field.toLowerCase().includes(query)
        )
      )
    : recs;
  const visible = sortKey === "confidence"
    ? [...filtered].sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
    : filtered;

  return (
    <Page title="Recommendations">
      <Layout>
        <Layout.Section>
          <Tabs tabs={TABS} selected={selected} onSelect={(i) => { setSelected(i); }} />
        </Layout.Section>

        <Layout.Section>
          <InlineStack gap="200" blockAlign="end" wrap>
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <TextField label="Search recommendations" labelHidden placeholder="Search…" value={searchQuery} onChange={setSearchQuery}
                autoComplete="off" clearButton onClearButtonClick={() => setSearchQuery("")} />
            </div>
            <div style={{ minWidth: 150 }}>
              <Select
                label="Filter by platform"
                labelHidden
                options={[
                  { label: "All platforms", value: "all" },
                  { label: "Meta", value: "meta" },
                  { label: "Google Ads", value: "google_ads" },
                ]}
                value={platform}
                onChange={setPlatform}
              />
            </div>
            <div style={{ minWidth: 130 }}>
              <Select
                label="Sort by"
                labelHidden
                options={[
                  { label: "Newest", value: "newest" },
                  { label: "Confidence", value: "confidence" },
                ]}
                value={sortKey}
                onChange={setSortKey}
              />
            </div>
          </InlineStack>
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
            <Card><ListSkeleton lines={6} /></Card>
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
              <Text as="p" tone="subdued">
                {query
                  ? `Showing ${visible.length} matching of ${recs.length} loaded`
                  : `Showing ${recs.length} of ${total}`}
              </Text>

              {visible.map((rec) => (
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
                            onClick={() => setConfirmRec(rec)}
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

      <ApproveConfirmationModal
        rec={confirmRec}
        open={confirmRec !== null}
        loading={approvingId !== null}
        onConfirm={() => { if (confirmRec) approve(confirmRec.id); }}
        onCancel={() => { if (approvingId === null) setConfirmRec(null); }}
      />

      <Modal
        open={rejectModalOpen}
        onClose={() => { setRejectModalOpen(false); setRejectingId(null); setRejectReason(""); setRejectError(null); }}
        title="Reject recommendation"
        primaryAction={{
          content: "Reject",
          destructive: true,
          loading: rejectSubmitting,
          onAction: async () => {
            if (!rejectingId) return;
            setRejectSubmitting(true);
            setRejectError(null);
            try {
              const res = await authFetch(`/api/recommendations/${rejectingId}/reject`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ note: rejectReason || undefined }),
              });
              if (!res.ok) throw new Error(await responseError(res, "Reject failed"));
              const rejectedId = rejectingId;
              setRejectModalOpen(false);
              setRejectingId(null);
              setRejectReason("");
              setToast({ message: "Recommendation rejected", undoId: rejectedId });
              load(true);
            } catch (err) {
              setRejectError(errorMessage(err));
            } finally {
              setRejectSubmitting(false);
            }
          },
        }}
        secondaryActions={[{ content: "Cancel", disabled: rejectSubmitting, onAction: () => { setRejectModalOpen(false); setRejectingId(null); setRejectReason(""); setRejectError(null); } }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            {rejectError && (
              <Banner tone="critical" onDismiss={() => setRejectError(null)}>
                <Text as="p">{rejectError}</Text>
              </Banner>
            )}
            <TextField
              label="Reason for rejection"
              value={rejectReason}
              onChange={setRejectReason}
              multiline={3}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal
        open={overrideModalOpen}
        onClose={() => { setOverrideModalOpen(false); setPendingOverrideId(null); setOverrideText(""); setOverrideError(null); }}
        title="Override hard block"
        primaryAction={{
          content: "Submit override",
          loading: overrideSubmitting,
          onAction: async () => {
            if (!pendingOverrideId || !overrideText.trim()) return;
            setOverrideSubmitting(true);
            setOverrideError(null);
            try {
              const res = await authFetch(`/api/recommendations/${pendingOverrideId}/request-override`, {
                method: "POST",
                body: JSON.stringify({ justification: overrideText }),
              });
              if (!res.ok) throw new Error(await responseError(res, "Override failed"));
              setOverrideModalOpen(false);
              setPendingOverrideId(null);
              setOverrideText("");
              setToast({ message: "Override approved — queued for live execution" });
              load(true);
            } catch (err) {
              setOverrideError(errorMessage(err));
            } finally {
              setOverrideSubmitting(false);
            }
          },
        }}
        secondaryActions={[{ content: "Cancel", disabled: overrideSubmitting, onAction: () => { setOverrideModalOpen(false); setPendingOverrideId(null); setOverrideText(""); setOverrideError(null); } }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            {overrideError && (
              <Banner tone="critical" onDismiss={() => setOverrideError(null)}>
                <Text as="p">{overrideError}</Text>
              </Banner>
            )}
            <TextField
              label="Override reason"
              value={overrideText}
              onChange={setOverrideText}
              autoComplete="off"
              multiline={3}
              helpText="Explain why you are overriding the guardrail hard block"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {toast && (
        <Toast
          content={toast.message}
          duration={8000}
          onDismiss={() => setToast(null)}
          action={toast.undoId ? {
            content: undoing ? "Undoing…" : "Undo",
            onAction: () => { if (!undoing && toast.undoId) undoReview(toast.undoId); },
          } : undefined}
        />
      )}
    </Page>
  );
}
