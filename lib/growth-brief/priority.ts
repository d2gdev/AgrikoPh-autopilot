// Growth Brief priorities arrive in two schemes: P0–P3 (jobs, store tasks,
// opportunities, recommendations, most content proposals) OR word grades
// ("High"/"Medium"/"Low" — some ContentProposal rows). Normalize both to one
// numeric rank so sorting and toning are consistent. A raw string comparator
// (`a > b`) sorts "Medium" (M) before "P1" (P), floating word-graded items to
// the top of a section regardless of real priority, and never returns 0 for
// equal items.
export function priorityRank(priority: string | null | undefined): number {
  const p = (priority ?? "").trim().toLowerCase();
  const numeric: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3, p4: 4 };
  if (p in numeric) return numeric[p]!;
  const word: Record<string, number> = { critical: 0, urgent: 0, high: 1, medium: 2, low: 3 };
  if (p in word) return word[p]!;
  return 99;
}
