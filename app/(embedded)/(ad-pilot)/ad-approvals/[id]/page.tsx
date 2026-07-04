"use client";

import {
  Page, Layout, Card, Text, Button, Badge, BlockStack, InlineStack,
  Spinner, Banner, Modal, TextField, FormLayout, Divider, Select, ButtonGroup,
} from "@shopify/polaris";
import type { BadgeProps } from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { adApprovalStatusTone } from "@/lib/ui/tones";
import { stageProgress } from "@/lib/ad-approval/stage-progress";
import { timeAgo } from "@/lib/format";

type Json = Record<string, unknown>;

interface Revision { id: string; revisionNumber: number; submittedAt: string; copy: Json; creative: Json; }
interface Review { id: string; revisionNumber: number; stage: string; reviewerType: string; reviewerName: string; decision: string; score: number | null; comments: string | null; completedAt: string; }
interface AIReport { id: string; agentName: string; revisionNumber: number; overallResult: string; executiveSummary: string; validationChecks: Array<{ check_name: string; result: string; confidence: number; note?: string }>; recommendations: string | null; confidenceScore: number; generatedAt: string; }
interface Approval {
  id: string; campaignId: string; submitterId: string; currentRevision: number; status: string; stage: string;
  assignedConversionReviewerId: string | null; assignedPenultimateApproverId: string | null; assignedFinalApproverId: string | null;
  flags: { requires_manual_intervention?: boolean; reason?: string } | null;
  draftCopy: Json | null; draftCreative: Json | null;
  revisions: Revision[]; reviews: Review[]; aiReports: AIReport[];
  names?: Record<string, string>;
  timeline?: Array<{ at: string; actor: string; kind: string; summary: string }>;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", for_ai_pre_review: "For AI Pre-Review", in_ai_pre_review: "In AI Pre-Review",
  for_brand_review: "For Brand Review", in_brand_review: "In Brand Review",
  for_conversion_review: "For Conversion Review", in_conversion_review: "In Conversion Review",
  for_technical_review: "For Technical Review", in_technical_review: "In Technical Review",
  with_penultimate_approver: "With Penultimate Approver", with_final_approver: "With Final Approver",
  approved_to_make_kwarta: "Approved to Make Kwarta", needs_revision: "Needs Revision",
  rejected: "Rejected", cancelled: "Cancelled",
};
function decisionTone(d: string): BadgeProps["tone"] {
  if (d === "PASS") return "success";
  if (d === "REJECTED") return "critical";
  return "warning";
}
async function responseError(res: Response, fallback: string) {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof data.error === "string" ? data.error : `${fallback} (${res.status})`;
}

const CONVERSION_QUESTIONS = [
  "Would I stop scrolling?",
  "Is the offer obvious within 3 seconds?",
  "Is the CTA clear and compelling?",
  "Does creative support the copy?",
  "Is the landing page consistent with the ad?",
  "Does the ad have a strong opening?",
];

export default function AdApprovalDetailPage() {
  const authFetch = useAuthFetch();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [approval, setApproval] = useState<Approval | null>(null);
  const [actor, setActor] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Draft edit fields.
  const [copy, setCopy] = useState<Record<string, string>>({});
  const [creative, setCreative] = useState<Record<string, string>>({});

  // Conversion scoring.
  const [scores, setScores] = useState<number[]>([3, 3, 3, 3, 3, 3]);
  const [convComments, setConvComments] = useState("");

  // Approver decision modal.
  const [decisionModal, setDecisionModal] = useState<null | { role: "penultimate" | "final"; decision: "revision" | "reject" }>(null);
  const [decisionComments, setDecisionComments] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    authFetch(`/api/ad-approvals/${id}`)
      .then(async (r) => { if (!r.ok) throw new Error(await responseError(r, "Failed to load")); return r.json(); })
      .then((d) => {
        setApproval(d.approval);
        setActor(d.actor ?? "");
        setCopy(Object.fromEntries(Object.entries(d.approval.draftCopy ?? {}).map(([k, v]) => [k, String(v ?? "")])));
        setCreative(Object.fromEntries(Object.entries(d.approval.draftCreative ?? {}).map(([k, v]) => [k, String(v ?? "")])));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [authFetch, id]);

  useEffect(() => { load(); }, [load]);

  async function post(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setActionErr(null);
    try {
      const res = await authFetch(`/api/ad-approvals/${id}${path}`, { method, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await responseError(res, "Action failed"));
      setDecisionModal(null);
      setDecisionComments("");
      load();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Page title="Ad Approval"><InlineStack align="center"><Spinner accessibilityLabel="Loading" size="large" /></InlineStack></Page>;
  if (err || !approval) return <Page title="Ad Approval"><Banner tone="critical">{err ?? "Not found"}</Banner></Page>;

  const a = approval;
  const names = a.names ?? {};
  const timeline = a.timeline ?? [];
  const isDraft = a.status === "draft";
  const isSubmitter = a.submitterId === actor;
  const isConvReviewer = a.status === "in_conversion_review" && a.assignedConversionReviewerId === actor;
  const isPenultimate = a.status === "with_penultimate_approver" && a.assignedPenultimateApproverId === actor;
  const isFinal = a.status === "with_final_approver" && a.assignedFinalApproverId === actor;

  const copyFields = ["primary_text", "headline", "description", "cta", "website_url"];
  const creativeFields = ["destination_url", "image_url", "campaign_name"];

  return (
    <Page
      title={a.campaignId}
      backAction={{ content: "Ad Approvals", onAction: () => router.push("/ad-approvals") }}
      titleMetadata={<Badge tone={adApprovalStatusTone(a.status)}>{STATUS_LABELS[a.status] ?? a.status}</Badge>}
      subtitle={`Submitted by ${names[a.submitterId] ?? a.submitterId} · Revision ${a.currentRevision} · stage ${a.stage}`}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <InlineStack gap="200" wrap>
              {stageProgress(a.status, a.stage).steps.map((s, i, arr) => (
                <InlineStack key={s.key} gap="100" blockAlign="center">
                  <Badge tone={s.state === "done" ? "success" : s.state === "current" ? "info" : s.state === "blocked" ? "critical" : undefined}>
                    {s.label}
                  </Badge>
                  {i !== arr.length - 1 && <Text as="span" tone="subdued">›</Text>}
                </InlineStack>
              ))}
            </InlineStack>
          </Card>

          {actionErr && <Banner tone="critical" onDismiss={() => setActionErr(null)}>{actionErr}</Banner>}
          {a.flags?.requires_manual_intervention && (
            <Banner tone="critical" title="Requires manual intervention">{a.flags.reason}</Banner>
          )}

          {/* Draft editing */}
          {isDraft && isSubmitter && (
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Edit draft</Text>
                <FormLayout>
                  {copyFields.map((f) => (
                    <TextField key={f} label={f} value={copy[f] ?? ""} multiline={f === "primary_text" ? 3 : undefined}
                      onChange={(v) => setCopy((p) => ({ ...p, [f]: v }))} autoComplete="off" />
                  ))}
                  {creativeFields.map((f) => (
                    <TextField key={f} label={f} value={creative[f] ?? ""}
                      onChange={(v) => setCreative((p) => ({ ...p, [f]: v }))} autoComplete="off" />
                  ))}
                </FormLayout>
                <InlineStack gap="200">
                  <Button loading={busy} onClick={() => post("", { copy, creative }, "PATCH")}>Save draft</Button>
                  <Button variant="primary" loading={busy} onClick={() => post("/submit", {})}>Submit for review</Button>
                  <Button tone="critical" loading={busy} onClick={() => post("", {}, "DELETE")}>Delete</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          )}

          {/* Needs revision */}
          {a.status === "needs_revision" && isSubmitter && (
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">This ad needs revision</Text>
                <Text as="p" tone="subdued">Reopen it to Draft to edit the copy/creative and resubmit.</Text>
                <InlineStack><Button variant="primary" loading={busy} onClick={() => post("/revise", {})}>Reopen for editing</Button></InlineStack>
              </BlockStack>
            </Card>
          )}

          {/* Conversion scoring */}
          {isConvReviewer && (
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Conversion Review — score 1–5</Text>
                <Text as="p" tone="subdued">Pass requires total ≥ 24/30 AND no question below 3.</Text>
                <FormLayout>
                  {CONVERSION_QUESTIONS.map((q, i) => (
                    <Select key={i} label={`${i + 1}. ${q}`} value={String(scores[i])}
                      options={[1, 2, 3, 4, 5].map((n) => ({ label: String(n), value: String(n) }))}
                      onChange={(v) => setScores((p) => p.map((s, idx) => (idx === i ? Number(v) : s)))} />
                  ))}
                  <TextField label="Comments (required if requesting revision)" value={convComments}
                    onChange={setConvComments} multiline={2} autoComplete="off" />
                </FormLayout>
                <Text as="p">Total: {scores.reduce((x, y) => x + y, 0)}/30 · lowest {Math.min(...scores)}</Text>
                <InlineStack>
                  <Button variant="primary" loading={busy}
                    onClick={() => post("/conversion-review", { scores, comments: convComments || undefined })}>Submit review</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          )}

          {/* Approver decisions */}
          {(isPenultimate || isFinal) && (
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{isFinal ? "Final approval" : "Penultimate approval"}</Text>
                <ButtonGroup>
                  <Button variant="primary" loading={busy}
                    onClick={() => post(isFinal ? "/final" : "/penultimate", { decision: "approve" })}>Approve</Button>
                  <Button loading={busy}
                    onClick={() => setDecisionModal({ role: isFinal ? "final" : "penultimate", decision: "revision" })}>Request revision</Button>
                  <Button tone="critical" loading={busy}
                    onClick={() => setDecisionModal({ role: isFinal ? "final" : "penultimate", decision: "reject" })}>Reject</Button>
                </ButtonGroup>
              </BlockStack>
            </Card>
          )}

          {/* Cancel (any non-terminal, submitter/admin) */}
          {isSubmitter && !["approved_to_make_kwarta", "rejected", "cancelled"].includes(a.status) && !isDraft && (
            <Card>
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" tone="subdued">Need to withdraw this submission?</Text>
                <Button tone="critical" loading={busy} onClick={() => post("/cancel", { reason: "Withdrawn by submitter" })}>Cancel submission</Button>
              </InlineStack>
            </Card>
          )}
        </Layout.Section>

        {/* Right column: history */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Timeline</Text>
              {timeline.length === 0 && <Text as="p" tone="subdued">No activity yet.</Text>}
              {timeline.map((t, i) => (
                <BlockStack key={i} gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge>{t.kind}</Badge>
                    <Text as="span" variant="bodySm" tone="subdued">{timeAgo(t.at)}</Text>
                  </InlineStack>
                  <Text as="span" variant="bodySm">{names[t.actor] ?? t.actor} — {t.summary}</Text>
                  <Divider />
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
          <div style={{ height: 16 }} />
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Reviews</Text>
              {a.reviews.length === 0 && <Text as="p" tone="subdued">No reviews yet.</Text>}
              {a.reviews.map((r) => (
                <BlockStack key={r.id} gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={decisionTone(r.decision)}>{r.decision}</Badge>
                    <Text as="span" variant="bodySm">{r.stage} · rev {r.revisionNumber}</Text>
                  </InlineStack>
                  <Text as="span" variant="bodySm" tone="subdued">{r.reviewerName}{r.score != null ? ` · ${r.score}/30` : ""}</Text>
                  {r.comments && <Text as="span" variant="bodySm">{r.comments}</Text>}
                  <Divider />
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
          <div style={{ height: 16 }} />
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">AI reports</Text>
              {a.aiReports.length === 0 && <Text as="p" tone="subdued">No AI reports yet.</Text>}
              {a.aiReports.map((rep) => (
                <BlockStack key={rep.id} gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={decisionTone(rep.overallResult)}>{rep.overallResult}</Badge>
                    <Text as="span" variant="bodySm">{rep.agentName} · rev {rep.revisionNumber}</Text>
                  </InlineStack>
                  <Text as="span" variant="bodySm">{rep.executiveSummary}</Text>
                  {rep.recommendations && <Text as="span" variant="bodySm" tone="subdued">Fix: {rep.recommendations}</Text>}
                  <Divider />
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
          <div style={{ height: 16 }} />
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Revisions</Text>
              {a.revisions.map((rev) => (
                <Text key={rev.id} as="span" variant="bodySm">Rev {rev.revisionNumber} · {new Date(rev.submittedAt).toLocaleString()}</Text>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={Boolean(decisionModal)}
        onClose={() => setDecisionModal(null)}
        title={decisionModal?.decision === "reject" ? "Reject ad" : "Request revision"}
        primaryAction={{
          content: "Submit",
          loading: busy,
          disabled: !decisionComments.trim(),
          onAction: () => decisionModal && post(`/${decisionModal.role}`, { decision: decisionModal.decision, comments: decisionComments }),
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDecisionModal(null) }]}
      >
        <Modal.Section>
          <TextField label="Comments / reason" value={decisionComments} onChange={setDecisionComments} multiline={3} autoComplete="off" />
        </Modal.Section>
      </Modal>
    </Page>
  );
}
