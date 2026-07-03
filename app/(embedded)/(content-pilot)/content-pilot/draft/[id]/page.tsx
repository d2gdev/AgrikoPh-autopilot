// app/(embedded)/(content-pilot)/content-pilot/draft/[id]/page.tsx
"use client";

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { return { error: `Server returned non-JSON (HTTP ${res.status}): ${text.slice(0, 120)}` }; }
}

import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  Button,
  Banner,
  Spinner,
  Box,
  Divider,
  TextField,
  Modal,
  Toast,
} from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";

// ── Helpers ────────────────────────────────────────────────────────────────────

// Build a useful message from a failed Response. Reads the body as text so a
// non-JSON error page (auth/SSO redirect, hosting error page) surfaces the real
// HTTP status instead of a cryptic "Unexpected token '<'" JSON-parse error.
async function describeHttpError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.text();
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed?.error) return parsed.error;
    } catch {
      return `${fallback} (HTTP ${res.status}) — the server returned a non-JSON response. You may be signed out, or the API is unavailable.`;
    }
  } catch { /* body unreadable */ }
  return `${fallback} (HTTP ${res.status})`;
}

function countWords(html: string): number {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;
}
import { useParams, useRouter } from "next/navigation";
import { useAuthFetch, withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { priorityTone } from "@/lib/ui/tones";
import { sanitizeHtml } from "@/lib/content-pilot/sanitize-html";
import { GroundingCitations } from "@/components/content-pilot/grounding-citations";
import type { DraftCitation } from "@/lib/content-pilot/generate-draft";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ContentProposal {
  id: string;
  title: string;
  description: string;
  proposalType: string;
  priority: "P1" | "P2" | "P3";
  impact: string;
  effort: string;
  articleHandle: string | null;
  status: string;
  draftStatus: string | null;
  draftError?: string | null;
  draftContent: Record<string, unknown> | null;
  draftGeneratedAt: string | null;
  publishedAt: string | null;
  scheduledPublishAt: string | null;
  citations?: unknown;
}

interface DraftHistoryEntry {
  id: string;
  savedAt: string;
  savedBy: string;
  reason: string;
  draftContent: Record<string, unknown>;
}

// ── Draft preview components ───────────────────────────────────────────────────

function SeoPreview({ draft }: { draft: { metaTitle?: string; metaDescription?: string } }) {
  const metaTitle = draft.metaTitle ?? "";
  const metaDescription = draft.metaDescription ?? "";
  return (
    <BlockStack gap="400">
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Meta Title</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p">{metaTitle}</Text>
        </Box>
        <Text as="p" tone="subdued">{metaTitle.length} characters (target: 50–60)</Text>
      </BlockStack>
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Meta Description</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p">{metaDescription}</Text>
        </Box>
        <Text as="p" tone="subdued">{metaDescription.length} characters (target: 140–160)</Text>
      </BlockStack>
    </BlockStack>
  );
}

function InternalLinkPreview({ draft }: { draft: { suggestedParagraph?: string; anchorText?: string; targetHandle?: string } }) {
  return (
    <BlockStack gap="400">
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Paragraph to append</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p">{draft.suggestedParagraph ?? ""}</Text>
        </Box>
      </BlockStack>
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Anchor text</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p">{draft.anchorText ?? ""}</Text>
        </Box>
      </BlockStack>
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Links to</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p" tone="subdued">{draft.targetHandle ?? ""}</Text>
        </Box>
      </BlockStack>
    </BlockStack>
  );
}

function BodyHtmlPreview({ draft }: { draft: { bodyHtml?: string } }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="center">
        <Text variant="headingSm" as="h4">Article content</Text>
        <Button size="slim" onClick={() => setExpanded(e => !e)}>{expanded ? "Collapse" : "Expand"}</Button>
      </InlineStack>
      <Box
        background="bg-surface-secondary"
        padding="400"
        borderRadius="200"
        overflowX="hidden"
      >
        <div
          style={{ maxHeight: expanded ? "none" : "500px", overflowY: expanded ? "visible" : "auto", fontSize: "14px", lineHeight: "1.6" }}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(draft.bodyHtml ?? "") }}
        />
      </Box>
      <Text as="p" tone="subdued" variant="bodySm">{`~${countWords(draft.bodyHtml ?? "").toLocaleString()} words`}</Text>
    </BlockStack>
  );
}

function NewContentPreview({ draft }: { draft: { title?: string; bodyHtml?: string; tags?: string[]; metaDescription?: string } }) {
  const [bodyExpanded, setBodyExpanded] = useState(false);
  return (
    <BlockStack gap="400">
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Title</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p">{draft.title ?? ""}</Text>
        </Box>
      </BlockStack>
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Meta description</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p">{draft.metaDescription ?? ""}</Text>
        </Box>
      </BlockStack>
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Tags</Text>
        <InlineStack gap="200">
          {(draft.tags ?? []).map((t) => <Badge key={t}>{t}</Badge>)}
        </InlineStack>
      </BlockStack>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingSm" as="h4">Article body</Text>
          <Button size="slim" onClick={() => setBodyExpanded(e => !e)}>{bodyExpanded ? "Collapse" : "Expand"}</Button>
        </InlineStack>
        <Box
          background="bg-surface-secondary"
          padding="400"
          borderRadius="200"
          overflowX="hidden"
        >
          <div
            style={{ maxHeight: bodyExpanded ? "none" : "500px", overflowY: bodyExpanded ? "visible" : "auto", fontSize: "14px", lineHeight: "1.6" }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(draft.bodyHtml ?? "") }}
          />
        </Box>
        <Text as="p" tone="subdued" variant="bodySm">{`~${countWords(draft.bodyHtml ?? "").toLocaleString()} words`}</Text>
      </BlockStack>
    </BlockStack>
  );
}

function DraftPreview({ proposal }: { proposal: ContentProposal }) {
  if (!proposal.draftContent) return null;
  const d = proposal.draftContent;

  if (proposal.proposalType === "seo-fix") {
    return <SeoPreview draft={d as { metaTitle?: string; metaDescription?: string }} />;
  }
  if (proposal.proposalType === "internal-link") {
    return <InternalLinkPreview draft={d as { suggestedParagraph?: string; anchorText?: string; targetHandle?: string }} />;
  }
  if (proposal.proposalType === "new-content") {
    return <NewContentPreview draft={d as { title?: string; bodyHtml?: string; tags?: string[]; metaDescription?: string }} />;
  }
  // content-refresh, thin-content, anything else with bodyHtml
  return <BodyHtmlPreview draft={d as { bodyHtml?: string }} />;
}

// ── Draft editor ───────────────────────────────────────────────────────────────

// Inline editor mirroring DraftPreview's per-type fields. The AI draft is a
// starting point — operators can refine it here before publishing. Field shapes
// must match the schema enforced by PATCH /api/content-pilot/proposals/[id].
function DraftEditor({
  proposal,
  saving,
  onSave,
  onCancel,
}: {
  proposal: ContentProposal;
  saving: boolean;
  onSave: (draftContent: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const initial = (proposal.draftContent ?? {}) as Record<string, unknown>;
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [k, v] of Object.entries(initial)) {
      init[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
    }
    return init;
  });

  const set = (key: string) => (value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const buildDraftContent = (): Record<string, unknown> => {
    // Merge edited fields over the original draftContent so AI-provided fields
    // outside this form's whitelist survive a save instead of being dropped.
    const edited = (() => {
      switch (proposal.proposalType) {
        case "seo-fix":
          return {
            metaTitle: fields.metaTitle ?? "",
            metaDescription: fields.metaDescription ?? "",
          };
        case "internal-link":
          return {
            suggestedParagraph: fields.suggestedParagraph ?? "",
            anchorText: fields.anchorText ?? "",
            targetHandle: fields.targetHandle ?? "",
          };
        case "new-content":
          return {
            title: fields.title ?? "",
            metaDescription: fields.metaDescription ?? "",
            tags: (fields.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
            bodyHtml: fields.bodyHtml ?? "",
          };
        default:
          return { bodyHtml: fields.bodyHtml ?? "" };
      }
    })();
    return { ...initial, ...edited };
  };

  const dirty = Object.entries(fields).some(([k, v]) => {
    const orig = initial[k];
    const origStr = Array.isArray(orig) ? orig.join(", ") : String(orig ?? "");
    return v !== origStr;
  });
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  let formFields;
  if (proposal.proposalType === "seo-fix") {
    formFields = (
      <>
        <TextField
          label="Meta Title"
          value={fields.metaTitle ?? ""}
          onChange={set("metaTitle")}
          autoComplete="off"
          helpText={`${(fields.metaTitle ?? "").length} characters (target 50–60)`}
        />
        <TextField
          label="Meta Description"
          value={fields.metaDescription ?? ""}
          onChange={set("metaDescription")}
          multiline={3}
          autoComplete="off"
          helpText={`${(fields.metaDescription ?? "").length} characters (target 140–160)`}
        />
      </>
    );
  } else if (proposal.proposalType === "internal-link") {
    formFields = (
      <>
        <TextField
          label="Paragraph to append"
          value={fields.suggestedParagraph ?? ""}
          onChange={set("suggestedParagraph")}
          multiline={4}
          autoComplete="off"
        />
        <TextField
          label="Anchor text"
          value={fields.anchorText ?? ""}
          onChange={set("anchorText")}
          autoComplete="off"
        />
        <TextField
          label="Links to (handle)"
          value={fields.targetHandle ?? ""}
          onChange={set("targetHandle")}
          autoComplete="off"
        />
      </>
    );
  } else if (proposal.proposalType === "new-content") {
    formFields = (
      <>
        <TextField
          label="Title"
          value={fields.title ?? ""}
          onChange={set("title")}
          autoComplete="off"
        />
        <TextField
          label="Meta description"
          value={fields.metaDescription ?? ""}
          onChange={set("metaDescription")}
          multiline={3}
          autoComplete="off"
        />
        <TextField
          label="Tags (comma-separated)"
          value={fields.tags ?? ""}
          onChange={set("tags")}
          autoComplete="off"
        />
        <TextField
          label="Article body (HTML)"
          value={fields.bodyHtml ?? ""}
          onChange={set("bodyHtml")}
          multiline={16}
          autoComplete="off"
          monospaced
          helpText={`~${countWords(fields.bodyHtml ?? "")} words`}
        />
      </>
    );
  } else {
    formFields = (
      <TextField
        label="Article content (HTML)"
        value={fields.bodyHtml ?? ""}
        onChange={set("bodyHtml")}
        multiline={16}
        autoComplete="off"
        monospaced
        helpText={`~${countWords(fields.bodyHtml ?? "")} words`}
      />
    );
  }

  return (
    <BlockStack gap="400">
      {formFields}
      <InlineStack gap="200" blockAlign="center">
        <Button variant="primary" loading={saving} onClick={() => onSave(buildDraftContent())}>
          Save changes
        </Button>
        <Button
          tone={confirmDiscard ? "critical" : undefined}
          onClick={() => {
            if (dirty && !confirmDiscard) { setConfirmDiscard(true); return; }
            onCancel();
          }}
          disabled={saving}
        >
          {confirmDiscard ? "Discard unsaved changes?" : "Cancel"}
        </Button>
        {confirmDiscard && (
          <Button variant="plain" onClick={() => setConfirmDiscard(false)} disabled={saving}>
            Keep editing
          </Button>
        )}
      </InlineStack>
    </BlockStack>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DraftReviewPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const authFetch = useAuthFetch();
  const [proposal, setProposal] = useState<ContentProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  // Publish scheduling
  const [scheduledAt, setScheduledAt] = useState("");
  const [scheduling, setScheduling] = useState(false);
  // Draft history
  const [history, setHistory] = useState<DraftHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Regenerate confirmation
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}`);
      if (!res.ok) {
        setError(await describeHttpError(res, "Failed to load proposal"));
        return;
      }
      let d: { proposal?: unknown };
      try {
        d = (await res.json()) as { proposal?: unknown };
      } catch {
        setError(`Loaded but could not parse the response (HTTP ${res.status}) — the server returned non-JSON. You may be signed out, or the API is unavailable.`);
        return;
      }
      setProposal(d.proposal as typeof proposal);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [authFetch, id]);

  useEffect(() => { load(); }, [load]);

  // Sync schedule picker with loaded proposal
  useEffect(() => {
    if (proposal?.scheduledPublishAt) {
      // Convert to local datetime-local value (YYYY-MM-DDTHH:MM)
      const d = new Date(proposal.scheduledPublishAt);
      const pad = (n: number) => String(n).padStart(2, "0");
      setScheduledAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
  }, [proposal?.scheduledPublishAt]);

  const regenerate = async () => {
    setGenerating(true);
    setError(null);
    setPublishConfirm(false);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/generate-draft`, {
        method: "POST",
      });
      const d = await safeJson(res);
      if (!res.ok) { setError((d.error as string) ?? "Generation failed"); return; }
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const saveEdit = async (draftContent: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftContent }),
      });
      const d = await safeJson(res);
      if (!res.ok) { setError((d.error as string) ?? "Save failed"); return; }
      setEditing(false);
      setSavedToast(true);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const saveSchedule = async (clear = false) => {
    let scheduledIso: string | null = null;
    if (!clear && scheduledAt) {
      const d = new Date(scheduledAt);
      if (isNaN(d.getTime())) { setError("Invalid date"); return; }
      scheduledIso = d.toISOString();
    }
    setScheduling(true);
    setError(null);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Convert the timezone-less datetime-local value ("YYYY-MM-DDTHH:MM",
        // interpreted in the browser's zone) into an absolute UTC instant, so the
        // server stores the moment the operator actually meant regardless of the
        // server's own timezone. The picker is re-hydrated from this instant in
        // local time on load, so the round-trip is consistent.
        body: JSON.stringify({
          scheduledPublishAt: scheduledIso,
        }),
      });
      const d = await safeJson(res);
      if (!res.ok) { setError((d.error as string) ?? "Schedule failed"); return; }
      if (clear) setScheduledAt("");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setScheduling(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/draft-history`);
      if (!res.ok) {
        setError(await describeHttpError(res, "Failed to load draft history"));
        return;
      }
      let d: { history?: DraftHistoryEntry[] };
      try {
        d = (await res.json()) as { history?: DraftHistoryEntry[] };
      } catch {
        setError(`Loaded but could not parse draft history (HTTP ${res.status}) — the server returned non-JSON.`);
        return;
      }
      setHistory(d.history ?? []);
      setShowHistory(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setHistoryLoading(false);
    }
  };

  const restoreHistoryEntry = async (entry: DraftHistoryEntry) => {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftContent: entry.draftContent }),
      });
      const d = await safeJson(res);
      if (!res.ok) { setError((d.error as string) ?? "Restore failed"); return; }
      setShowHistory(false);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/publish`, {
        method: "POST",
      });
      const d = await safeJson(res);
      if (!res.ok) { setError((d.error as string) ?? "Publish failed"); return; }
      setPublishConfirm(false);
      router.push(withShopifyContextUrl("/content-pilot?tab=1"));
    } catch (e) {
      setError(String(e));
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return (
      <Page title="Draft Review">
        <Layout>
          <Layout.Section>
            <InlineStack align="center"><Spinner /></InlineStack>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (!proposal) {
    return (
      <Page title="Draft Review">
        <Layout>
          <Layout.Section>
            <Banner tone="critical">{error ?? "Proposal not found"}</Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const isPublished = proposal.draftStatus === "published";
  const hasDraft = proposal.draftStatus === "ready";
  const isGenerating = proposal.draftStatus === "generating" || generating;

  return (
    <Page
      title="Draft Review"
      backAction={{ content: "Queue", onAction: () => router.push(withShopifyContextUrl("/content-pilot?tab=1")) }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>{error}</Banner>
          </Layout.Section>
        )}
        {isPublished && (
          <Layout.Section>
            <Banner tone="success">
              {proposal.publishedAt
                ? `Published to Shopify on ${new Date(proposal.publishedAt).toLocaleString()}.`
                : "Published to Shopify."}
            </Banner>
          </Layout.Section>
        )}
        {proposal.draftStatus === "failed" && proposal.draftError && (
          <Layout.Section>
            <Banner tone="critical">
              <Text as="p"><strong>Validation error:</strong> {proposal.draftError}</Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Proposal</Text>
                <InlineStack gap="200">
                  <Badge tone={priorityTone(proposal.priority)}>{proposal.priority}</Badge>
                  <Badge>{proposal.proposalType}</Badge>
                </InlineStack>
                <Text variant="headingSm" as="h3">{proposal.title}</Text>
                <Text as="p" tone="subdued">{proposal.description}</Text>
                {proposal.articleHandle && (
                  <Text as="p" tone="subdued">
                    Article: <code>{proposal.articleHandle}</code>
                  </Text>
                )}
                <Divider />
                <InlineStack gap="200">
                  <Badge tone={proposal.impact?.toLowerCase() === "high" ? "success" : proposal.impact?.toLowerCase() === "medium" ? "attention" : "info"}>
                    {`${proposal.impact} impact`}
                  </Badge>
                  <Badge tone={proposal.effort?.toLowerCase() === "low" ? "success" : proposal.effort?.toLowerCase() === "medium" ? "attention" : "critical"}>
                    {`${proposal.effort} effort`}
                  </Badge>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Actions</Text>
                {!confirmRegenerate ? (
                  <Button
                    onClick={hasDraft ? () => setConfirmRegenerate(true) : regenerate}
                    loading={isGenerating}
                    disabled={isPublished || publishing || editing}
                  >
                    {hasDraft ? "Regenerate Draft" : "Generate Draft"}
                  </Button>
                ) : (
                  <BlockStack gap="200">
                    <Text as="p" tone="caution">This will overwrite the current draft. It is saved in history first.</Text>
                    <InlineStack gap="200">
                      <Button variant="primary" tone="critical" loading={isGenerating} onClick={() => { setConfirmRegenerate(false); regenerate(); }}>
                        Confirm Regenerate
                      </Button>
                      <Button onClick={() => setConfirmRegenerate(false)}>Cancel</Button>
                    </InlineStack>
                  </BlockStack>
                )}
                {hasDraft && !isPublished && !editing && (
                  <Button onClick={() => { setEditing(true); setPublishConfirm(false); setConfirmRegenerate(false); }} disabled={isGenerating || publishing}>
                    Edit Draft
                  </Button>
                )}
                {hasDraft && !isPublished && !editing && (
                  <>
                    {!publishConfirm ? (
                      <Button
                        variant="primary"
                        onClick={() => setPublishConfirm(true)}
                        disabled={isGenerating}
                      >
                        Publish to Shopify
                      </Button>
                    ) : (
                      <BlockStack gap="200">
                        <Text as="p" tone="caution">This will write changes live to Shopify immediately.</Text>
                        <InlineStack gap="200">
                          <Button variant="primary" tone="critical" onClick={publish} loading={publishing}>
                            Confirm Publish
                          </Button>
                          <Button onClick={() => setPublishConfirm(false)}>Cancel</Button>
                        </InlineStack>
                      </BlockStack>
                    )}
                  </>
                )}
                {hasDraft && !isPublished && !editing && (
                  <BlockStack gap="200">
                    <Divider />
                    <Text variant="headingSm" as="h4">Schedule publish</Text>
                    {proposal.scheduledPublishAt && (
                      <Banner tone="info">
                        Scheduled for {new Date(proposal.scheduledPublishAt).toLocaleString()}
                      </Banner>
                    )}
                    <TextField
                      label="Publish at"
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={setScheduledAt}
                      autoComplete="off"
                    />
                    <InlineStack gap="200">
                      <Button size="slim" loading={scheduling} disabled={!scheduledAt} onClick={() => saveSchedule()}>
                        {proposal.scheduledPublishAt ? "Update schedule" : "Schedule"}
                      </Button>
                      {proposal.scheduledPublishAt && (
                        <Button size="slim" tone="critical" loading={scheduling} onClick={() => saveSchedule(true)}>
                          Clear
                        </Button>
                      )}
                    </InlineStack>
                  </BlockStack>
                )}
                <Divider />
                {hasDraft && (
                  <Button size="slim" loading={historyLoading} onClick={loadHistory}>
                    View draft history
                  </Button>
                )}
                {proposal.draftGeneratedAt && (
                  <Text as="p" tone="subdued">
                    Draft generated: {new Date(proposal.draftGeneratedAt).toLocaleString()}
                  </Text>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">{editing ? "Edit Draft" : "Draft Preview"}</Text>
              {isGenerating && (
                <InlineStack gap="300" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="p" tone="subdued">Generating draft…</Text>
                </InlineStack>
              )}
              {!isGenerating && !hasDraft && !isPublished && (
                <Text as="p" tone="subdued">
                  No draft yet. Click &quot;Generate Draft&quot; to create one.
                </Text>
              )}
              {editing && hasDraft && (
                <DraftEditor
                  proposal={proposal}
                  saving={saving}
                  onSave={saveEdit}
                  onCancel={() => setEditing(false)}
                />
              )}
              {!editing && (hasDraft || isPublished) && proposal.draftContent && (
                <DraftPreview proposal={proposal} />
              )}
              <GroundingCitations citations={proposal?.citations as DraftCitation[] | undefined} />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Draft history modal */}
      <Modal
        open={showHistory}
        onClose={() => setShowHistory(false)}
        title="Draft history"
        secondaryActions={[{ content: "Close", onAction: () => setShowHistory(false) }]}
        size="large"
      >
        <Modal.Section>
          {history.length === 0 ? (
            <Text as="p" tone="subdued">No history recorded yet.</Text>
          ) : (
            <BlockStack gap="400">
              {history.map((entry) => (
                <Card key={entry.id}>
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="headingSm" as="h4">
                          {entry.reason === "generated" ? "Generated by AI" :
                           entry.reason === "regenerated" ? "Regenerated by AI" :
                           "Manually edited"}
                        </Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          {new Date(entry.savedAt).toLocaleString()} · {entry.savedBy}
                        </Text>
                        {(entry.draftContent.bodyHtml as string | undefined) && (
                          <Text as="p" tone="subdued" variant="bodySm">
                            {`~${countWords(String(entry.draftContent.bodyHtml)).toLocaleString()} words`}
                          </Text>
                        )}
                      </BlockStack>
                      <Button
                        size="slim"
                        loading={saving}
                        onClick={() => restoreHistoryEntry(entry)}
                      >
                        Restore this version
                      </Button>
                    </InlineStack>
                    <Divider />
                    <DraftPreview proposal={{ ...proposal, draftContent: entry.draftContent }} />
                  </BlockStack>
                </Card>
              ))}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>

      {savedToast && <Toast content="Draft saved" onDismiss={() => setSavedToast(false)} />}
    </Page>
  );
}
