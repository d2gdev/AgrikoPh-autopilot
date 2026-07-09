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
  const evidence = asRecord(sourceData.evidence);

  const lines: string[] = [];
  const source = firstString(sourceData.source, sourceData.trigger, sourceData.origin, evidence.source);
  if (source) lines.push(`Source: ${prettyLabel(source)}`);

  const target = firstString(
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

  const issue = firstString(sourceData.issue, proposedState.issue, evidence.issue);
  if (issue) lines.push(`Issue: ${prettyLabel(issue)}`);

  if (proposal.articleHandle) lines.push(`Article: ${proposal.articleHandle}`);
  if (lines.length === 0 && proposal.proposalType === "new-content" && !proposal.articleHandle) {
    lines.push("Source: net-new article opportunity");
  }

  return lines;
}
