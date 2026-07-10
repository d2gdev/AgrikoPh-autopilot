"use client";

import { getCache, setCache } from "@/lib/client-cache";

import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Spinner,
  Text,
} from "@shopify/polaris";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthFetch, withShopifyContextUrl } from "@/hooks/use-auth-fetch";

import type { ContentProposal } from "./types";
import { draftFailureMessage } from "./helpers";
import { ProposalRow } from "./queue/ProposalRow";
import { QueueFilters } from "./queue/QueueFilters";
import { QueueModals } from "./queue/QueueModals";
import { contentProposalQueueStage } from "./queue-stage";
import { publishFeedback, publishReconciliationMessage } from "./publish-feedback";

// Safely parse a Response as JSON. If the body is not JSON (e.g. an HTML error
// page from a proxy or Next.js itself), returns { error: <raw text> } rather
// than throwing SyntaxError: Unexpected token '<'.
async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { return { error: `Server returned non-JSON (HTTP ${res.status}): ${text.slice(0, 120)}` }; }
}

export function QueueTab({
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
  const [reconcilingIds, setReconcilingIds] = useState<Set<string>>(new Set());
  // Accordion expand + draft content cache
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedFullIds, setExpandedFullIds] = useState<Set<string>>(new Set());
  const [draftCache, setDraftCache] = useState<Record<string, Record<string, unknown> | null>>({});
  const [loadingDraftId, setLoadingDraftId] = useState<string | null>(null);
  // Search & filter
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | "pending" | "approved" | "generating" | "ready" | "scheduled" | "publishing" | "publish-error" | "published" | "failed" | "rejected">("all");
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
  const [lastPublishFeedback, setLastPublishFeedback] = useState<{ tone: "success" | "warning"; message: string } | null>(null);
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

  const getStage = contentProposalQueueStage;

  const pendingCount = allProposals.filter((p) => p.status === "pending").length;
  const approvedCount = allProposals.filter((p) => p.status === "approved" && !p.draftStatus).length;
  const generatingCount = allProposals.filter((p) => p.draftStatus === "generating").length;
  const readyCount = allProposals.filter((p) => p.draftStatus === "ready" && !p.scheduledPublishAt).length;
  const scheduledCount = allProposals.filter((p) => p.draftStatus === "ready" && p.scheduledPublishAt).length;
  const publishingCount = allProposals.filter((p) => p.draftStatus === "publishing").length;
  const publishErrorCount = allProposals.filter((p) => p.draftStatus === "publish-error").length;
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
      let nextCursor: string | null = null;
      const pages: ContentProposal[] = [];
      let res: Response | null = null;
      for (let page = 0; page < 20; page++) {
        const url = nextCursor ? `/api/content-pilot/proposals?cursor=${encodeURIComponent(nextCursor)}` : "/api/content-pilot/proposals";
        res = await authFetch(url);
        if (!res.ok) break;
        const chunk = (await res.json()) as { proposals?: ContentProposal[]; nextCursor?: string | null; hasMore?: boolean };
        pages.push(...(chunk.proposals ?? []));
        nextCursor = chunk.nextCursor ?? null;
        if (!chunk.hasMore || !nextCursor) break;
      }
      if (!res) throw new Error("No response");
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
      if (seq !== loadSeqRef.current) return;
      setCache("/api/content-pilot/proposals", pages);
      setAllProposals(pages);
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

  const approve = async (id: string, { generate: gen = true }: { generate?: boolean } = {}): Promise<boolean> => {
    setApprovingIds((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      if (!res.ok) { const d = await safeJson(res); setError((d.error as string) ?? "Approve failed"); return false; }
      setAllProposals((prev) => prev.map((p) => p.id === id ? { ...p, status: "approved", ...(gen ? { draftStatus: "generating" } : {}) } : p));
      if (gen) void generateDraft(id, { navigate: false });
      return true;
    } catch (e) { setError(String(e)); return false; }
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

  const generateDraft = async (id: string, { navigate = false, reload = true }: { navigate?: boolean; reload?: boolean } = {}): Promise<boolean> => {
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
        setAllProposals((prev) => prev.map((p) => p.id === id ? { ...p, draftStatus: "failed", draftError: message } : p)); return false;
      } else if (navigate) { router.push(withShopifyContextUrl(`/content-pilot/draft/${id}`)); }
      else if (reload) { await loadProposals(); }
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setAllProposals((prev) => prev.map((p) => p.id === id ? { ...p, draftStatus: "failed", draftError: message } : p)); return false;
    }
    finally { setGeneratingDraftIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); }
  };

  const publishDraft = async (id: string) => {
    setPublishingIds((prev) => new Set(prev).add(id));
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/publish`, { method: "POST" });
      const result = await safeJson(res);
      const reconciliationMessage = publishReconciliationMessage(result);
      if (res.status === 202 || reconciliationMessage) {
        setError(reconciliationMessage ?? "Publication outcome requires reconciliation. Inspect Shopify before retrying.");
        void loadProposals({ silent: true });
        return false;
      }
      if (!res.ok) { setError((result.error as string) ?? "Publish failed"); return false; }
      // Optimistic update then confirm from server
      const title = allProposals.find(p => p.id === id)?.title ?? "Article";
      setAllProposals((prev) => prev.map((p) => p.id === id ? { ...p, draftStatus: "published" } : p));
      setLastPublishFeedback(publishFeedback(title, result as { kind?: string; publishWarning?: string }));
      setTimeout(() => setLastPublishFeedback(null), 4000);
      void loadProposals({ silent: true });
      return true;
    } catch (e) { setError(String(e)); return false; }
    finally { setPublishingIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); }
  };

  const reconcilePublish = async (id: string) => {
    setReconcilingIds((prev) => new Set(prev).add(id));
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/reconcile-publish`, { method: "POST" });
      const d = await safeJson(res);
      if (!res.ok) { setError((d.error as string) ?? "Reconciliation failed"); return; }
      await loadProposals({ silent: true });
    } catch (error) { setError(String(error)); }
    finally { setReconcilingIds((prev) => { const next = new Set(prev); next.delete(id); return next; }); }
  };

  const retryBookkeeping = async (id: string) => {
    setReconcilingIds((prev) => new Set(prev).add(id));
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${id}/retry-bookkeeping`, { method: "POST" });
      const d = await safeJson(res);
      if (!res.ok) { setError((d.error as string) ?? "Bookkeeping retry failed"); return; }
      await loadProposals({ silent: true });
    } catch (error) { setError(String(error)); }
    finally { setReconcilingIds((prev) => { const next = new Set(prev); next.delete(id); return next; }); }
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
        const ok = await approve(id, { generate: false });
        if (!ok) continue;
        await generateDraft(id, { navigate: false, reload: false });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    await loadProposals();
    setBulkActing(false);
  };

  function openBulkPublishModal() {
    // Build candidates from ALL proposals (not the filtered in-view list) so the
    // set the operator reviews here is exactly the set bulkPublishReady() will
    // publish. getStage(p) === "ready" already excludes scheduled drafts and any
    // rejected proposal that still carries a stale "ready" draftStatus.
    const candidates = allProposals.filter(
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
    // Publish exactly the drafts the operator reviewed in the modal — never
    // recompute from allProposals here, or a filtered review could publish more
    // (unreviewed) drafts than were shown. publishCandidates is set by
    // openBulkPublishModal() immediately before this runs.
    const ids = publishCandidates.map((p) => p.id);
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
    { key: "publishing", label: "Publishing", count: publishingCount },
    { key: "publish-error", label: "Publication errors", count: publishErrorCount },
    { key: "published", label: "Published", count: publishedCount },
    { key: "failed", label: "Failed", count: failedCount },
    { key: "rejected", label: "Rejected", count: rejectedCount },
  ];

  // ── Thin wrapper callbacks for props-only children ──────────────────────
  // These wrap existing inline JSX handler bodies verbatim, parameterized by
  // id/value instead of closing over a per-row `p` from a .map() iteration,
  // so the extracted children never receive raw state setters directly.
  const handleSelectStage = (key: typeof stageFilter) => { setStageFilter(key); setSelectedIds(new Set()); setPendingRejectId(null); };
  const handleSearchQueryChange = (v: string) => setSearchQuery(v);
  const handleClearSearch = () => setSearchQuery("");
  const handleTypeFilterChange = (v: string) => setTypeFilter(v);
  const handlePriorityFilterChange = (v: string) => setPriorityFilter(v);
  const handleSortKeyChange = (v: string) => setSortKey(v as typeof sortKey);

  const handleToggleRejectForm = (id: string) => {
    if (pendingRejectId === id) { setPendingRejectId(null); setPendingRejectNote(""); }
    else { setPendingRejectId(id); setPendingRejectNote(""); }
  };
  const handleCancelRejectForm = () => { setPendingRejectId(null); setPendingRejectNote(""); };
  const handlePendingRejectNoteChange = (v: string) => setPendingRejectNote(v);

  const handleOpenCloneConfirm = (id: string) => setConfirmCloneId(id);
  const handleCancelClone = () => setConfirmCloneId(null);
  const handleConfirmClone = async (id: string) => { await cloneProposal(id); setConfirmCloneId(null); };

  const handleOpenSchedule = (p: ContentProposal) => {
    setScheduleOpenId(p.id);
    setScheduleInputs((prev) => ({
      ...prev,
      [p.id]: p.scheduledPublishAt ? (() => {
        const d = new Date(p.scheduledPublishAt!);
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      })() : (prev[p.id] ?? ""),
    }));
  };
  const handleScheduleValueChange = (id: string, v: string) => setScheduleInputs((prev) => ({ ...prev, [id]: v }));
  const handleCancelSchedule = () => setScheduleOpenId(null);

  const handleToggleFullExpand = (id: string) =>
    setExpandedFullIds((prev) => { const n = new Set(prev); expandedFullIds.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleClosePublishModal = () => setShowPublishModal(false);
  const handleConfirmPublishAll = () => { setShowPublishModal(false); bulkPublishReady(); };
  const handleCancelConfirmGenerate = () => setConfirmGenerate(false);
  const handlePublishReviewCheckedChange = (v: boolean) => setPublishReviewChecked(v);

  return (
    <BlockStack gap="400">
      {error && <Banner tone="critical" onDismiss={() => setError(null)}>{error}</Banner>}
      {lastPublishFeedback && (
        <Banner tone={lastPublishFeedback.tone} onDismiss={() => setLastPublishFeedback(null)}>
          {lastPublishFeedback.message}
        </Banner>
      )}
      {lastGeneratedCount !== null && (
        <Banner tone={lastGeneratedCount === 0 ? "warning" : "success"} onDismiss={() => setLastGeneratedCount(null)}>
          {lastGeneratedCount === 0
            ? "No new proposals generated. Existing, rejected, published, and otherwise finished ideas are being respected instead of recreated."
            : `Generated ${lastGeneratedCount} new proposal${lastGeneratedCount === 1 ? "" : "s"}.`}
        </Banner>
      )}

      <QueueModals
        confirmGenerate={confirmGenerate}
        generating={generating}
        pendingCount={pendingCount}
        onConfirmGenerate={generate}
        onCancelConfirmGenerate={handleCancelConfirmGenerate}
        showPublishModal={showPublishModal}
        publishCandidates={publishCandidates}
        publishReviewChecked={publishReviewChecked}
        bulkActing={bulkActing}
        onClosePublishModal={handleClosePublishModal}
        onConfirmPublishAll={handleConfirmPublishAll}
        onPublishReviewCheckedChange={handlePublishReviewCheckedChange}
      />

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

      <QueueFilters
        loading={loading}
        stageFilter={stageFilter}
        stagePills={stagePills}
        onSelectStage={handleSelectStage}
        searchQuery={searchQuery}
        onSearchQueryChange={handleSearchQueryChange}
        onClearSearch={handleClearSearch}
        typeFilter={typeFilter}
        onTypeFilterChange={handleTypeFilterChange}
        typeOptions={typeOptions}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={handlePriorityFilterChange}
        priorityOptions={priorityOptions}
        sortKey={sortKey}
        onSortKeyChange={handleSortKeyChange}
      />

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
            {allProposals.length === 0
              ? "No current proposals."
              : `No items${stageFilter !== "all" ? ` in "${stageFilter}"` : ""}${searchQuery ? ` matching "${searchQuery}"` : ""}.`}
          </Text>
          {allProposals.length === 0 && (
            <Text as="p" tone="subdued">
              Generate fresh proposals after refreshing SEO and blog data. Finished or rejected ideas stay out of the queue unless you re-open them.
            </Text>
          )}
          {allProposals.length > 0 && stageFilter === "pending" && pendingCount === 0 && !searchQuery && (
            <Text as="p" tone="subdued">There are no pending decisions. Rejected and published ideas are kept as history so they do not come back as fresh work.</Text>
          )}
        </BlockStack>
      ) : (
        <BlockStack gap="300">
          {proposals.map((p) => (
            <ProposalRow
              key={p.id}
              p={p}
              stage={getStage(p)}
              router={router}
              bulkActing={bulkActing}
              isSelected={selectedIds.has(p.id)}
              onToggleSelect={toggleSelect}
              isApproving={approvingIds.has(p.id)}
              isRejecting={rejectingIds.has(p.id)}
              isGeneratingDraft={generatingDraftIds.has(p.id)}
              isPublishing={publishingIds.has(p.id)}
              isReconciling={reconcilingIds.has(p.id)}
              onApprove={approve}
              onGenerateDraft={generateDraft}
              onPublishDraft={publishDraft}
              onReconcile={reconcilePublish}
              onRetryBookkeeping={retryBookkeeping}
              onReopen={reopen}
              isRejectFormOpen={pendingRejectId === p.id}
              onToggleRejectForm={handleToggleRejectForm}
              pendingRejectNote={pendingRejectNote}
              onPendingRejectNoteChange={handlePendingRejectNoteChange}
              onReject={reject}
              onCancelRejectForm={handleCancelRejectForm}
              isCloning={cloningIds.has(p.id)}
              isCloneConfirmOpen={confirmCloneId === p.id}
              onOpenCloneConfirm={handleOpenCloneConfirm}
              onCancelClone={handleCancelClone}
              onConfirmClone={handleConfirmClone}
              isScheduleOpen={scheduleOpenId === p.id}
              scheduleValue={scheduleInputs[p.id] ?? ""}
              isScheduling={schedulingId === p.id}
              onOpenSchedule={handleOpenSchedule}
              onScheduleValueChange={handleScheduleValueChange}
              onSaveSchedule={saveScheduleFromQueue}
              onClearSchedule={(id) => saveScheduleFromQueue(id, "", true)}
              onCancelSchedule={handleCancelSchedule}
              isExpanded={expandedId === p.id}
              onToggleExpand={toggleExpand}
              isLoadingDraft={loadingDraftId === p.id}
              draftContent={draftCache[p.id]}
              isFullExpanded={expandedFullIds.has(p.id)}
              onToggleFullExpand={handleToggleFullExpand}
            />
          ))}
        </BlockStack>
      )}
    </BlockStack>
  );
}
