type Suppression = {
  page: string;
  reason: string;
  ruleIds: string[];
  currentArticleTitle?: string;
  observation?: { source: "store"; capturedAt: string; provenance: string };
};

const CONTENT_GATE_REASONS = new Set([
  "manual_gate",
  "activation_blocking",
  "conditions_unsatisfied",
]);

export type GroupedContentGate = Omit<Suppression, "reason"> & { reasons: string[] };

export function groupContentGateSuppressions(suppressions: Suppression[]): GroupedContentGate[] {
  const grouped = new Map<string, GroupedContentGate>();
  for (const suppression of suppressions) {
    if (!CONTENT_GATE_REASONS.has(suppression.reason)) continue;
    const existing = grouped.get(suppression.page);
    if (!existing) {
      grouped.set(suppression.page, {
        page: suppression.page,
        reasons: [suppression.reason],
        ruleIds: [...new Set(suppression.ruleIds)].sort(),
        ...(suppression.currentArticleTitle ? { currentArticleTitle: suppression.currentArticleTitle } : {}),
        ...(suppression.observation ? { observation: suppression.observation } : {}),
      });
      continue;
    }
    existing.reasons = [...new Set([...existing.reasons, suppression.reason])].sort();
    existing.ruleIds = [...new Set([...existing.ruleIds, ...suppression.ruleIds])].sort();
    if (!existing.currentArticleTitle && suppression.currentArticleTitle) existing.currentArticleTitle = suppression.currentArticleTitle;
    if (!existing.observation && suppression.observation) existing.observation = suppression.observation;
  }
  return [...grouped.values()];
}
