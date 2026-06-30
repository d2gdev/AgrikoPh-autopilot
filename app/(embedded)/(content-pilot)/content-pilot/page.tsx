"use client";

import { getCache, setCache } from "@/lib/client-cache";

// Safely parse a Response as JSON. If the body is not JSON (e.g. an HTML error
// page from a proxy or Next.js itself), returns { error: <raw text> } rather
// than throwing SyntaxError: Unexpected token '<'.
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
  DataTable,
  Spinner,
  Banner,
  Tabs,
  Button,
  Box,
  TextField,
  Select,
  Checkbox,
  Divider,
  Modal,
} from "@shopify/polaris";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthFetch, withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { sanitizeHtml } from "@/lib/content-pilot/sanitize-html";

// ── Types ──────────────────────────────────────────────────────────────────

interface ArticleRow {
  handle: string;
  title: string;
  publishedAt: string | null;
  wordCount: number;
  seoScore: number;
  seoIssues: string[];
  internalLinks: number;
  inboundCount: number;
  topics: string[];
}

interface TopicCluster {
  topic: string;
  articleCount: number;
  keywordCount: number;
  gapScore: number;
}

interface LinkGraphData {
  total: number;
  hubs: { handle: string; title: string; inboundCount: number; outboundLinks: number }[];
  orphans: { handle: string; title: string; inboundCount: number; outboundLinks: number }[];
  orphanCount: number;
}

interface ContentProposal {
  id: string;
  createdAt: string;
  articleHandle: string | null;
  proposalType: string;
  changeType: string;
  priority: "P1" | "P2" | "P3";
  impact: string;
  effort: string;
  title: string;
  description: string;
  proposedState: Record<string, unknown>;
  sourceData?: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  draftStatus: string | null;
  draftError?: string | null;
  draftGeneratedAt: string | null;
  scheduledPublishAt?: string | null;
  draftContent?: Record<string, unknown> | null;
  publishedHandle?: string | null;
  shopifyArticleId?: string | null;
  bodyHtml?: string | null;
  baselineSeoScore?: number | null;
  followUpSeoScore?: number | null;
  followUpScoredAt?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function countWordsFromHtml(html: string): number {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;
}

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 80 ? "success" : score >= 50 ? "attention" : "critical";
  return <Badge tone={tone}>{String(score)}</Badge>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const tone = priority === "P1" ? "critical" : priority === "P2" ? "attention" : "info";
  return <Badge tone={tone}>{priority}</Badge>;
}

function ImpactBadge({ level }: { level: string }) {
  const l = level?.toLowerCase();
  const tone = l === "high" ? "success" : l === "medium" ? "attention" : "info";
  return <Badge tone={tone}>{level}</Badge>;
}

function SeoDeltaBadge({ before, after }: { before: number | null | undefined; after: number | null | undefined }) {
  if (before == null || after == null) return null;
  const delta = after - before;
  if (delta === 0) return <Badge tone="info">SEO ±0</Badge>;
  const tone = delta > 0 ? "success" : "critical";
  return <Badge tone={tone}>{delta > 0 ? `SEO +${delta}` : `SEO ${delta}`}</Badge>;
}

function draftFailureMessage(data: Record<string, unknown>, fallback = "Draft generation failed") {
  const error = typeof data.error === "string" ? data.error : fallback;
  const detail = typeof data.detail === "string" ? data.detail : "";
  return detail && !error.includes(detail) ? `${error}: ${detail}` : error;
}

// Fix #6 — unknown types fall back to readable JSON rather than showing nothing
function ProposedChangeSummary({
  proposalType,
  proposedState,
}: {
  proposalType: string;
  proposedState: Record<string, unknown>;
}) {
  const lines: string[] = [];

  if (proposalType === "missing-meta") {
    if (proposedState.field) lines.push(`Field: ${proposedState.field}`);
    if (proposedState.currentValue !== undefined) lines.push(`Current value: ${proposedState.currentValue ?? "none"}`);
    if (proposedState.issues) lines.push(`Issues: ${(proposedState.issues as string[]).join(", ")}`);
  } else if (proposalType === "seo-fix") {
    if (proposedState.targetQuery) lines.push(`Target query: ${proposedState.targetQuery}`);
    if (proposedState.action) lines.push(`Action: ${String(proposedState.action).replace(/-/g, " ")}`);
    if (proposedState.field) lines.push(`Field: ${proposedState.field}`);
    if (proposedState.suggestedTitleSuffix) lines.push(`Title suffix: ${proposedState.suggestedTitleSuffix}`);
  } else if (proposalType === "internal-link") {
    if (proposedState.fromArticle) lines.push(`Link from: ${proposedState.fromArticle}`);
    if (proposedState.toArticle) lines.push(`Link to: ${proposedState.toArticle}`);
    if (proposedState.suggestedAnchorText) lines.push(`Anchor text: "${proposedState.suggestedAnchorText}"`);
  } else if (proposalType === "content-refresh" || proposalType === "thin-content") {
    if (proposedState.action) lines.push(`Action: ${String(proposedState.action).replace(/-/g, " ")}`);
    if (proposedState.targetWordCount) lines.push(`Target word count: ${proposedState.targetWordCount}`);
    if (proposedState.currentWordCount) lines.push(`Current word count: ${proposedState.currentWordCount}`);
  } else if (proposalType === "new-content") {
    if (proposedState.targetKeyword) lines.push(`Target keyword: ${proposedState.targetKeyword}`);
    if (proposedState.suggestedTitle) lines.push(`Suggested title: ${proposedState.suggestedTitle}`);
    if (proposedState.idealWordCount) lines.push(`Target length: ${proposedState.idealWordCount} words`);
  } else {
    // Unknown type — show raw JSON so nothing is silently hidden
    return (
      <pre style={{ fontSize: "12px", overflowX: "auto", background: "#f6f6f7", padding: "8px", borderRadius: "4px" }}>
        {JSON.stringify(proposedState, null, 2)}
      </pre>
    );
  }

  if (lines.length === 0) return null;

  return (
    <BlockStack gap="100">
      {lines.map((l, i) => (
        <Text key={i} as="p" tone="subdued" variant="bodySm">
          {l}
        </Text>
      ))}
    </BlockStack>
  );
}

// ── Overview Tab ───────────────────────────────────────────────────────────

function OverviewTab({
  articles,
  clusters,
  linkGraph,
  loading,
  articlesError,
}: {
  articles: ArticleRow[];
  clusters: TopicCluster[];
  linkGraph: LinkGraphData | null;
  loading: boolean;
  articlesError: boolean; // Fix #3 — distinguish timeout from genuinely empty
}) {
  const articleRows = articles.map((a) => [
    a.title,
    fmt(a.publishedAt),
    <ScoreBadge key={a.handle} score={a.seoScore} />,
    a.topics.join(", ") || "—",
    String(a.internalLinks ?? 0),
    String(a.inboundCount ?? 0),
  ]);

  const clusterRows = clusters.slice(0, 15).map((c) => [
    c.topic,
    String(c.articleCount),
    String(c.keywordCount),
    <Badge
      key={c.topic}
      tone={c.gapScore >= 80 ? "critical" : c.gapScore >= 40 ? "attention" : "success"}
    >
      {String(c.gapScore)}
    </Badge>,
  ]);

  const orphanRows = (linkGraph?.orphans ?? []).slice(0, 10).map((a) => [
    a.title,
    String(a.outboundLinks ?? 0),
  ]);

  const hubRows = (linkGraph?.hubs ?? []).map((a) => [
    a.title,
    String(a.inboundCount ?? 0),
    String(a.outboundLinks ?? 0),
  ]);

  if (loading) {
    return (
      <InlineStack align="center">
        <Spinner size="small" />
      </InlineStack>
    );
  }

  return (
    <BlockStack gap="600">
      <BlockStack gap="300">
        <Text variant="headingMd" as="h2">
          Topic Cluster Gaps
        </Text>
        <Text as="p" tone="subdued">
          Gap score 0–100. Higher = more content needed.
        </Text>
        {clusterRows.length === 0 ? (
          <Text as="p" tone="subdued">
            Run the indexer to populate topic data.
          </Text>
        ) : (
          <DataTable
            columnContentTypes={["text", "numeric", "numeric", "text"]}
            headings={["Topic", "Articles", "Keywords", "Gap Score"]}
            rows={clusterRows}
          />
        )}
      </BlockStack>

      <InlineStack gap="400" align="start" blockAlign="start" wrap>
        <Box minWidth="45%">
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">
              Orphan Articles
            </Text>
            <Text as="p" tone="subdued">
              No inbound internal links — low crawl priority.
            </Text>
            {orphanRows.length === 0 ? (
              <Text as="p" tone="subdued">
                No orphans found.
              </Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "numeric"]}
                headings={["Article", "Out-links"]}
                rows={orphanRows}
              />
            )}
          </BlockStack>
        </Box>
        <Box minWidth="45%">
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">
              Hub Articles
            </Text>
            <Text as="p" tone="subdued">
              Most-linked-to — pillar content candidates.
            </Text>
            {hubRows.length === 0 ? (
              <Text as="p" tone="subdued">
                Run the indexer first.
              </Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric"]}
                headings={["Article", "In-links", "Out-links"]}
                rows={hubRows}
              />
            )}
          </BlockStack>
        </Box>
      </InlineStack>

      <BlockStack gap="300">
        <Text variant="headingMd" as="h2">
          Indexed Articles
        </Text>
        {articlesError ? (
          <Text as="p" tone="subdued">
            Articles failed to load — try refreshing the page.
          </Text>
        ) : articleRows.length === 0 ? (
          <Text as="p" tone="subdued">
            No articles indexed yet. Click &ldquo;Run Indexer&rdquo; to analyse your blog posts.
          </Text>
        ) : (
          <DataTable
            columnContentTypes={["text", "text", "text", "text", "numeric", "numeric"]}
            headings={["Title", "Published", "SEO Score", "Topics", "Out-links", "In-links"]}
            rows={articleRows}
          />
        )}
      </BlockStack>
    </BlockStack>
  );
}

// ── Queue Tab (unified proposals + drafts) ─────────────────────────────────

function QueueTab({
  authFetch,
  active,
}: {
  authFetch: ReturnType<typeof useAuthFetch>;
  active: boolean;
}) {
  const router = useRouter();
  const [allProposals, setAllProposals] = useState<ContentProposal[]>(() => getCache<ContentProposal[]>("/api/content-pilot/proposals") ?? []);
  const [generating, setGenerating] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [loading, setLoading] = useState(() => !getCache("/api/content-pilot/proposals"));
  const [error, setError] = useState<string | null>(null);
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());
  const [rejectingIds, setRejectingIds] = useState<Set<string>>(new Set());
  const [generatingDraftIds, setGeneratingDraftIds] = useState<Set<string>>(new Set());
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  // Accordion expand + draft content cache
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedFullIds, setExpandedFullIds] = useState<Set<string>>(new Set());
  const [draftCache, setDraftCache] = useState<Record<string, Record<string, unknown> | null>>({});
  const [loadingDraftId, setLoadingDraftId] = useState<string | null>(null);
  // Search & filter
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | "pending" | "approved" | "generating" | "ready" | "scheduled" | "published" | "failed" | "rejected">("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sortKey, setSortKey] = useState<"priority" | "createdAt" | "impact">("priority");
  // Bulk
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActing, setBulkActing] = useState(false);
  const [confirmPublishAll, setConfirmPublishAll] = useState(false);
  const [confirmGenerateAll, setConfirmGenerateAll] = useState(false);
  // Reject
  const [pendingRejectId, setPendingRejectId] = useState<string | null>(null);
  const [pendingRejectNote, setPendingRejectNote] = useState("");
  // Publish success feedback
  const [lastPublishedTitle, setLastPublishedTitle] = useState<string | null>(null);
  // Generate proposals feedback
  const [lastGeneratedCount, setLastGeneratedCount] = useState<number | null>(null);
  // Clone
  const [cloningIds, setCloningIds] = useState<Set<string>>(new Set());
  const [confirmCloneId, setConfirmCloneId] = useState<string | null>(null);
  // Bulk publish modal
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishReviewChecked, setPublishReviewChecked] = useState(false);
  const [publishCandidates, setPublishCandidates] = useState<ContentProposal[]>([]);
  // Schedule inline picker
  const [scheduleOpenId, setScheduleOpenId] = useState<string | null>(null);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, string>>({});

  // Stage classification: maps each proposal to a simple pipeline stage for filtering/display
  const getStage = (p: ContentProposal): "pending" | "approved" | "generating" | "ready" | "scheduled" | "published" | "failed" | "rejected" => {
    if (p.status === "rejected") return "rejected";
    if (p.status === "pending") return "pending";
    if (p.draftStatus === "published") return "published";
    if (p.draftStatus === "ready" && p.scheduledPublishAt) return "scheduled";
    if (p.draftStatus === "ready") return "ready";
    if (p.draftStatus === "generating") return "generating";
    if (p.draftStatus === "failed") return "failed";
    return "approved";
  };

  const pendingCount = allProposals.filter((p) => p.status === "pending").length;
  const approvedCount = allProposals.filter((p) => p.status === "approved" && !p.draftStatus).length;
  const generatingCount = allProposals.filter((p) => p.draftStatus === "generating").length;
  const readyCount = allProposals.filter((p) => p.draftStatus === "ready" && !p.scheduledPublishAt).length;
  const scheduledCount = allProposals.filter((p) => p.draftStatus === "ready" && p.scheduledPublishAt).length;
  const publishedCount = allProposals.filter((p) => p.draftStatus === "published").length;
  const failedCount = allProposals.filter((p) => p.draftStatus === "failed").length;
  const rejectedCount = allProposals.filter((p) => p.status === "rejected").length;

  const proposals = allProposals
    .filter((p) => stageFilter === "rejected" ? p.status === "rejected" : p.status !== "rejected")
    .filter((p) => {
      if (stageFilter === "all") return true;
      return getStage(p) === stageFilter;
    })
    .filter((p) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    })
    .filter((p) => typeFilter === "all" || p.proposalType === typeFilter)
    .filter((p) => priorityFilter === "all" || p.priority === priorityFilter)
    .sort((a, b) => {
      if (sortKey === "priority") {
        const order: Record<string, number> = { P1: 0, P2: 1, P3: 2 };
        return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
      }
      if (sortKey === "impact") {
        const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return (order[a.impact?.toLowerCase()] ?? 3) - (order[b.impact?.toLowerCase()] ?? 3);
      }
      // createdAt — newest first
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  // In-flight guard: only the most recent loadProposals call may commit its
  // result, so an interleaved poll + manual refresh can't clobber each other.
  const loadSeqRef = useRef(0);
  const loadProposals = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const seq = ++loadSeqRef.current;
    if (!silent) setLoading(true);
    try {
      const res = await authFetch("/api/content-pilot/proposals");
      if (seq !== loadSeqRef.current) return; // a newer request superseded this one
      if (!res.ok) {
        // Read the body as text first so a non-JSON error page (e.g. an auth/SSO
        // redirect or a hosting error page) yields a useful message instead of a
        // cryptic "Unexpected token '<'" JSON-parse error.
        let msg = `Failed to load proposals (HTTP ${res.status})`;
        try {
          const body = await res.text();
          try {
            const parsed = JSON.parse(body) as { error?: string };
            if (parsed?.error) msg = parsed.error;
          } catch {
            msg = `Failed to load proposals (HTTP ${res.status}) — the server returned a non-JSON response. You may be signed out, or the API is unavailable.`;
          }
        } catch { /* body unreadable — keep status-only message */ }
        setError(msg);
        return;
      }
      let d: { proposals?: ContentProposal[] };
      try {
        d = (await res.json()) as { proposals?: ContentProposal[] };
      } catch {
        setError(`Loaded but could not parse the response (HTTP ${res.status}) — the server returned non-JSON. You may be signed out, or the API is unavailable.`);
        return;
      }
      if (seq !== loadSeqRef.current) return;
      setCache("/api/content-pilot/proposals", d.proposals ?? []);
      setAllProposals(d.proposals ?? []);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(`Failed to load: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (!silent && seq === loadSeqRef.current) setLoading(false);
    }
  }, [authFetch]);

  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (active && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadProposals();
    }
  }, [active, loadProposals]);

  // Poll while any draft is generating
  const generatingRef = useRef(false);
  useEffect(() => {
    generatingRef.current = allProposals.some((p) => p.draftStatus === "generating");
  }, [allProposals]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (generatingRef.current) loadProposals({ silent: true });
    }, 4000);
    return () => clearInterval(t);
  }, [active, loadProposals]);

  const generate = async () => {
    setConfirmGenerate(false);
    setGenerating(true);
    setError(null);
    try {
      const res = await authFetch("/api/content-pilot/proposals/generate", { method: "POST" });
      const d = await safeJson(res);
      if (!res.ok) { setError((d.error as string) ?? "Generation failed"); }
      else {
        const result = d as { created?: number };
        setLastGeneratedCount(result.created ?? 0);
        setStageFilter("pending");
        await loadProposals();
      }
    } catch (e) { setError(String(e)); }
    finally { setGenerating(false); }
  };

  const approve = async (id: string, { generate: gen = true }: { generate?: boolean } = {}) => {
    setApprovingIds((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      if (!res.ok) { const d = await safeJson(res); setError((d.error as string) ?? "Approve failed"); return; }
      setAllProposals((prev) => prev.map((p) => p.id === id ? { ...p, status: "approved", ...(gen ? { draftStatus: "generating" } : {}) } : p));
      if (gen) void generateDraft(id, { navigate: false });
    } catch (e) { setError(String(e)); }
    finally { setApprovingIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); }
  };

  const reject = async (id: string, note?: string) => {
    setRejectingIds((prev) => new Set(prev).add(id));
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/reject`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewNote: note ?? null }),
      });
      if (!res.ok) { const d = await safeJson(res); setError((d.error as string) ?? "Reject failed"); }
      else {
        setAllProposals((prev) => prev.map((p) => p.id === id ? { ...p, status: "rejected", reviewNote: note ?? null } : p));
        setPendingRejectId(null); setPendingRejectNote("");
        setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      }
    } catch (e) { setError(String(e)); }
    finally { setRejectingIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); }
  };

  const generateDraft = async (id: string, { navigate = false, reload = true }: { navigate?: boolean; reload?: boolean } = {}) => {
    setGeneratingDraftIds((prev) => new Set(prev).add(id));
    // Optimistic: show "Generating…" badge immediately
    setAllProposals((prev) => prev.map((p) => p.id === id ? { ...p, draftStatus: "generating" } : p));
    setError(null);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/generate-draft`, { method: "POST" });
      const d = await safeJson(res);
      if (!res.ok) {
        const message = draftFailureMessage(d);
        setError(message);
        setAllProposals((prev) => prev.map((p) => p.id === id ? { ...p, draftStatus: "failed", draftError: message } : p));
      } else if (navigate) { router.push(withShopifyContextUrl(`/content-pilot/draft/${id}`)); }
      else if (reload) { await loadProposals(); }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setAllProposals((prev) => prev.map((p) => p.id === id ? { ...p, draftStatus: "failed", draftError: message } : p));
    }
    finally { setGeneratingDraftIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); }
  };

  const publishDraft = async (id: string) => {
    setPublishingIds((prev) => new Set(prev).add(id));
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/publish`, { method: "POST" });
      if (!res.ok) { const d = await safeJson(res); setError((d.error as string) ?? "Publish failed"); return false; }
      // Optimistic update then confirm from server
      const title = allProposals.find(p => p.id === id)?.title ?? "Article";
      setAllProposals((prev) => prev.map((p) => p.id === id ? { ...p, draftStatus: "published" } : p));
      setLastPublishedTitle(title);
      setTimeout(() => setLastPublishedTitle(null), 4000);
      void loadProposals({ silent: true });
      return true;
    } catch (e) { setError(String(e)); return false; }
    finally { setPublishingIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); }
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (draftCache[id] !== undefined) return;
    setLoadingDraftId(id);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}`);
      const d = await safeJson(res);
      setDraftCache((prev) => ({ ...prev, [id]: ((d.proposal as Record<string,unknown>)?.draftContent ?? null) as Record<string, unknown> | null }));
    } catch { setDraftCache((prev) => ({ ...prev, [id]: null })); }
    finally { setLoadingDraftId(null); }
  };

  const bulkApproveAndGenerate = async () => {
    setBulkActing(true);
    setError(null);
    const ids = Array.from(selectedIds).filter((id) => allProposals.find((p) => p.id === id)?.status === "pending");
    setSelectedIds(new Set());
    const CONCURRENCY = 3;
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        if (id === undefined) break;
        await approve(id, { generate: false });
        await generateDraft(id, { navigate: false, reload: false });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    await loadProposals();
    setBulkActing(false);
  };

  function openBulkPublishModal() {
    const candidates = proposals.filter(
      (p) => getStage(p) === "ready" && !p.scheduledPublishAt
    );
    if (candidates.length === 0) return;
    setPublishCandidates(candidates);
    setPublishReviewChecked(false);
    setShowPublishModal(true);
  }

  const bulkPublishReady = async () => {
    setConfirmPublishAll(false);
    setBulkActing(true);
    setError(null);
    const ids = allProposals.filter((p) => p.draftStatus === "ready" && !p.scheduledPublishAt).map((p) => p.id);
    const CONCURRENCY = 2;
    let cursor = 0;
    let published = 0;
    let failed = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        if (id === undefined) break;
        if (await publishDraft(id)) published++;
        else failed++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    await loadProposals();
    if (failed > 0) {
      setError(`Published ${published}; ${failed} failed. Failed items were left in the queue with their error details.`);
    }
    setBulkActing(false);
  };

  const runBulkGenerate = async (ids: string[]) => {
    setBulkActing(true);
    setError(null);
    setSelectedIds(new Set());
    const CONCURRENCY = 3;
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        if (id === undefined) break;
        await generateDraft(id, { navigate: false, reload: false });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    await loadProposals();
    setBulkActing(false);
  };

  // Header button: generate ALL approved-no-draft (regardless of filter/selection)
  const generateAllDrafts = async () => {
    const ids = allProposals
      .filter((p) => p.status === "approved" && !p.draftStatus)
      .map((p) => p.id);
    await runBulkGenerate(ids);
  };

  // Bulk bar button: generate only the selected approved-no-draft items
  const bulkGenerateSelectedDrafts = async () => {
    const ids = Array.from(selectedIds).filter((id) => {
      const p = allProposals.find((p) => p.id === id);
      return p?.status === "approved" && !p.draftStatus;
    });
    await runBulkGenerate(ids);
  };

  const saveScheduleFromQueue = async (id: string, value: string, clear = false) => {
    let scheduledPublishAt: string | null = null;
    if (!clear && value) {
      const d = new Date(value);
      if (isNaN(d.getTime())) { setError("Invalid date/time"); return; }
      scheduledPublishAt = d.toISOString();
    }
    setSchedulingId(id);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledPublishAt }),
      });
      if (!res.ok) { const d = await safeJson(res); setError((d.error as string) ?? "Schedule failed"); return; }
      if (clear) setScheduleInputs((prev) => ({ ...prev, [id]: "" }));
      setScheduleOpenId(null);
      await loadProposals({ silent: true });
    } catch (e) { setError(String(e)); }
    finally { setSchedulingId(null); }
  };

  const reopen = async (id: string) => {
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/reopen`, { method: "POST" });
      if (!res.ok) {
        const d = await safeJson(res);
        setError((d.error as string) ?? "Failed to re-open proposal");
        return;
      }
      setAllProposals((prev) => prev.map((p) => p.id === id ? { ...p, status: "pending" } : p));
      await loadProposals();
    } catch (e) {
      setError(String(e));
    }
  };

  const bulkApproveOnly = async () => {
    setBulkActing(true);
    setError(null);
    const ids = Array.from(selectedIds).filter((id) => allProposals.find((p) => p.id === id)?.status === "pending");
    setSelectedIds(new Set());
    const CONCURRENCY = 3;
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        if (id === undefined) break;
        await approve(id, { generate: false });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    await loadProposals();
    setBulkActing(false);
  };

  const bulkReject = async () => {
    setBulkActing(true);
    setError(null);
    const ids = Array.from(selectedIds).filter((id) => allProposals.find((p) => p.id === id)?.status === "pending");
    for (const id of ids) await reject(id);
    setSelectedIds(new Set());
    await loadProposals();
    setBulkActing(false);
  };

  const cloneProposal = async (id: string) => {
    setCloningIds((prev) => new Set(prev).add(id));
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/clone`, { method: "POST" });
      if (!res.ok) { const d = await safeJson(res); setError((d.error as string) ?? "Clone failed"); return; }
      await loadProposals();
    } catch (e) { setError(String(e)); }
    finally { setCloningIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); }
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const pendingInView = proposals.filter((p) => p.status === "pending");
  const approvedNoDraftInView = proposals.filter((p) => p.status === "approved" && !p.draftStatus);
  const selectableInView = [...pendingInView, ...approvedNoDraftInView];
  const allSelectableSelected = selectableInView.length > 0 && selectableInView.every((p) => selectedIds.has(p.id));
  const toggleSelectAll = () =>
    setSelectedIds(allSelectableSelected ? new Set() : new Set(selectableInView.map((p) => p.id)));

  const pendingSelectedCount = Array.from(selectedIds).filter(
    (id) => allProposals.find((p) => p.id === id)?.status === "pending"
  ).length;
  const approvedSelectedCount = Array.from(selectedIds).filter((id) => {
    const p = allProposals.find((p) => p.id === id);
    return p?.status === "approved" && !p.draftStatus;
  }).length;

  const typeOptions = [
    { label: "All types", value: "all" },
    { label: "SEO fix", value: "seo-fix" },
    { label: "Internal link", value: "internal-link" },
    { label: "New content", value: "new-content" },
    { label: "Content refresh", value: "content-refresh" },
    { label: "Thin content", value: "thin-content" },
  ];
  const priorityOptions = [
    { label: "All priorities", value: "all" },
    { label: "P1 (Critical)", value: "P1" },
    { label: "P2 (High)", value: "P2" },
    { label: "P3 (Normal)", value: "P3" },
  ];

  const stagePills: { key: typeof stageFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: allProposals.filter((p) => p.status !== "rejected").length },
    { key: "pending", label: "Pending", count: pendingCount },
    { key: "approved", label: "Approved", count: approvedCount },
    { key: "generating", label: "Generating", count: generatingCount },
    { key: "ready", label: "Ready", count: readyCount },
    { key: "scheduled", label: "Scheduled", count: scheduledCount },
    { key: "published", label: "Published", count: publishedCount },
    { key: "failed", label: "Failed", count: failedCount },
    { key: "rejected", label: "Rejected", count: rejectedCount },
  ];

  function StageBadge({ proposal }: { proposal: ContentProposal }) {
    const stage = getStage(proposal);
    if (stage === "pending") return <Badge tone="attention">Pending</Badge>;
    if (stage === "approved") return <Badge tone="info">Approved</Badge>;
    if (stage === "generating") return <Badge tone="attention">Generating…</Badge>;
    if (stage === "ready") return <Badge tone="success">Ready</Badge>;
    if (stage === "scheduled") return <Badge tone="info">Scheduled</Badge>;
    if (stage === "published") return <Badge tone="success">Published</Badge>;
    if (stage === "failed") return <Badge tone="critical">Failed</Badge>;
    return <Badge>—</Badge>;
  }

  function RowAction({ p }: { p: ContentProposal }) {
    const stage = getStage(p);
    if (stage === "pending") {
      return (
        <InlineStack gap="200">
          <Button size="slim" variant="primary"
            loading={approvingIds.has(p.id)} disabled={bulkActing || rejectingIds.has(p.id)}
            onClick={() => approve(p.id, { generate: true })}>
            Approve &amp; Generate
          </Button>
          <Button size="slim"
            loading={approvingIds.has(p.id)} disabled={bulkActing || rejectingIds.has(p.id)}
            onClick={() => approve(p.id, { generate: false })}>
            Approve
          </Button>
          <Button size="slim" tone="critical"
            loading={rejectingIds.has(p.id)} disabled={bulkActing || approvingIds.has(p.id)}
            onClick={() => {
              if (pendingRejectId === p.id) { setPendingRejectId(null); setPendingRejectNote(""); }
              else { setPendingRejectId(p.id); setPendingRejectNote(""); }
            }}>
            {pendingRejectId === p.id ? "Cancel" : "Reject"}
          </Button>
        </InlineStack>
      );
    }
    if (stage === "approved") {
      return (
        <Button size="slim"
          loading={generatingDraftIds.has(p.id)}
          onClick={() => generateDraft(p.id)}>
          Generate Draft
        </Button>
      );
    }
    if (stage === "generating") {
      return <Button size="slim" disabled loading>Generating…</Button>;
    }
    if (stage === "ready") {
      return (
        <InlineStack gap="200">
          <Button size="slim" variant="primary"
            loading={publishingIds.has(p.id)} disabled={bulkActing}
            onClick={() => publishDraft(p.id)}>
            Publish
          </Button>
          <Button size="slim" onClick={() => toggleExpand(p.id)}>
            {expandedId === p.id ? "Collapse" : "Preview"}
          </Button>
          <Button size="slim" onClick={() => router.push(withShopifyContextUrl(`/content-pilot/draft/${p.id}`))}>
            Edit / Schedule
          </Button>
        </InlineStack>
      );
    }
    if (stage === "scheduled") {
      return (
        <InlineStack gap="200">
          <Button size="slim" variant="primary"
            loading={publishingIds.has(p.id)} disabled={bulkActing}
            onClick={() => publishDraft(p.id)}>
            Publish Now
          </Button>
          <Button size="slim" onClick={() => toggleExpand(p.id)}>
            {expandedId === p.id ? "Collapse" : "Preview"}
          </Button>
          <Button size="slim" onClick={() => router.push(withShopifyContextUrl(`/content-pilot/draft/${p.id}`))}>
            Edit / Schedule
          </Button>
        </InlineStack>
      );
    }
    if (stage === "failed") {
      return (
        <InlineStack gap="200">
          <Button size="slim" loading={generatingDraftIds.has(p.id)} onClick={() => generateDraft(p.id)}>
            Retry
          </Button>
          <Button size="slim" onClick={() => router.push(withShopifyContextUrl(`/content-pilot/draft/${p.id}`))}>
            View
          </Button>
        </InlineStack>
      );
    }
    if (stage === "published") {
      return (
        <BlockStack gap="200">
          <InlineStack gap="200">
            <Button size="slim" onClick={() => toggleExpand(p.id)}>
              {expandedId === p.id ? "Collapse" : "Preview"}
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
        <Button size="slim" onClick={() => reopen(p.id)}>
          Re-open
        </Button>
      );
    }
    return null;
  }

  return (
    <BlockStack gap="400">
      {error && <Banner tone="critical" onDismiss={() => setError(null)}>{error}</Banner>}
      {lastPublishedTitle && (
        <Banner tone="success" onDismiss={() => setLastPublishedTitle(null)}>
          {`"${lastPublishedTitle}" published to Shopify.`}
        </Banner>
      )}
      {lastGeneratedCount !== null && (
        <Banner tone={lastGeneratedCount === 0 ? "warning" : "success"} onDismiss={() => setLastGeneratedCount(null)}>
          {lastGeneratedCount === 0
            ? "No new proposals generated — all opportunities are already in the queue."
            : `Generated ${lastGeneratedCount} new proposal${lastGeneratedCount === 1 ? "" : "s"}.`}
        </Banner>
      )}

      {confirmGenerate && (
        <Banner tone="warning" title={`This will delete all ${pendingCount} pending proposals and generate a fresh batch.`}>
          <InlineStack gap="200">
            <Button size="slim" variant="primary" onClick={generate} loading={generating}>Confirm</Button>
            <Button size="slim" onClick={() => setConfirmGenerate(false)}>Cancel</Button>
          </InlineStack>
        </Banner>
      )}

      {/* Header */}
      <InlineStack align="space-between" blockAlign="center" wrap>
        <Text variant="headingMd" as="h2">Content Queue</Text>
        <InlineStack gap="200" wrap>
          {approvedCount > 0 && (
            confirmGenerateAll ? (
              <InlineStack gap="200" wrap blockAlign="center">
                <Text as="p" tone="subdued">{`Generate all ${approvedCount} drafts?`}</Text>
                <Button size="slim" variant="primary" loading={bulkActing} onClick={() => { setConfirmGenerateAll(false); generateAllDrafts(); }}>Confirm</Button>
                <Button size="slim" onClick={() => setConfirmGenerateAll(false)}>Cancel</Button>
              </InlineStack>
            ) : (
              <Button size="slim" loading={bulkActing} onClick={() => setConfirmGenerateAll(true)}>
                {`Generate All Drafts (${approvedCount})`}
              </Button>
            )
          )}
          {readyCount > 0 && (
            confirmPublishAll ? (
              <InlineStack gap="200" wrap blockAlign="center">
                <Text as="p" tone="subdued">{`Publish all ${readyCount}?`}</Text>
                <Button size="slim" variant="primary" tone="critical" loading={bulkActing} onClick={() => { setConfirmPublishAll(false); openBulkPublishModal(); }}>Confirm</Button>
                <Button size="slim" onClick={() => setConfirmPublishAll(false)}>Cancel</Button>
              </InlineStack>
            ) : (
              <Button size="slim" variant="primary" loading={bulkActing} onClick={() => setConfirmPublishAll(true)}>
                {`Publish All Ready (${readyCount})`}
              </Button>
            )
          )}
          <Button size="slim" onClick={() => loadProposals()} loading={loading} disabled={generating}>Refresh</Button>
{!confirmGenerate && (
            <Button variant="primary" onClick={() => setConfirmGenerate(true)} loading={generating} disabled={bulkActing}>
              Generate Proposals
            </Button>
          )}
        </InlineStack>
      </InlineStack>

      {/* Stage filter pills */}
      <InlineStack gap="200">
        {stagePills.filter((s) => s.count > 0 || s.key === "all").map(({ key, label, count }) => (
          <Button
            key={key}
            variant={stageFilter === key ? "primary" : "secondary"}
            size="slim"
            onClick={() => { setStageFilter(key); setSelectedIds(new Set()); setPendingRejectId(null); }}
          >
            {`${label}${key !== "all" ? ` (${loading ? "…" : count})` : ""}`}
          </Button>
        ))}
      </InlineStack>

      {/* Search & filters */}
      <InlineStack gap="200" blockAlign="end" wrap>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <TextField label="Search proposals" labelHidden placeholder="Search…" value={searchQuery} onChange={setSearchQuery}
            autoComplete="off" clearButton onClearButtonClick={() => setSearchQuery("")} />
        </div>
        <div style={{ minWidth: 140 }}>
          <Select label="Filter by type" labelHidden options={typeOptions} value={typeFilter} onChange={setTypeFilter} />
        </div>
        <div style={{ minWidth: 130 }}>
          <Select label="Filter by priority" labelHidden options={priorityOptions} value={priorityFilter} onChange={setPriorityFilter} />
        </div>
        <div style={{ minWidth: 130 }}>
          <Select
            label="Sort by"
            labelHidden
            options={[
              { label: "Priority", value: "priority" },
              { label: "Newest", value: "createdAt" },
              { label: "Impact", value: "impact" },
            ]}
            value={sortKey}
            onChange={(v) => setSortKey(v as typeof sortKey)}
          />
        </div>
      </InlineStack>

      {/* Bulk action bar */}
      {selectableInView.length > 0 && (
        <Card>
          <InlineStack align="space-between" blockAlign="center" wrap>
            <Checkbox
              label={allSelectableSelected ? "Deselect all" : `Select all (${selectableInView.length})`}
              checked={allSelectableSelected}
              onChange={toggleSelectAll}
            />
            {selectedIds.size > 0 && (
              <InlineStack gap="200" wrap>
                {pendingSelectedCount > 0 && (
                  <Button size="slim" variant="primary" loading={bulkActing} onClick={bulkApproveAndGenerate}>
                    {`Approve & Generate (${pendingSelectedCount})`}
                  </Button>
                )}
                {pendingSelectedCount > 0 && (
                  <Button size="slim" loading={bulkActing} onClick={bulkApproveOnly}>
                    {`Approve Only (${pendingSelectedCount})`}
                  </Button>
                )}
                {approvedSelectedCount > 0 && (
                  <Button size="slim" variant="primary" loading={bulkActing} onClick={bulkGenerateSelectedDrafts}>
                    {`Generate Drafts (${approvedSelectedCount})`}
                  </Button>
                )}
                {pendingSelectedCount > 0 && (
                  <Button size="slim" tone="critical" loading={bulkActing} onClick={bulkReject}>
                    Reject
                  </Button>
                )}
              </InlineStack>
            )}
          </InlineStack>
        </Card>
      )}

      {loading ? (
        <InlineStack align="center"><Spinner size="small" /></InlineStack>
      ) : proposals.length === 0 ? (
        <BlockStack gap="200">
          <Text as="p" tone="subdued">
            No items{stageFilter !== "all" ? ` in "${stageFilter}"` : ""}{searchQuery ? ` matching "${searchQuery}"` : ""}.
          </Text>
          {stageFilter === "all" && !searchQuery && (
            <Text as="p" tone="subdued">Click &quot;Generate Proposals&quot; to analyse your content.</Text>
          )}
        </BlockStack>
      ) : (
        <BlockStack gap="300">
          {proposals.map((p) => (
            <Card key={p.id}>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="start" wrap>
                  <InlineStack gap="200" blockAlign="center" wrap>
                    {(p.status === "pending" || (p.status === "approved" && !p.draftStatus)) && (
                      <Checkbox label="Select proposal" labelHidden checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} />
                    )}
                    <PriorityBadge priority={p.priority} />
                    <StageBadge proposal={p} />
                    <Badge>{p.proposalType}</Badge>
                    <Text variant="headingSm" as="h3">{p.title}</Text>
                  </InlineStack>
                  <ImpactBadge level={p.impact} />
                  {getStage(p) === "published" && (
                    <SeoDeltaBadge before={p.baselineSeoScore} after={p.followUpSeoScore} />
                  )}
                </InlineStack>

                <Text as="p" tone="subdued">{p.description}</Text>

                {getStage(p) === "failed" && p.draftError && (
                  <Banner tone="critical" title="Draft generation failed">
                    <p>{p.draftError}</p>
                  </Banner>
                )}

                {p.proposalType === "new-content" && !p.articleHandle && (
                  <Text as="p" tone="subdued" variant="bodySm">Will create a new article in your blog.</Text>
                )}

                <ProposedChangeSummary proposalType={p.proposalType} proposedState={p.proposedState} />

                <RowAction p={p} />

                <InlineStack>
                  {confirmCloneId === p.id ? (
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="p" tone="subdued" variant="bodySm">Duplicate this proposal?</Text>
                      <Button size="slim" loading={cloningIds.has(p.id)} onClick={async () => { await cloneProposal(p.id); setConfirmCloneId(null); }}>Confirm</Button>
                      <Button size="slim" onClick={() => setConfirmCloneId(null)}>Cancel</Button>
                    </InlineStack>
                  ) : (
                    <Button size="slim" variant="plain" onClick={() => setConfirmCloneId(p.id)}>
                      Duplicate
                    </Button>
                  )}
                </InlineStack>

                {p.scheduledPublishAt && (
                  <Text as="p" tone="subdued" variant="bodySm">Scheduled: {new Date(p.scheduledPublishAt).toLocaleString()}</Text>
                )}

                {(getStage(p) === "ready" || getStage(p) === "scheduled") && (
                  <Box>
                    {scheduleOpenId !== p.id ? (
                      <Button size="slim" variant="plain" onClick={() => {
                        setScheduleOpenId(p.id);
                        setScheduleInputs((prev) => ({
                          ...prev,
                          [p.id]: p.scheduledPublishAt ? (() => {
                            const d = new Date(p.scheduledPublishAt!);
                            const pad = (n: number) => String(n).padStart(2, "0");
                            return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                          })() : (prev[p.id] ?? ""),
                        }));
                      }}>
                        {p.scheduledPublishAt ? "Edit schedule" : "Schedule"}
                      </Button>
                    ) : (
                      <InlineStack gap="200" blockAlign="end">
                        <div style={{ minWidth: 200 }}>
                          <TextField
                            label="Publish at"
                            type="datetime-local"
                            value={scheduleInputs[p.id] ?? ""}
                            onChange={(v) => setScheduleInputs((prev) => ({ ...prev, [p.id]: v }))}
                            autoComplete="off"
                          />
                          <Text as="p" tone="subdued" variant="bodySm">
                            {`Times are in your browser's local timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}
                          </Text>
                        </div>
                        <Button size="slim" loading={schedulingId === p.id} disabled={!scheduleInputs[p.id]}
                          onClick={() => saveScheduleFromQueue(p.id, scheduleInputs[p.id] ?? "")}>
                          {p.scheduledPublishAt ? "Update" : "Set"}
                        </Button>
                        {p.scheduledPublishAt && (
                          <Button size="slim" tone="critical" loading={schedulingId === p.id}
                            onClick={() => saveScheduleFromQueue(p.id, "", true)}>
                            Clear
                          </Button>
                        )}
                        <Button size="slim" onClick={() => setScheduleOpenId(null)}>Cancel</Button>
                      </InlineStack>
                    )}
                  </Box>
                )}

                {/* Inline draft accordion */}
                {expandedId === p.id && (
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    {loadingDraftId === p.id ? (
                      <InlineStack align="center"><Spinner size="small" /></InlineStack>
                    ) : (() => {
                      const draft = draftCache[p.id];
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
                                <Button size="slim" onClick={() => setExpandedFullIds((prev) => { const n = new Set(prev); expandedFullIds.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}>
                                  {expandedFullIds.has(p.id) ? "Collapse" : "Expand"}
                                </Button>
                              </InlineStack>
                              <Box background="bg-surface" padding="300" borderRadius="100">
                                <div
                                  style={{ fontSize: "13px", lineHeight: "1.6", maxHeight: expandedFullIds.has(p.id) ? "none" : "400px", overflowY: expandedFullIds.has(p.id) ? "visible" : "auto" }}
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
                      const isFull = expandedFullIds.has(p.id);
                      return (
                        <BlockStack gap="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text variant="headingSm" as="h4">Updated Body</Text>
                            <Button size="slim" onClick={() => setExpandedFullIds((prev) => { const n = new Set(prev); isFull ? n.delete(p.id) : n.add(p.id); return n; })}>
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
                {p.status === "pending" && pendingRejectId === p.id && (
                  <BlockStack gap="200">
                    <Divider />
                    <TextField
                      label="Rejection reason (optional)"
                      value={pendingRejectNote}
                      onChange={setPendingRejectNote}
                      multiline={2}
                      autoComplete="off"
                      placeholder="e.g. Not aligned with current content strategy"
                    />
                    <InlineStack gap="200">
                      <Button size="slim" variant="primary" tone="critical"
                        loading={rejectingIds.has(p.id)}
                        onClick={() => reject(p.id, pendingRejectNote || undefined)}>
                        Confirm Reject
                      </Button>
                      <Button size="slim" onClick={() => { setPendingRejectId(null); setPendingRejectNote(""); }}>
                        Cancel
                      </Button>
                    </InlineStack>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          ))}
        </BlockStack>
      )}

      <Modal
        open={showPublishModal}
        onClose={() => setShowPublishModal(false)}
        title={`Publish ${publishCandidates.length} article${publishCandidates.length === 1 ? "" : "s"}`}
        primaryAction={{
          content: "Publish All",
          disabled: !publishReviewChecked,
          loading: bulkActing,
          onAction: () => {
            setShowPublishModal(false);
            bulkPublishReady();
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowPublishModal(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" tone="subdued">Review each article before publishing:</Text>
            {publishCandidates.map((p) => {
              const wc = countWordsFromHtml(p.bodyHtml ?? "");
              return (
                <InlineStack key={p.id} align="space-between" blockAlign="center">
                  <Text as="p">{p.title}</Text>
                  <Badge tone={wc >= 300 ? "success" : wc >= 100 ? "warning" : "critical"}>
                    {`${wc} words`}
                  </Badge>
                </InlineStack>
              );
            })}
            <Divider />
            <Checkbox
              label="I have reviewed these drafts and they are ready to publish"
              checked={publishReviewChecked}
              onChange={setPublishReviewChecked}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}


// ── Brief Tab ──────────────────────────────────────────────────────────────

function BriefTab({
  authFetch,
  clusters,
}: {
  authFetch: ReturnType<typeof useAuthFetch>;
  clusters: TopicCluster[];
}) {
  const [topic, setTopic] = useState("");
  const [brief, setBrief] = useState<string | null>(null);
  const [briefTopic, setBriefTopic] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposalCreated, setProposalCreated] = useState(false);
  const [blogs, setBlogs] = useState<Array<{id: string; title: string; handle: string}>>([]);
  const [selectedBlog, setSelectedBlog] = useState("");

  useEffect(() => {
    authFetch("/api/content-pilot/blogs")
      .then(async (r) => {
        if (!r.ok) {
          const d = await safeJson(r);
          console.error("Failed to load blogs:", d.error ?? `HTTP ${r.status}`);
          return { blogs: [] };
        }
        return await safeJson(r) as { blogs?: Array<{id: string; title: string; handle: string}> };
      })
      .then((d: { blogs?: Array<{id: string; title: string; handle: string}> }) => setBlogs(d.blogs ?? []))
      .catch((e) => console.error("Failed to load blogs:", e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const topGaps = clusters.slice().sort((a, b) => b.gapScore - a.gapScore).slice(0, 5);

  const generate = useCallback(
    async (t: string) => {
      const resolved = t.trim();
      if (!resolved) return;
      setGenerating(true);
      setError(null);
      setProposalCreated(false);
      setBrief(null);
      setBriefTopic(null);
      try {
        const res = await authFetch("/api/content-pilot/brief", {
          method: "POST",
          body: JSON.stringify({ topic: resolved }),
        });
        const d = await safeJson(res);
        if (!res.ok) {
          setError(draftFailureMessage(d, "Brief generation failed"));
        } else {
          setBrief(d.brief as string);
          setBriefTopic(resolved);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setGenerating(false);
        setActiveChip(null);
      }
    },
    [authFetch]
  );

  const createProposal = async () => {
    const proposalTopic = (briefTopic ?? topic).trim();
    if (!proposalTopic || !brief) {
      setError("Generate a brief before creating a proposal.");
      return;
    }
    setCreatingProposal(true);
    setError(null);
    try {
      const res = await authFetch("/api/content-pilot/proposals/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: proposalTopic, brief, blogHandle: selectedBlog || null }),
      });
      const d = await safeJson(res);
      if (!res.ok) { setError((d.error as string) ?? "Failed to create proposal"); }
      else { setBrief(null); setBriefTopic(null); setTopic(""); setError(null); setProposalCreated(true); }
    } catch (e) { setError(String(e)); }
    finally { setCreatingProposal(false); }
  };

  const handleChipClick = (chipTopic: string) => {
    setTopic(chipTopic);
    setActiveChip(chipTopic);
    generate(chipTopic);
  };

  return (
    <BlockStack gap="400">
      {error && (
        <Banner tone="critical" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {proposalCreated && (
        <Banner tone="success" onDismiss={() => setProposalCreated(false)}>
          Proposal created. Switch to the <strong>Queue</strong> tab to review and generate it.
        </Banner>
      )}

      <Banner tone="info">
        Generate a brief, review it, then create a Queue proposal. The Queue tab is where drafts are generated and published.
      </Banner>

      {topGaps.length > 0 && (
        <Card>
          <BlockStack gap="200">
            <Text variant="headingSm" as="h3" tone="subdued">
              Top content gaps — click to generate brief
            </Text>
            <InlineStack gap="200" wrap>
              {topGaps.map((c) => {
                const isActive = activeChip === c.topic;
                return (
                  <Button
                    key={c.topic}
                    size="slim"
                    variant={isActive ? "primary" : "secondary"}
                    loading={isActive && generating}
                    disabled={generating && !isActive}
                    onClick={() => handleChipClick(c.topic)}
                  >
                    {c.topic}
                  </Button>
                );
              })}
            </InlineStack>
          </BlockStack>
        </Card>
      )}

      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h2">
            Custom Topic
          </Text>
          {/* Fix #1 — restore description so user knows what they'll get */}
          <Text as="p" tone="subdued">
            Enter a topic or keyword to generate a structured content brief — target keyword,
            recommended structure, H2 suggestions, and word count target.
          </Text>
          <TextField
            label="Topic or keyword"
            value={topic}
            onChange={setTopic}
            placeholder="e.g. moringa benefits for digestion"
            autoComplete="off"
          />
          {blogs.length > 1 && (
            <Select
              label="Publish to blog"
              options={[
                { label: "Default blog", value: "" },
                ...blogs.map(b => ({ label: b.title, value: b.handle })),
              ]}
              value={selectedBlog}
              onChange={setSelectedBlog}
            />
          )}
          <InlineStack>
            <Button
              variant="primary"
              onClick={() => generate(topic)}
              loading={generating && !activeChip}
              disabled={!topic.trim() || generating}
            >
              Generate Brief
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>

      {brief && (
        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center" gap="200" wrap={false}>
              <Text variant="headingMd" as="h2">
                Content Brief
              </Text>
              {briefTopic && <Badge tone="info">{briefTopic}</Badge>}
            </InlineStack>
            <Banner tone="success">
              Brief generated. Create a proposal to send this topic to the Queue, then generate the draft from there.
            </Banner>
            <Box>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  fontSize: "14px",
                  lineHeight: "1.6",
                }}
              >
                {brief}
              </pre>
            </Box>
            <InlineStack gap="200">
              <Button size="slim" onClick={() => setBrief(null)}>
                Clear
              </Button>
              <Button variant="primary" onClick={createProposal} loading={creatingProposal} disabled={!brief || creatingProposal}>
                Create Queue Proposal
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function ContentPilotPage() {
  const authFetch = useAuthFetch();
  const [selectedTab, setSelectedTab] = useState(0);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t) {
      const n = parseInt(t, 10);
      if (Number.isFinite(n) && n >= 0 && n <= 2) setSelectedTab(n);
    }
  }, []);
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [clusters, setClusters] = useState<TopicCluster[]>([]);
  const [linkGraph, setLinkGraph] = useState<LinkGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [articlesError, setArticlesError] = useState(false); // Fix #3
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<{ indexed: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback((): Promise<void> => {
    setLoading(true);
    setArticlesError(false);

    const fetchJson = async (input: string, timeoutMs = 30000): Promise<unknown> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await authFetch(input, { signal: controller.signal });
        clearTimeout(timeoutId);
        const data = await safeJson(res);
        if (!res.ok) {
          console.error(`[content-pilot] ${input} returned ${res.status}:`, data);
          return null;
        }
        return data;
      } catch (err) {
        clearTimeout(timeoutId);
        const reason = controller.signal.aborted ? "timed out" : String(err);
        console.error(`[content-pilot] ${input} failed: ${reason}`);
        return null;
      }
    };

    return Promise.all([
      fetchJson("/api/content-pilot/articles"),
      fetchJson("/api/content-pilot/topic-clusters"),
      fetchJson("/api/content-pilot/link-graph"),
    ])
      .then(([a, c, g]) => {
        if (a && (a as Record<string, unknown>).articles) {
          setArticles((a as { articles: ArticleRow[]; total: number }).articles ?? []);
          setTotal((a as { articles: ArticleRow[]; total: number }).total ?? 0);
        } else if (a && (a as Record<string, unknown>).error) {
          setArticlesError(true);
          setError(`Articles: ${(a as { error: string }).error} — try refreshing.`);
        } else if (!a) {
          setArticlesError(true);
          setError("Articles timed out or failed — check the browser console and try refreshing.");
        }
        if (c) setClusters((c as { clusters: TopicCluster[] }).clusters ?? []);
        if (g) setLinkGraph(g as LinkGraphData);
        setLoading(false);
      })
      .catch((err) => {
        setError(`Overview load failed: ${err instanceof Error ? err.message : String(err)}`);
        setLoading(false);
      });
  }, [authFetch]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const runIndexer = useCallback(async () => {
    setIndexing(true);
    setError(null);
    setIndexResult(null);
    try {
      const res = await authFetch("/api/content-pilot/index", { method: "POST" });
      const d = await safeJson(res);
      if (!res.ok) {
        setError((d.error as string) ?? "Indexer failed");
      } else {
        setIndexResult({ indexed: d.indexed as number, skipped: d.skipped as number });
        setSelectedTab(0);
        await loadOverview();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setIndexing(false);
    }
  }, [authFetch, loadOverview]);

  const goodSeo = articles.filter((a) => a.seoScore >= 80).length;
  const criticalSeo = articles.filter((a) => a.seoScore < 50).length;

  const tabs = [
    { id: "overview", content: "Overview" },
    { id: "queue", content: "Queue" },
    { id: "brief", content: "Brief" },
  ];

  return (
    <Page
      title="Content Pilot"
      subtitle="Blog article SEO intelligence"
      primaryAction={{ content: "Run Indexer", onAction: runIndexer, loading: indexing }}
    >
      <Layout>
        {indexResult && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setIndexResult(null)}>
              Indexed {indexResult.indexed} articles, skipped {indexResult.skipped} unchanged.
            </Banner>
          </Layout.Section>
        )}
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineStack gap="400" wrap>
            <div style={{ flex: "1 1 180px", minWidth: 180 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">
                  Total Indexed
                </Text>
                <Text variant="heading2xl" as="p">
                  {loading ? "—" : total}
                </Text>
              </BlockStack>
            </Card>
            </div>
            <div style={{ flex: "1 1 180px", minWidth: 180 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">
                  SEO Score ≥80
                </Text>
                <Text variant="heading2xl" as="p">
                  {loading ? "—" : goodSeo}
                </Text>
              </BlockStack>
            </Card>
            </div>
            <div style={{ flex: "1 1 180px", minWidth: 180 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">
                  Critical (&lt;50)
                </Text>
                <Text variant="heading2xl" as="p">
                  {loading ? "—" : criticalSeo}
                </Text>
              </BlockStack>
            </Card>
            </div>
            <div style={{ flex: "1 1 180px", minWidth: 180 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued">
                  Orphan Articles
                </Text>
                <Text variant="heading2xl" as="p">
                  {loading ? "—" : (linkGraph?.orphanCount ?? "—")}
                </Text>
              </BlockStack>
            </Card>
            </div>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <Box padding="400">
                <div style={{ display: selectedTab === 0 ? undefined : "none" }}>
                  <OverviewTab
                    articles={articles}
                    clusters={clusters}
                    linkGraph={linkGraph}
                    loading={loading}
                    articlesError={articlesError}
                  />
                </div>
                <div style={{ display: selectedTab === 1 ? undefined : "none" }}>
                  <QueueTab authFetch={authFetch} active={selectedTab === 1} />
                </div>
                <div style={{ display: selectedTab === 2 ? undefined : "none" }}>
                  <BriefTab authFetch={authFetch} clusters={clusters} />
                </div>
              </Box>
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
