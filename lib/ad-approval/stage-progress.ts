import { STATUS, STAGE } from "@/lib/ad-approval/constants";

// Phase 7 will append a "launched" step — keys are stable, consumers must
// render the array generically (no hardcoded step counts).
export type StepKey =
  | "ai_pre_review" | "brand" | "conversion" | "technical"
  | "penultimate" | "final" | "approved";

export type StepStateValue = "done" | "current" | "blocked" | "pending";
export interface StepState { key: StepKey; label: string; state: StepStateValue }

const PIPELINE: Array<{ key: StepKey; label: string }> = [
  { key: "ai_pre_review", label: "AI pre-review" },
  { key: "brand", label: "Brand" },
  { key: "conversion", label: "Conversion" },
  { key: "technical", label: "Technical" },
  { key: "penultimate", label: "Penultimate" },
  { key: "final", label: "Final" },
  { key: "approved", label: "Approved" },
];

// status → index of the "current" step while the pipeline is live.
const CURRENT_INDEX: Record<string, number> = {
  [STATUS.FOR_AI_PRE_REVIEW]: 0,
  [STATUS.IN_AI_PRE_REVIEW]: 0,
  [STATUS.FOR_BRAND_REVIEW]: 1,
  [STATUS.IN_BRAND_REVIEW]: 1,
  [STATUS.FOR_CONVERSION_REVIEW]: 2,
  [STATUS.IN_CONVERSION_REVIEW]: 2,
  [STATUS.FOR_TECHNICAL_REVIEW]: 3,
  [STATUS.IN_TECHNICAL_REVIEW]: 3,
  [STATUS.WITH_PENULTIMATE_APPROVER]: 4,
  [STATUS.WITH_FINAL_APPROVER]: 5,
};

const STAGE_INDEX: Record<string, number> = {
  [STAGE.PRE_REVIEW]: 0,
  [STAGE.BRAND]: 1,
  [STAGE.CONVERSION]: 2,
  [STAGE.TECHNICAL]: 3,
  [STAGE.PENULTIMATE]: 4,
  [STAGE.FINAL]: 5,
};

function build(states: StepStateValue[]): { steps: StepState[] } {
  return { steps: PIPELINE.map((p, i) => ({ ...p, state: states[i] ?? "pending" })) };
}

function upTo(index: number, at: StepStateValue): { steps: StepState[] } {
  return build(PIPELINE.map((_, i): StepStateValue => (i < index ? "done" : i === index ? at : "pending")));
}

export function stageProgress(status: string, stage: string): { steps: StepState[] } {
  if (status === STATUS.APPROVED) return build(PIPELINE.map(() => "done"));
  if (status in CURRENT_INDEX) return upTo(CURRENT_INDEX[status]!, "current");

  if (status === STATUS.NEEDS_REVISION || status === STATUS.REJECTED || status === STATUS.CANCELLED) {
    const idx = STAGE_INDEX[stage];
    if (idx === undefined) return build(PIPELINE.map(() => "pending"));
    return upTo(idx, "blocked");
  }

  // draft and anything unknown: nothing has happened in the pipeline yet.
  return build(PIPELINE.map(() => "pending"));
}
