import { loadActiveStrategyPolicy, type ActiveStrategyPolicyReader } from "@/lib/topical-map/compliance-store";
import { evaluateStrategyPolicy, type ActiveStrategyPolicy, type StrategyComplianceResult } from "@/lib/topical-map/evaluator";
import { normalizeProposalContext, type StrategyProposalCandidate } from "@/lib/topical-map/proposal-context";

export interface GovernedOperationEvaluation {
  candidate: ReturnType<typeof normalizeProposalContext>;
  compliance: StrategyComplianceResult;
  proposalOnly: true;
  executionAuthorized: false;
  highStakesReview: { required: boolean; approval: "manual_high_stakes_review" | null };
}

function project(candidate: StrategyProposalCandidate, active: ActiveStrategyPolicy | null): GovernedOperationEvaluation {
  const normalized = normalizeProposalContext(candidate);
  const compliance = evaluateStrategyPolicy(active, normalized);
  const needsHighStakesReview = compliance.result === "needs_high_stakes_review";
  return {
    candidate: normalized,
    compliance,
    proposalOnly: true,
    executionAuthorized: false,
    highStakesReview: { required: needsHighStakesReview, approval: needsHighStakesReview ? "manual_high_stakes_review" : null },
  };
}

/** Pure, no-side-effect operation adapter for a caller-selected active policy. */
export function evaluateGovernedOperation(active: ActiveStrategyPolicy | null, candidate: StrategyProposalCandidate): GovernedOperationEvaluation {
  return project(candidate, active);
}

/** Loads Task 8's active policy projection, then returns proposal/review evidence only. */
export async function evaluatePersistedGovernedOperation(reader: ActiveStrategyPolicyReader, candidate: StrategyProposalCandidate): Promise<GovernedOperationEvaluation> {
  const active = await loadActiveStrategyPolicy(reader);
  return project(candidate, active?.policy ?? null);
}
