import type { PrismaClient } from "@prisma/client";
import type { ProposalInput } from "@/lib/content-pilot/generate-proposals";
import { generateProposals } from "@/lib/content-pilot/generate-proposals";
import {
  topicalMapActionEligibility,
  topicalMapInternalLinkEligibility,
  topicalMapInternalLinkRequiresAddition,
  type TopicalMapRulePolicy,
} from "@/lib/topical-map/action-eligibility";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";

type ExactMapPage = {
  url: string;
  title?: string;
  decision?: string;
  priority?: string;
  primaryKeywordOrTheme?: string;
  secondaryVariants?: string;
  ruleIds: string[];
  ruleDomains: Partial<Record<"content_decisions", string[]>>;
  contentDecisionPolicy?: TopicalMapRulePolicy;
};

type ExactMapLink = {
  fromUrl: string;
  toUrl: string;
  requiredAction?: string;
  currentBodyState?: string;
  recommendedAnchor?: string;
  priority?: string;
  ruleIds: string[];
  policy: TopicalMapRulePolicy;
};

export type ExactMapCommandCenter = {
  identity: {
    versionId: string;
    strategyVersion: string;
    contractRevision: string;
    packageSha256: string;
    activatedAt: string | null;
  };
  pages: ExactMapPage[];
  prohibited: Array<{ url: string }>;
  work: { internalLinks: ExactMapLink[] };
};

type Candidate =
  | { type: "content"; action: "create" | "update"; targetUrl: string }
  | { type: "seo_metadata"; targetUrl: string }
  | { type: "internal_link"; fromUrl: string; toUrl: string };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function candidateFor(proposal: ProposalInput): Candidate | null {
  const value = record(record(proposal.sourceData).strategyCandidate);
  if (value.type === "content"
    && (value.action === "create" || value.action === "update")
    && typeof value.targetUrl === "string") {
    return { type: "content", action: value.action, targetUrl: normalizeGovernedUrl(value.targetUrl) };
  }
  if (value.type === "seo_metadata" && typeof value.targetUrl === "string") {
    return { type: "seo_metadata", targetUrl: normalizeGovernedUrl(value.targetUrl) };
  }
  if (value.type === "internal_link"
    && typeof value.fromUrl === "string"
    && typeof value.toUrl === "string") {
    return {
      type: "internal_link",
      fromUrl: normalizeGovernedUrl(value.fromUrl),
      toUrl: normalizeGovernedUrl(value.toUrl),
    };
  }
  return null;
}

function contentDecisionAllows(decision: string, candidate: Candidate): boolean {
  if (/\b(do not|don't|never)\s+(?:create|publish|refresh|update|expand|optimi[sz]e)\b/i.test(decision)
    || /\b(?:create|publish)\s+only\s+(?:after|if|when)\b/i.test(decision)) {
    return false;
  }
  if (candidate.type === "seo_metadata") {
    return /\b(meta|metadata|title|snippet|ctr|seo)\b/i.test(decision);
  }
  if (candidate.type !== "content") return false;
  return candidate.action === "create"
    ? /\b(create|publish|new)\b/i.test(decision)
    : /\b(refresh|update|improve|optimi[sz]e|expand|strengthen)\b/i.test(decision);
}

function withMapContext(
  proposal: ProposalInput,
  commandCenter: ExactMapCommandCenter,
  page: ExactMapPage,
): ProposalInput {
  return {
    ...proposal,
    sourceData: {
      ...proposal.sourceData,
      strategyVersionId: commandCenter.identity.versionId,
      packageSha256: commandCenter.identity.packageSha256,
      targetUrl: page.url,
      ruleIds: [...(page.ruleDomains.content_decisions ?? [])].sort(),
      mapTitle: page.title ?? null,
      mapDecision: page.decision ?? null,
      targetKeyword: page.primaryKeywordOrTheme ?? null,
      secondaryVariants: page.secondaryVariants ?? null,
      originalPriority: page.priority ?? null,
    },
  };
}

export function filterExactMapProposals(
  proposals: ProposalInput[],
  commandCenter: ExactMapCommandCenter | null,
): ProposalInput[] {
  if (!commandCenter) return [];
  const prohibited = new Set(commandCenter.prohibited.map((item) => normalizeGovernedUrl(item.url)));

  return proposals.flatMap((proposal) => {
    const candidate = candidateFor(proposal);
    if (!candidate) return [];

    if (candidate.type === "internal_link") {
      const link = commandCenter.work.internalLinks.find((item) =>
        normalizeGovernedUrl(item.fromUrl) === candidate.fromUrl
        && normalizeGovernedUrl(item.toUrl) === candidate.toUrl);
      if (!link
        || !topicalMapInternalLinkEligibility(
          link.policy,
          link.currentBodyState,
          link.requiredAction,
        ).actionable
        || !topicalMapInternalLinkRequiresAddition(link.requiredAction)) {
        return [];
      }
      return [{
        ...proposal,
        sourceData: {
          ...proposal.sourceData,
          strategyVersionId: commandCenter.identity.versionId,
          packageSha256: commandCenter.identity.packageSha256,
          fromUrl: candidate.fromUrl,
          toUrl: candidate.toUrl,
          ruleIds: [...link.ruleIds].sort(),
          mapDecision: link.requiredAction ?? null,
          recommendedAnchor: link.recommendedAnchor ?? null,
          originalPriority: link.priority ?? null,
        },
      }];
    }

    const targetUrl = candidate.targetUrl;
    const page = commandCenter.pages.find((item) => normalizeGovernedUrl(item.url) === targetUrl);
    if (!page?.contentDecisionPolicy
      || prohibited.has(targetUrl)
      || !topicalMapActionEligibility(page.contentDecisionPolicy).actionable
      || !contentDecisionAllows(page.decision ?? "", candidate)) {
      return [];
    }
    return [withMapContext(proposal, commandCenter, page)];
  });
}

export async function generateExactMapProposals(
  prismaClient: PrismaClient,
): Promise<ProposalInput[]> {
  const [proposals, commandCenter] = await Promise.all([
    generateProposals(prismaClient),
    loadActiveTopicalMapCommandCenter(prismaClient),
  ]);
  return filterExactMapProposals(proposals, commandCenter);
}
