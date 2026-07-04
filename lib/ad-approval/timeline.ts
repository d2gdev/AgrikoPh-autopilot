// Pure merge of ad-approval history rows (revisions, reviews, audit log
// entries) into one chronologically-sorted activity timeline. Dependency-free
// and DB-free by design: callers resolve names and pass structural rows in,
// so this stays trivial to unit test and to reuse from any surface (API
// route, server component, future export). No approval state-machine logic
// lives here.

export interface RevisionLike {
  revisionNumber: number;
  submittedAt: Date;
  statusAtSubmission: string;
  // Resolved at the call site via names[submitterId] ?? submitterId — this
  // module does no name lookups of its own for revisions.
  submitterLabel: string;
}

export interface ReviewLike {
  stage: string;
  reviewerName: string;
  decision: string;
  score: number | null;
  comments: string | null;
  completedAt: Date;
}

export interface AuditLike {
  createdAt: Date;
  actor: string;
  action: string;
  meta: unknown;
}

export type TimelineEntryKind = "revision" | "review" | "audit";

export interface TimelineEntry {
  at: string;
  actor: string;
  kind: TimelineEntryKind;
  summary: string;
}

const COMMENT_MAX_LENGTH = 140;

function revisionSummary(r: RevisionLike): string {
  return `Revision ${r.revisionNumber} submitted (from ${r.statusAtSubmission})`;
}

function reviewSummary(r: ReviewLike): string {
  let summary = `${r.stage}: ${r.decision}`;
  if (r.score !== null) summary += ` — score ${r.score}`;
  if (r.comments) summary += ` — "${r.comments.slice(0, COMMENT_MAX_LENGTH)}"`;
  return summary;
}

// meta is typed unknown (it's freeform JSON from the audit log), so narrow
// defensively rather than assuming shape.
function metaReason(meta: unknown): string | null {
  if (typeof meta !== "object" || meta === null) return null;
  const reason = (meta as Record<string, unknown>).reason;
  return typeof reason === "string" ? reason : null;
}

function auditSummary(a: AuditLike): string {
  const reason = metaReason(a.meta);
  return reason ? `${a.action} — ${reason}` : a.action;
}

export function buildApprovalTimeline(input: {
  revisions: RevisionLike[];
  reviews: ReviewLike[];
  auditRows: AuditLike[];
  names: Record<string, string>;
}): TimelineEntry[] {
  const { revisions, reviews, auditRows, names } = input;

  const revisionEntries: TimelineEntry[] = revisions.map((r) => ({
    at: r.submittedAt.toISOString(),
    actor: r.submitterLabel,
    kind: "revision",
    summary: revisionSummary(r),
  }));

  const reviewEntries: TimelineEntry[] = reviews.map((r) => ({
    at: r.completedAt.toISOString(),
    actor: r.reviewerName,
    kind: "review",
    summary: reviewSummary(r),
  }));

  const auditEntries: TimelineEntry[] = auditRows.map((a) => ({
    at: a.createdAt.toISOString(),
    actor: names[a.actor] ?? a.actor,
    kind: "audit",
    summary: auditSummary(a),
  }));

  return [...revisionEntries, ...reviewEntries, ...auditEntries].sort((a, b) => a.at.localeCompare(b.at));
}
