import type { ContentProposal } from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function prettyLabel(value: string): string {
  return value.replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
}

export function proposalEvidenceLines(proposal: Pick<ContentProposal, "sourceData" | "proposedState" | "articleHandle" | "proposalType">): string[] {
  const sourceData = asRecord(proposal.sourceData);
  const proposedState = asRecord(proposal.proposedState);
  const organicPriority = asRecord(sourceData.organicPriority);
  const strategyCompliance = asRecord(sourceData.strategyCompliance);
  const evidence = asRecord(sourceData.evidence);
  const observation = asRecord(sourceData.observation);

  const lines: string[] = [];
  const source = firstString(sourceData.source, sourceData.trigger, sourceData.origin, evidence.source);
  if (source) lines.push(`Source: ${prettyLabel(source)}`);

  const mapTitle = firstString(sourceData.mapTitle);
  if (mapTitle) lines.push(`Map title: ${mapTitle}`);
  const targetKeyword = firstString(sourceData.targetKeyword);
  if (targetKeyword) lines.push(`Target keyword: ${targetKeyword}`);
  const targetUrl = firstString(sourceData.targetUrl, proposedState.targetUrl);
  if (targetUrl) lines.push(`Governed URL: ${targetUrl}`);
  const currentArticleTitle = firstString(sourceData.currentArticleTitle);
  if (currentArticleTitle) lines.push(`Current Shopify title: ${currentArticleTitle}`);
  const mapDecision = firstString(sourceData.mapDecision);
  if (mapDecision) lines.push(`Decision: ${mapDecision}`);
  const mapEvidence = firstString(sourceData.mapEvidence);
  if (mapEvidence) lines.push(`Evidence: ${mapEvidence}`);
  const originalPriority = firstString(sourceData.originalPriority);
  if (originalPriority) lines.push(`Original map priority: ${originalPriority}`);
  const resolutionStatus = firstString(sourceData.resolutionStatus);
  if (resolutionStatus) lines.push(`Rule status: ${resolutionStatus}`);
  const secondaryVariants = firstString(sourceData.secondaryVariants);
  if (secondaryVariants) lines.push(`Secondary variants: ${secondaryVariants}`);
  const contentKind = firstString(sourceData.contentKind);
  if (contentKind) lines.push(`Content kind: ${contentKind}`);
  const publishingState = firstString(sourceData.publishingState);
  if (publishingState) lines.push(`Publishing state: ${publishingState}`);
  const exactTargetIfAny = firstString(sourceData.exactTargetIfAny);
  if (exactTargetIfAny) lines.push(`Exact target: ${exactTargetIfAny}`);
  const strategyVersionId = firstString(sourceData.strategyVersionId);
  if (strategyVersionId) lines.push(`Strategy version: ${strategyVersionId}`);
  const packageSha256 = firstString(sourceData.packageSha256);
  if (packageSha256) lines.push(`Package: ${packageSha256.slice(0, 12)}`);
  const ruleIds = Array.isArray(sourceData.ruleIds) ? sourceData.ruleIds.filter((value): value is string => typeof value === "string" && Boolean(value)).slice(0, 100) : [];
  if (ruleIds.length) lines.push(`Governing rules: ${ruleIds.join(", ")}`);
  const observationProvenance = firstString(observation.provenance);
  const observationCapturedAt = firstString(observation.capturedAt);
  if (observationProvenance || observationCapturedAt) lines.push(`Observation: ${observationProvenance ?? "source unavailable"}${observationCapturedAt ? ` captured ${observationCapturedAt}` : ""}`);
  const fromUrl = firstString(sourceData.fromUrl, proposedState.fromUrl);
  const toUrl = firstString(sourceData.toUrl, proposedState.toUrl);
  if (fromUrl) lines.push(`Exact source URL: ${fromUrl}`);
  if (toUrl) lines.push(`Exact target URL: ${toUrl}`);
  const anchor = firstString(sourceData.recommendedAnchor, proposedState.suggestedAnchorText);
  if (anchor) lines.push(`Anchor: ${anchor}`);
  const linkPurpose = firstString(sourceData.linkPurpose);
  if (linkPurpose) lines.push(`Purpose: ${linkPurpose}`);
  const requiredAction = firstString(sourceData.requiredAction);
  if (requiredAction) lines.push(`Required action: ${requiredAction}`);
  const verification = firstString(sourceData.verification);
  if (verification) lines.push(`Verification: ${verification}`);
  const currentBodyState = firstString(sourceData.currentBodyState);
  if (currentBodyState) lines.push(`Map-recorded state: ${currentBodyState}`);

  const target = targetKeyword ? null : firstString(
    proposedState.targetKeyword,
    proposedState.targetQuery,
    proposedState.keyword,
    sourceData.query,
    sourceData.keyword,
    evidence.query,
  );
  if (target) lines.push(`Target: ${target}`);

  const score = firstNumber(organicPriority.score, sourceData.score, evidence.score);
  if (score !== null) lines.push(`Score: ${Math.round(score)}`);

  const impressions = firstNumber(sourceData.impressions, evidence.impressions);
  if (impressions !== null) lines.push(`Impressions: ${Math.round(impressions).toLocaleString()}`);

  const position = firstNumber(sourceData.position, evidence.position);
  if (position !== null) lines.push(`Avg position: ${position.toFixed(1)}`);

  const governance = firstString(strategyCompliance.result);
  if (governance) lines.push(`Governance: ${prettyLabel(governance)}`);

  const issue = firstString(sourceData.issue, proposedState.issue, evidence.issue);
  if (issue) lines.push(`Issue: ${prettyLabel(issue)}`);

  if (proposal.articleHandle) lines.push(`Article: ${proposal.articleHandle}`);
  if (lines.length === 0 && proposal.proposalType === "new-content" && !proposal.articleHandle) {
    lines.push("Source: net-new article opportunity");
  }

  return lines;
}
