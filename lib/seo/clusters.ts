import type { CtrOpportunity, OpportunityCluster } from "@/lib/seo/types";
import { normalizePagePath } from "@/lib/seo/page-health";

// B6 — opportunity clustering.
//
// Group opportunities that share the SAME landing page (when present) OR have
// high query-token overlap (Jaccard over lowercased word sets ≥ threshold).
// Deterministic: input order drives tie-breaking; no Math.random.

const JACCARD_THRESHOLD = 0.5;
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with", "is",
  "are", "best", "how", "what", "vs",
]);

function tokenize(query: string): Set<string> {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

interface WorkItem {
  opp: CtrOpportunity;
  page: string | null; // normalized path, null when absent
  tokens: Set<string>;
}

/**
 * Cluster opportunities by shared landing page or query-token overlap.
 * Singletons are allowed. Clusters sorted by topScore desc.
 */
export function computeOpportunityClusters(
  opportunities: CtrOpportunity[],
): OpportunityCluster[] {
  const items: WorkItem[] = opportunities.map((opp) => ({
    opp,
    page: opp.page ? normalizePagePath(opp.page) || null : null,
    tokens: tokenize(opp.query),
  }));

  // Union-Find over item indices for transitive grouping.
  const parent: number[] = items.map((_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while ((parent[root] as number) !== root) root = parent[root] as number;
    while ((parent[x] as number) !== root) {
      const next = parent[x] as number;
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  for (let i = 0; i < items.length; i++) {
    const a = items[i] as WorkItem;
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j] as WorkItem;
      const samePage = a.page !== null && a.page === b.page;
      const overlap =
        !samePage && jaccard(a.tokens, b.tokens) >= JACCARD_THRESHOLD;
      if (samePage || overlap) union(i, j);
    }
  }

  // Bucket indices by representative root, preserving input order.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const arr = groups.get(root);
    if (arr) arr.push(i);
    else groups.set(root, [i]);
  }

  const clusters: OpportunityCluster[] = [];
  for (const [root, indices] of groups) {
    const opps = indices.map((i) => (items[i] as WorkItem).opp);
    const totalPotentialClicks = opps.reduce(
      (sum, o) => sum + o.potentialClicks,
      0,
    );
    // Highest-score member (input order breaks ties → deterministic).
    let top = opps[0] as CtrOpportunity;
    for (const o of opps) if (o.score > top.score) top = o;
    const topScore = top.score;

    // Shared page: only when every member shares the same normalized page.
    const firstPage = (items[root] as WorkItem).page;
    const sharedPage =
      firstPage !== null &&
      indices.every((i) => (items[i] as WorkItem).page === firstPage)
        ? (items[root] as WorkItem).opp.page ?? null
        : null;

    clusters.push({
      id: `cluster-${root}`,
      label: sharedPage ?? top.query,
      page: sharedPage,
      opportunities: opps,
      totalPotentialClicks,
      topScore,
    });
  }

  clusters.sort((a, b) => b.topScore - a.topScore || b.totalPotentialClicks - a.totalPotentialClicks);
  return clusters;
}
