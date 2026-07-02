"use client";

import {
  Page, Layout, Card, Text, Button, Badge, BlockStack, InlineStack,
  Tabs, EmptyState, Spinner, Banner, Modal, TextField, FormLayout,
} from "@shopify/polaris";
import type { BadgeProps } from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthFetch } from "@/hooks/use-auth-fetch";

interface Approval {
  id: string;
  campaignId: string;
  submitterId: string;
  currentRevision: number;
  status: string;
  stage: string;
  assignedConversionReviewerId: string | null;
  assignedPenultimateApproverId: string | null;
  assignedFinalApproverId: string | null;
  flags: { requires_manual_intervention?: boolean; reason?: string } | null;
  updatedAt: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  for_ai_pre_review: "For AI Pre-Review",
  in_ai_pre_review: "In AI Pre-Review",
  for_brand_review: "For Brand Review",
  in_brand_review: "In Brand Review",
  for_conversion_review: "For Conversion Review",
  in_conversion_review: "In Conversion Review",
  for_technical_review: "For Technical Review",
  in_technical_review: "In Technical Review",
  with_penultimate_approver: "With Penultimate Approver",
  with_final_approver: "With Final Approver",
  approved_to_make_kwarta: "Approved to Make Kwarta",
  needs_revision: "Needs Revision",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function statusTone(status: string): BadgeProps["tone"] {
  if (status === "approved_to_make_kwarta") return "success";
  if (status === "rejected" || status === "cancelled") return "critical";
  if (status === "needs_revision") return "warning";
  if (status === "draft") return undefined;
  return "info";
}

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const TABS = [
  { id: "drafts", content: "My Drafts" },
  { id: "awaiting", content: "Awaiting My Review" },
  { id: "revision", content: "Needs My Revision" },
  { id: "progress", content: "In Progress" },
  { id: "approved", content: "Approved" },
  { id: "closed", content: "Rejected / Cancelled" },
];

async function responseError(res: Response, fallback: string) {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof data.error === "string" ? data.error : `${fallback} (${res.status})`;
}

export default function AdApprovalsPage() {
  const authFetch = useAuthFetch();
  const router = useRouter();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [actor, setActor] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [campaignId, setCampaignId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [unread, setUnread] = useState<Array<{ id: string; title: string; body: string; severity: string }>>([]);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    authFetch(`/api/ad-approvals?limit=100`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await responseError(r, "Failed to load approvals"));
        return r.json();
      })
      .then((d) => {
        setApprovals(d.approvals ?? []);
        setActor(d.actor ?? "");
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  // In-app notifications: unread items surface at the top of the dashboard.
  const loadNotifications = useCallback(() => {
    authFetch(`/api/notifications?unread=1&limit=10`)
      .then((r) => (r.ok ? r.json() : { notifications: [] }))
      .then((d) => setUnread(d.notifications ?? []))
      .catch(() => {});
  }, [authFetch]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  async function markAllRead() {
    try {
      await authFetch(`/api/notifications`, { method: "PATCH", body: JSON.stringify({ all: true }) });
      setUnread([]);
    } catch { /* non-fatal */ }
  }

  function bucket(tab: string): Approval[] {
    return approvals.filter((a) => {
      switch (tab) {
        case "drafts": return a.status === "draft";
        case "awaiting":
          return (
            (a.status === "in_conversion_review" && a.assignedConversionReviewerId === actor) ||
            (a.status === "with_penultimate_approver" && a.assignedPenultimateApproverId === actor) ||
            (a.status === "with_final_approver" && a.assignedFinalApproverId === actor)
          );
        case "revision": return a.status === "needs_revision" && a.submitterId === actor;
        case "progress":
          return (
            a.submitterId === actor &&
            !["draft", "needs_revision", "approved_to_make_kwarta", "rejected", "cancelled"].includes(a.status)
          );
        case "approved": return a.status === "approved_to_make_kwarta";
        case "closed": return a.status === "rejected" || a.status === "cancelled";
        default: return false;
      }
    });
  }

  async function createDraft() {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await authFetch(`/api/ad-approvals`, {
        method: "POST",
        body: JSON.stringify({ campaignId, copy: {}, creative: {} }),
      });
      if (!res.ok) throw new Error(await responseError(res, "Create failed"));
      const d = await res.json();
      setCreateOpen(false);
      setCampaignId("");
      router.push(`/ad-approvals/${d.approval.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  const rows = bucket(TABS[selected]!.id);

  return (
    <Page
      title="Ad Approvals"
      subtitle="Facebook ad approval workflow"
      primaryAction={{ content: "New draft ad", onAction: () => setCreateOpen(true) }}
    >
      <Layout>
        <Layout.Section>
          {loadError && <Banner tone="critical">{loadError}</Banner>}
          {unread.length > 0 && (
            <Banner
              tone={unread.some((n) => n.severity === "critical") ? "critical" : "info"}
              title={`${unread.length} unread notification${unread.length === 1 ? "" : "s"}`}
              action={{ content: "Mark all read", onAction: markAllRead }}
            >
              <BlockStack gap="100">
                {unread.slice(0, 5).map((n) => (
                  <Text key={n.id} as="p" variant="bodySm"><strong>{n.title}</strong> — {n.body}</Text>
                ))}
              </BlockStack>
            </Banner>
          )}
          <Card padding="0">
            <Tabs tabs={TABS} selected={selected} onSelect={setSelected} />
            <div style={{ padding: "16px" }}>
              {loading ? (
                <InlineStack align="center"><Spinner accessibilityLabel="Loading" size="large" /></InlineStack>
              ) : rows.length === 0 ? (
                <EmptyState heading="Nothing here yet" image="">
                  <p>No ads in this section.</p>
                </EmptyState>
              ) : (
                <BlockStack gap="300">
                  {rows.map((a) => (
                    <Card key={a.id}>
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="headingMd">{a.campaignId}</Text>
                            <Badge tone={statusTone(a.status)}>{STATUS_LABELS[a.status] ?? a.status}</Badge>
                            <Badge>{`Rev ${a.currentRevision}`}</Badge>
                            {a.flags?.requires_manual_intervention && <Badge tone="critical">Needs intervention</Badge>}
                          </InlineStack>
                          <Button onClick={() => router.push(`/ad-approvals/${a.id}`)}>Open</Button>
                        </InlineStack>
                        <Text as="span" tone="subdued" variant="bodySm">
                          Submitter {a.submitterId} · updated {timeAgo(a.updatedAt)}
                        </Text>
                      </BlockStack>
                    </Card>
                  ))}
                </BlockStack>
              )}
            </div>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New draft ad"
        primaryAction={{ content: "Create", onAction: createDraft, loading: creating, disabled: !campaignId.trim() }}
        secondaryActions={[{ content: "Cancel", onAction: () => setCreateOpen(false) }]}
      >
        <Modal.Section>
          {createError && <Banner tone="critical">{createError}</Banner>}
          <FormLayout>
            <TextField
              label="Campaign ID / name"
              value={campaignId}
              onChange={setCampaignId}
              autoComplete="off"
              helpText="A unique identifier for this ad campaign."
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
