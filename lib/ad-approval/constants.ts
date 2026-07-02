// Ad Approval workflow — canonical status/stage vocabulary and transition rules.
// See docs/ad-approval-spec.md §Workflow States and §State Transition Rules.

export const STATUS = {
  DRAFT: "draft",
  FOR_AI_PRE_REVIEW: "for_ai_pre_review",
  IN_AI_PRE_REVIEW: "in_ai_pre_review",
  FOR_BRAND_REVIEW: "for_brand_review",
  IN_BRAND_REVIEW: "in_brand_review",
  FOR_CONVERSION_REVIEW: "for_conversion_review",
  IN_CONVERSION_REVIEW: "in_conversion_review",
  FOR_TECHNICAL_REVIEW: "for_technical_review",
  IN_TECHNICAL_REVIEW: "in_technical_review",
  WITH_PENULTIMATE_APPROVER: "with_penultimate_approver",
  WITH_FINAL_APPROVER: "with_final_approver",
  APPROVED: "approved_to_make_kwarta",
  NEEDS_REVISION: "needs_revision",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
} as const;

export type Status = (typeof STATUS)[keyof typeof STATUS];

export const STAGE = {
  PRE_REVIEW: "PRE_REVIEW",
  BRAND: "BRAND",
  CONVERSION: "CONVERSION",
  TECHNICAL: "TECHNICAL",
  PENULTIMATE: "PENULTIMATE",
  FINAL: "FINAL",
} as const;

export type Stage = (typeof STAGE)[keyof typeof STAGE];

// Review stage labels stored on AdReview / AdAIReport.
export const REVIEW_STAGE = {
  PRE_REVIEW: "PRE_REVIEW",
  BRAND_REVIEW: "BRAND_REVIEW",
  CONVERSION_REVIEW: "CONVERSION_REVIEW",
  TECHNICAL_REVIEW: "TECHNICAL_REVIEW",
  PENULTIMATE_APPROVAL: "PENULTIMATE_APPROVAL",
  FINAL_APPROVAL: "FINAL_APPROVAL",
} as const;

export const REVIEWER_ROLE = {
  CONVERSION_REVIEWER: "CONVERSION_REVIEWER",
  PENULTIMATE_APPROVER: "PENULTIMATE_APPROVER",
  FINAL_APPROVER: "FINAL_APPROVER",
} as const;

export type ReviewerRole = (typeof REVIEWER_ROLE)[keyof typeof REVIEWER_ROLE];

export const DECISION = {
  PASS: "PASS",
  NEEDS_REVISION: "NEEDS_REVISION",
  REJECTED: "REJECTED",
} as const;

export type Decision = (typeof DECISION)[keyof typeof DECISION];

// Terminal statuses — no outbound transitions allowed.
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  STATUS.APPROVED,
  STATUS.REJECTED,
  STATUS.CANCELLED,
]);

// Allowed state transitions (spec §State Transition Rules). A transition not
// listed here is rejected by the state machine. "needs_revision" is a pause,
// not a terminal state: the submitter can move it back to draft.
export const ALLOWED_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  [STATUS.DRAFT]: [STATUS.FOR_AI_PRE_REVIEW, STATUS.CANCELLED],
  [STATUS.FOR_AI_PRE_REVIEW]: [STATUS.IN_AI_PRE_REVIEW, STATUS.CANCELLED],
  // in_* → for_* revert edges are the retry bounce: a failed/timed-out AI job
  // returns the approval to its queue state so the next cycle re-runs it.
  [STATUS.IN_AI_PRE_REVIEW]: [STATUS.FOR_BRAND_REVIEW, STATUS.FOR_AI_PRE_REVIEW, STATUS.NEEDS_REVISION, STATUS.REJECTED],
  [STATUS.FOR_BRAND_REVIEW]: [STATUS.IN_BRAND_REVIEW, STATUS.NEEDS_REVISION, STATUS.REJECTED],
  [STATUS.IN_BRAND_REVIEW]: [STATUS.FOR_CONVERSION_REVIEW, STATUS.FOR_BRAND_REVIEW, STATUS.NEEDS_REVISION, STATUS.REJECTED],
  [STATUS.FOR_CONVERSION_REVIEW]: [STATUS.IN_CONVERSION_REVIEW, STATUS.NEEDS_REVISION, STATUS.REJECTED],
  [STATUS.IN_CONVERSION_REVIEW]: [STATUS.FOR_TECHNICAL_REVIEW, STATUS.NEEDS_REVISION, STATUS.REJECTED],
  [STATUS.FOR_TECHNICAL_REVIEW]: [STATUS.IN_TECHNICAL_REVIEW, STATUS.NEEDS_REVISION, STATUS.REJECTED],
  // Technical Review pass normally advances to Penultimate; conflict-of-interest
  // may escalate straight to Final (see lib/ad-approval/conflict.ts).
  [STATUS.IN_TECHNICAL_REVIEW]: [
    STATUS.WITH_PENULTIMATE_APPROVER,
    STATUS.WITH_FINAL_APPROVER,
    STATUS.FOR_TECHNICAL_REVIEW,
    STATUS.NEEDS_REVISION,
    STATUS.REJECTED,
  ],
  [STATUS.WITH_PENULTIMATE_APPROVER]: [STATUS.WITH_FINAL_APPROVER, STATUS.NEEDS_REVISION, STATUS.REJECTED],
  [STATUS.WITH_FINAL_APPROVER]: [STATUS.APPROVED, STATUS.NEEDS_REVISION, STATUS.REJECTED],
  [STATUS.NEEDS_REVISION]: [STATUS.DRAFT],
  [STATUS.APPROVED]: [],
  [STATUS.REJECTED]: [],
  [STATUS.CANCELLED]: [],
};

export function isTransitionAllowed(from: string, to: string): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// Job timeouts (spec §AI Agents).
export const JOB_TIMEOUT_SECONDS = {
  PRE_REVIEW: 90,
  BRAND_REVIEW: 90,
  TECHNICAL_REVIEW: 120,
} as const;

// Retry backoff schedule in milliseconds (spec §Timeout & Retry Strategy).
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
export const MAX_JOB_ATTEMPTS = 3;

// SLA thresholds in milliseconds (spec §Reviewer Assignment).
export const SLA_MS = {
  CONVERSION: 4 * 60 * 60_000,
  PENULTIMATE: 8 * 60 * 60_000,
  FINAL: 24 * 60 * 60_000,
} as const;

// Conversion Review scoring rubric pass conditions (spec §Conversion Review Scoring Rubric).
export const CONVERSION_MIN_TOTAL = 24;
export const CONVERSION_MIN_PER_QUESTION = 3;
export const CONVERSION_QUESTION_COUNT = 6;
