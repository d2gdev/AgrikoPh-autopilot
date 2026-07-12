import { normalizeGovernedUrl } from "./url-normalizer";

export type SourceConditionEvidence = {
  coverageUnitId: string;
  state: "satisfied" | "unsatisfied";
  observedValue?: number;
};

export type HighStakesTopic = "medical" | "dosage" | "safety" | "health";

export type StrategyProposalCandidate =
  | { type: "content"; action: "create" | "update"; targetUrl: string; exclusiveIntentScope?: string; sourceConditionEvidence?: SourceConditionEvidence[]; highStakesTopics?: HighStakesTopic[] }
  | { type: "internal_link"; fromUrl: string; toUrl: string }
  | { type: "redirect"; fromUrl: string; toUrl: string }
  | { type: "canonical"; currentUrl: string; proposedCanonicalUrl: string }
  | { type: "indexation"; currentUrl: string; proposedCanonicalUrl: string }
  | { type: "seo_metadata"; targetUrl: string; highStakesTopics?: HighStakesTopic[] };

export type NormalizedStrategyProposalCandidate =
  | { type: "content"; action: "create" | "update"; targetUrl: string; exclusiveIntentScope?: string; sourceConditionEvidence: SourceConditionEvidence[]; highStakesTopics: HighStakesTopic[] }
  | { type: "internal_link"; fromUrl: string; toUrl: string }
  | { type: "redirect"; fromUrl: string; toUrl: string }
  | { type: "canonical"; currentUrl: string; proposedCanonicalUrl: string }
  | { type: "indexation"; currentUrl: string; proposedCanonicalUrl: string }
  | { type: "seo_metadata"; targetUrl: string; highStakesTopics: HighStakesTopic[] };

function evidence(value: SourceConditionEvidence[] | undefined): SourceConditionEvidence[] {
  return (value ?? []).map((entry) => ({ ...entry })).sort((left, right) => left.coverageUnitId.localeCompare(right.coverageUnitId));
}

function topics(value: HighStakesTopic[] | undefined): HighStakesTopic[] {
  return [...new Set(value ?? [])].sort();
}

export function normalizeProposalContext(candidate: StrategyProposalCandidate): NormalizedStrategyProposalCandidate {
  switch (candidate.type) {
    case "content": return { ...candidate, targetUrl: normalizeGovernedUrl(candidate.targetUrl), sourceConditionEvidence: evidence(candidate.sourceConditionEvidence), highStakesTopics: topics(candidate.highStakesTopics) };
    case "internal_link": return { type: candidate.type, fromUrl: normalizeGovernedUrl(candidate.fromUrl), toUrl: normalizeGovernedUrl(candidate.toUrl) };
    case "redirect": return { type: candidate.type, fromUrl: normalizeGovernedUrl(candidate.fromUrl), toUrl: normalizeGovernedUrl(candidate.toUrl) };
    case "canonical": return { type: candidate.type, currentUrl: normalizeGovernedUrl(candidate.currentUrl), proposedCanonicalUrl: normalizeGovernedUrl(candidate.proposedCanonicalUrl) };
    case "indexation": return { type: candidate.type, currentUrl: normalizeGovernedUrl(candidate.currentUrl), proposedCanonicalUrl: normalizeGovernedUrl(candidate.proposedCanonicalUrl) };
    case "seo_metadata": return { ...candidate, targetUrl: normalizeGovernedUrl(candidate.targetUrl), highStakesTopics: topics(candidate.highStakesTopics) };
  }
}
