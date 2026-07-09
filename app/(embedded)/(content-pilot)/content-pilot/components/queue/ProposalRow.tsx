import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import type { useRouter } from "next/navigation";
import { withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { sanitizeHtml } from "@/lib/content-pilot/sanitize-html";
import { canRejectContentProposal } from "@/lib/content-pilot/proposal-state";

import type { ContentProposal } from "../types";
import {
  countWordsFromHtml,
  PriorityBadge,
  ImpactBadge,
  SeoDeltaBadge,
  ProposedChangeSummary,
} from "../helpers";
import { proposalEvidenceLines } from "../proposal-evidence";

type Stage = "pending" | "approved" | "generating" | "ready" | "scheduled" | "published" | "failed" | "rejected";

export function ProposalRow({
  p,
  stage,
  router,
  bulkActing,

  isSelected,
  onToggleSelect,

  isApproving,
  isRejecting,
  isGeneratingDraft,
  isPublishing,
  onApprove,
  onGenerateDraft,
  onPublishDraft,
  onReopen,

  isRejectFormOpen,
  onToggleRejectForm,
  pendingRejectNote,
  onPendingRejectNoteChange,
  onReject,
  onCancelRejectForm,

  isCloning,
  isCloneConfirmOpen,
  onOpenCloneConfirm,
  onCancelClone,
  onConfirmClone,

  isScheduleOpen,
  scheduleValue,
  isScheduling,
  onOpenSchedule,
  onScheduleValueChange,
  onSaveSchedule,
  onClearSchedule,
  onCancelSchedule,

  isExpanded,
  onToggleExpand,
  isLoadingDraft,
  draftContent,
  isFullExpanded,
  onToggleFullExpand,
}: {
  p: ContentProposal;
  stage: Stage;
  router: ReturnType<typeof useRouter>;
  bulkActing: boolean;

  isSelected: boolean;
  onToggleSelect: (id: string) => void;

  isApproving: boolean;
  isRejecting: boolean;
  isGeneratingDraft: boolean;
  isPublishing: boolean;
  onApprove: (id: string, opts?: { generate?: boolean }) => void;
  onGenerateDraft: (id: string) => void;
  onPublishDraft: (id: string) => void;
  onReopen: (id: string) => void;

  isRejectFormOpen: boolean;
  onToggleRejectForm: (id: string) => void;
  pendingRejectNote: string;
  onPendingRejectNoteChange: (v: string) => void;
  onReject: (id: string, note?: string) => void;
  onCancelRejectForm: () => void;

  isCloning: boolean;
  isCloneConfirmOpen: boolean;
  onOpenCloneConfirm: (id: string) => void;
  onCancelClone: () => void;
  onConfirmClone: (id: string) => void;

  isScheduleOpen: boolean;
  scheduleValue: string;
  isScheduling: boolean;
  onOpenSchedule: (p: ContentProposal) => void;
  onScheduleValueChange: (id: string, v: string) => void;
  onSaveSchedule: (id: string, value: string) => void;
  onClearSchedule: (id: string) => void;
  onCancelSchedule: () => void;

  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  isLoadingDraft: boolean;
  draftContent: Record<string, unknown> | null | undefined;
  isFullExpanded: boolean;
  onToggleFullExpand: (id: string) => void;
}) {
  const evidenceLines = proposalEvidenceLines(p);
  const canReject = canRejectContentProposal(p);

  function RejectButton() {
    if (!canReject) return null;
    return (
      <Button size="slim" tone="critical"
        loading={isRejecting} disabled={bulkActing || isApproving}
        onClick={() => onToggleRejectForm(p.id)}>
        {isRejectFormOpen ? "Cancel" : "Reject"}
      </Button>
    );
  }

  function StageBadge() {
    if (stage === "pending") return <Badge tone="attention">Pending</Badge>;
    if (stage === "approved") return <Badge tone="info">Approved</Badge>;
    if (stage === "generating") return <Badge tone="attention">Generating…</Badge>;
    if (stage === "ready") return <Badge tone="success">Ready</Badge>;
    if (stage === "scheduled") return <Badge tone="info">Scheduled</Badge>;
    if (stage === "published") return <Badge tone="success">Published</Badge>;
    if (stage === "failed") return <Badge tone="critical">Failed</Badge>;
    if (stage === "rejected") return <Badge tone="critical">Rejected</Badge>;
    return <Badge>—</Badge>;
  }

  function RowAction() {
    if (stage === "pending") {
      return (
        <InlineStack gap="200">
          <Button size="slim" variant="primary"
            loading={isApproving} disabled={bulkActing || isRejecting}
            onClick={() => onApprove(p.id, { generate: true })}>
            Approve &amp; Generate
          </Button>
          <Button size="slim"
            loading={isApproving} disabled={bulkActing || isRejecting}
            onClick={() => onApprove(p.id, { generate: false })}>
            Approve
          </Button>
          <RejectButton />
        </InlineStack>
      );
    }
    if (stage === "approved") {
      return (
        <InlineStack gap="200">
          <Button size="slim"
            loading={isGeneratingDraft}
            onClick={() => onGenerateDraft(p.id)}>
            Generate Draft
          </Button>
          <RejectButton />
        </InlineStack>
      );
    }
    if (stage === "generating") {
      return (
        <InlineStack gap="200">
          <Button size="slim" disabled loading>Generating…</Button>
          <RejectButton />
        </InlineStack>
      );
    }
    if (stage === "ready") {
      return (
        <InlineStack gap="200">
          <Button size="slim" variant="primary"
            loading={isPublishing} disabled={bulkActing}
            onClick={() => onPublishDraft(p.id)}>
            Publish
          </Button>
          <Button size="slim" onClick={() => onToggleExpand(p.id)}>
            {isExpanded ? "Collapse" : "Preview"}
          </Button>
          <Button size="slim" onClick={() => router.push(withShopifyContextUrl(`/content-pilot/draft/${p.id}`))}>
            Edit / Schedule
          </Button>
          <RejectButton />
        </InlineStack>
      );
    }
    if (stage === "scheduled") {
      return (
        <InlineStack gap="200">
          <Button size="slim" variant="primary"
            loading={isPublishing} disabled={bulkActing}
            onClick={() => onPublishDraft(p.id)}>
            Publish Now
          </Button>
          <Button size="slim" onClick={() => onToggleExpand(p.id)}>
            {isExpanded ? "Collapse" : "Preview"}
          </Button>
          <Button size="slim" onClick={() => router.push(withShopifyContextUrl(`/content-pilot/draft/${p.id}`))}>
            Edit / Schedule
          </Button>
          <RejectButton />
        </InlineStack>
      );
    }
    if (stage === "failed") {
      return (
        <InlineStack gap="200">
          <Button size="slim" loading={isGeneratingDraft} onClick={() => onGenerateDraft(p.id)}>
            Retry
          </Button>
          <Button size="slim" onClick={() => router.push(withShopifyContextUrl(`/content-pilot/draft/${p.id}`))}>
            View
          </Button>
          <RejectButton />
        </InlineStack>
      );
    }
    if (stage === "published") {
      return (
        <BlockStack gap="200">
          <InlineStack gap="200">
            <Button size="slim" onClick={() => onToggleExpand(p.id)}>
              {isExpanded ? "Collapse" : "Preview"}
            </Button>
            <Button size="slim" onClick={() => router.push(withShopifyContextUrl(`/content-pilot/draft/${p.id}`))}>
              View / Edit
            </Button>
            {p.publishedHandle && (
              <Button
                size="slim"
                url={`https://agrikoph.com/blogs/${(p.proposedState as Record<string, unknown>)?.blogHandle as string | undefined ?? "news"}/${p.publishedHandle}`}
                external
              >
                View on Shopify
              </Button>
            )}
          </InlineStack>
          {p.followUpScoredAt == null && p.baselineSeoScore != null && (
            <Text as="p" tone="subdued" variant="bodySm">SEO score tracked — check back in 14 days.</Text>
          )}
        </BlockStack>
      );
    }
    if (stage === "rejected") {
      return (
        <Button size="slim" onClick={() => onReopen(p.id)}>
          Re-open
        </Button>
      );
    }
    return null;
  }

  return (
    <Card key={p.id}>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" wrap>
          <InlineStack gap="200" blockAlign="center" wrap>
            {(p.status === "pending" || (p.status === "approved" && !p.draftStatus)) && (
              <Checkbox label="Select proposal" labelHidden checked={isSelected} onChange={() => onToggleSelect(p.id)} />
            )}
            <PriorityBadge priority={p.priority} />
            <StageBadge />
            <Badge>{p.proposalType}</Badge>
            <Text variant="headingSm" as="h3">{p.title}</Text>
          </InlineStack>
          <ImpactBadge level={p.impact} />
          {stage === "published" && (
            <SeoDeltaBadge before={p.baselineSeoScore} after={p.followUpSeoScore} />
          )}
        </InlineStack>

        <Text as="p" tone="subdued">{p.description}</Text>

        {stage === "failed" && p.draftError && (
          <Banner tone="critical" title="Draft generation failed">
            <p>{p.draftError}</p>
          </Banner>
        )}

        {p.proposalType === "new-content" && !p.articleHandle && (
          <Text as="p" tone="subdued" variant="bodySm">Will create a new article in your blog.</Text>
        )}

        {evidenceLines.length > 0 && (
          <Box background="bg-surface-secondary" padding="200" borderRadius="100">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">Why shown</Text>
              <InlineStack gap="200" wrap>
                {evidenceLines.map((line) => (
                  <Badge key={line}>{line}</Badge>
                ))}
              </InlineStack>
            </BlockStack>
          </Box>
        )}

        <ProposedChangeSummary proposalType={p.proposalType} proposedState={p.proposedState} />

        <RowAction />

        <InlineStack>
          {isCloneConfirmOpen ? (
            <InlineStack gap="200" blockAlign="center">
              <Text as="p" tone="subdued" variant="bodySm">Duplicate this proposal?</Text>
              <Button size="slim" loading={isCloning} onClick={() => onConfirmClone(p.id)}>Confirm</Button>
              <Button size="slim" onClick={onCancelClone}>Cancel</Button>
            </InlineStack>
          ) : (
            <Button size="slim" variant="plain" onClick={() => onOpenCloneConfirm(p.id)}>
              Duplicate
            </Button>
          )}
        </InlineStack>

        {p.scheduledPublishAt && (
          <Text as="p" tone="subdued" variant="bodySm">Scheduled: {new Date(p.scheduledPublishAt).toLocaleString()}</Text>
        )}

        {(stage === "ready" || stage === "scheduled") && (
          <Box>
            {!isScheduleOpen ? (
              <Button size="slim" variant="plain" onClick={() => onOpenSchedule(p)}>
                {p.scheduledPublishAt ? "Edit schedule" : "Schedule"}
              </Button>
            ) : (
              <InlineStack gap="200" blockAlign="end">
                <div style={{ minWidth: 200 }}>
                  <TextField
                    label="Publish at"
                    type="datetime-local"
                    value={scheduleValue}
                    onChange={(v) => onScheduleValueChange(p.id, v)}
                    autoComplete="off"
                  />
                  <Text as="p" tone="subdued" variant="bodySm">
                    {`Times are in your browser's local timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}
                  </Text>
                </div>
                <Button size="slim" loading={isScheduling} disabled={!scheduleValue}
                  onClick={() => onSaveSchedule(p.id, scheduleValue)}>
                  {p.scheduledPublishAt ? "Update" : "Set"}
                </Button>
                {p.scheduledPublishAt && (
                  <Button size="slim" tone="critical" loading={isScheduling}
                    onClick={() => onClearSchedule(p.id)}>
                    Clear
                  </Button>
                )}
                <Button size="slim" onClick={onCancelSchedule}>Cancel</Button>
              </InlineStack>
            )}
          </Box>
        )}

        {/* Inline draft accordion */}
        {isExpanded && (
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            {isLoadingDraft ? (
              <InlineStack align="center"><Spinner size="small" /></InlineStack>
            ) : (() => {
              const draft = draftContent;
              // Runtime guard: cached drafts may be from an older shape or
              // malformed (null, primitive, or array). Only treat a plain
              // non-null object as renderable; otherwise show a safe fallback
              // so the type-specific casts below can't crash rendering.
              if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
                return <Text as="p" tone="subdued">No draft content available.</Text>;
              }
              if (p.proposalType === "seo-fix") {
                const d = draft as { metaTitle?: string; metaDescription?: string };
                return (
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text variant="headingSm" as="h4">Meta Title</Text>
                      <Text as="p">{d.metaTitle ?? "—"}</Text>
                      <Text as="p" tone="subdued" variant="bodySm">{(d.metaTitle ?? "").length} chars</Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text variant="headingSm" as="h4">Meta Description</Text>
                      <Text as="p">{d.metaDescription ?? "—"}</Text>
                      <Text as="p" tone="subdued" variant="bodySm">{(d.metaDescription ?? "").length} chars</Text>
                    </BlockStack>
                  </BlockStack>
                );
              }
              if (p.proposalType === "internal-link") {
                const d = draft as { suggestedParagraph?: string; anchorText?: string };
                return (
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text variant="headingSm" as="h4">Paragraph to append</Text>
                      <Text as="p">{d.suggestedParagraph ?? "—"}</Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text variant="headingSm" as="h4">Anchor text</Text>
                      <Text as="p">{d.anchorText ?? "—"}</Text>
                    </BlockStack>
                  </BlockStack>
                );
              }
              if (p.proposalType === "new-content") {
                const d = draft as { title?: string; bodyHtml?: string; metaDescription?: string; tags?: string[] };
                return (
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text variant="headingSm" as="h4">Title</Text>
                      <Text as="p">{d.title ?? "—"}</Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text variant="headingSm" as="h4">Meta Description</Text>
                      <Text as="p">{d.metaDescription ?? "—"}</Text>
                    </BlockStack>
                    {d.tags && d.tags.length > 0 && (
                      <BlockStack gap="100">
                        <Text variant="headingSm" as="h4">Tags</Text>
                        <Text as="p">{d.tags.join(", ")}</Text>
                      </BlockStack>
                    )}
                    <BlockStack gap="100">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="headingSm" as="h4">Article Body</Text>
                        <Button size="slim" onClick={() => onToggleFullExpand(p.id)}>
                          {isFullExpanded ? "Collapse" : "Expand"}
                        </Button>
                      </InlineStack>
                      <Box background="bg-surface" padding="300" borderRadius="100">
                        <div
                          style={{ fontSize: "13px", lineHeight: "1.6", maxHeight: isFullExpanded ? "none" : "400px", overflowY: isFullExpanded ? "visible" : "auto" }}
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(d.bodyHtml ?? "") }}
                        />
                      </Box>
                      {d.bodyHtml && (
                        <Text as="p" tone="subdued" variant="bodySm">{`~${countWordsFromHtml(d.bodyHtml).toLocaleString()} words`}</Text>
                      )}
                    </BlockStack>
                  </BlockStack>
                );
              }
              // content-refresh / thin-content
              const d = draft as { bodyHtml?: string };
              const isFull = isFullExpanded;
              return (
                <BlockStack gap="100">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingSm" as="h4">Updated Body</Text>
                    <Button size="slim" onClick={() => onToggleFullExpand(p.id)}>
                      {isFull ? "Collapse" : "Expand"}
                    </Button>
                  </InlineStack>
                  <Box background="bg-surface" padding="300" borderRadius="100">
                    <div
                      style={{ fontSize: "13px", lineHeight: "1.6", maxHeight: isFull ? "none" : "400px", overflowY: isFull ? "visible" : "auto" }}
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(d.bodyHtml ?? "") }}
                    />
                  </Box>
                  {d.bodyHtml && (
                    <Text as="p" tone="subdued" variant="bodySm">{`~${countWordsFromHtml(d.bodyHtml).toLocaleString()} words`}</Text>
                  )}
                </BlockStack>
              );
            })()}
          </Box>
        )}

        {/* Inline reject form */}
        {canReject && isRejectFormOpen && (
          <BlockStack gap="200">
            <Divider />
            <TextField
              label="Rejection reason (optional)"
              value={pendingRejectNote}
              onChange={onPendingRejectNoteChange}
              multiline={2}
              autoComplete="off"
              placeholder="e.g. Not aligned with current content strategy"
            />
            <InlineStack gap="200">
              <Button size="slim" variant="primary" tone="critical"
                loading={isRejecting}
                onClick={() => onReject(p.id, pendingRejectNote || undefined)}>
                Confirm Reject
              </Button>
              <Button size="slim" onClick={onCancelRejectForm}>
                Cancel
              </Button>
            </InlineStack>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
