import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { resolveArticleHandle } from "@/lib/content-pilot/publish-draft";
import { fetchBlogArticles } from "@/lib/shopify-admin";
import { canGenerateContentProposal, CONTENT_PROPOSAL_PUBLISHABLE_STATUSES } from "@/lib/content-pilot/proposal-state";
import { generateDraft, collectDraftCitations, type DraftContent } from "@/lib/content-pilot/generate-draft";

import type { BlogArticle } from "@/lib/shopify-admin";
import type { ContentProposal, PrismaClient } from "@prisma/client";

type DraftGenerationValidationOutcome = { kind: "validation"; error: string } | { kind: "other"; error: string };

export type GenerateProposalDraftResult =
  | { kind: "ready"; proposal: DraftPersistedProposal }
  | { kind: "failed"; error: string }
  | { kind: "discarded"; reason: string }
  | { kind: "conflict"; reason: string };

export type DraftPersistedProposal = NonNullable<ContentProposal>;

type GenerateDraftTransactionClient = {
  contentProposal: Pick<PrismaClient["contentProposal"], "findUnique" | "update" | "updateMany">;
  contentProposalDraftHistory: Pick<PrismaClient["contentProposalDraftHistory"], "create">;
};
type GenerateDraftClient = GenerateDraftTransactionClient & {
  $transaction: <T>(callback: (tx: GenerateDraftTransactionClient) => Promise<T>) => Promise<T>;
};

type GenerateDraftImpl = (proposal: DraftPersistedProposal, article: BlogArticle | null) => Promise<DraftContent>;
type GenerateDraftCitations = typeof collectDraftCitations;
type GenerateDraftValidation = (
  proposal: DraftPersistedProposal,
  draftContent: DraftContent,
) => string | null;

type GenerationServiceInput = {
  prismaClient: GenerateDraftClient;
  proposalId: string;
  actor: string;
  preservePublishedReceipt?: boolean;
  generateDraftImpl?: GenerateDraftImpl;
  resolveArticleHandleImpl?: (proposal: DraftPersistedProposal) => string | null;
  fetchBlogArticlesImpl?: () => Promise<BlogArticle[]>;
  collectDraftCitationsImpl?: GenerateDraftCitations;
  validateDraftImpl?: GenerateDraftValidation;
};

function throwNotFound(id: string): never {
  throw new Error(`Proposal not found: ${id}`);
}

type DraftJsonValue = Prisma.InputJsonValue | Prisma.JsonNullValueInput;

function asDraftContent(value: unknown): DraftJsonValue {
  return value === undefined || value === null
    ? Prisma.JsonNull
    : (value as Prisma.InputJsonValue);
}

function parseWordCount(bodyHtml: string) {
  const text = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const words = text.split(" ").filter(Boolean);
  return { text, count: words.length };
}

function validateDraftContent(proposal: DraftPersistedProposal, draftContent: DraftContent): string | null {
  const proposalType = proposal.proposalType ?? "new-content";
  const draftBody = (draftContent as { bodyHtml?: unknown }).bodyHtml;
  const bodyHtml = typeof draftBody === "string" ? draftBody : "";
  const proposedState = proposal.proposedState as Record<string, unknown> | null;
  if (proposalType === "seo-fix" || proposalType === "internal-link" || proposalType === "missing-meta") {
    return null;
  }

  const targetWordCount = (proposedState?.targetWordCount as number | null | undefined)
    ?? (proposedState?.idealWordCount as number | null | undefined);
  const { text, count: wordCount } = parseWordCount(bodyHtml);
  const action = typeof proposedState?.action === "string"
    ? String(proposedState.action)
    : null;
  if (action === "add_h1" && !/<h1[\s>]/i.test(bodyHtml)) {
    return "Draft is missing the requested H1 heading";
  }

  if (targetWordCount && wordCount < targetWordCount * 0.8) {
    return `Draft too short: ${wordCount} words (target: ${targetWordCount}, minimum: ${Math.round(targetWordCount * 0.8)})`;
  }
  if (wordCount < 100) {
    return `Draft too short: only ${wordCount} words`;
  }
  if (!/<h2/i.test(bodyHtml) && wordCount > 300) {
    return `Draft is missing H2 headings (${wordCount} words with no structure)`;
  }
  return null;
}

function classifyValidationFailure(error: string): DraftGenerationValidationOutcome {
  return /draft too short/i.test(error) || /draft is missing/i.test(error)
    ? { kind: "validation", error }
    : { kind: "other", error };
}

async function claimDraftSlot(input: GenerationServiceInput, proposal: DraftPersistedProposal) {
  const token = randomUUID();

  const claim = await input.prismaClient.contentProposal.updateMany({
    where: {
      id: proposal.id,
      status: { in: [...CONTENT_PROPOSAL_PUBLISHABLE_STATUSES] as string[] },
      AND: [
        {
          OR: [
            { draftStatus: null },
            { draftStatus: { notIn: ["generating", "publishing"] } },
          ],
        },
        { OR: [{ draftGenerationToken: null }, { draftGenerationToken: "" }] },
      ],
    },
    data: {
      ...(
        input.preservePublishedReceipt && proposal.draftStatus === "published"
          ? {}
          : { draftStatus: "generating" }
      ),
      draftGenerationToken: token,
      draftGenerationStartedAt: new Date(),
    },
  });

  if (claim.count === 0) {
    return null;
  }

  return { token };
}

function clearActiveGenerationTokenIfAllowed(where: { id: string; token: string }) {
  return {
    id: where.id,
    status: { in: [...CONTENT_PROPOSAL_PUBLISHABLE_STATUSES] as string[] },
    draftGenerationToken: where.token,
  } as const;
}

async function failGeneration({
  prismaClient,
  proposalId,
  token,
  error,
}: {
  prismaClient: GenerateDraftClient;
  proposalId: string;
  token: string;
  error: string;
}) {
  return prismaClient.contentProposal.updateMany({
    where: {
      ...clearActiveGenerationTokenIfAllowed({ id: proposalId, token }),
    },
    data: {
      draftStatus: "failed",
      draftError: error.slice(0, 2000),
      draftGenerationToken: null,
      draftGenerationStartedAt: null,
    },
  });
}

export async function generateProposalDraft(input: GenerationServiceInput): Promise<GenerateProposalDraftResult> {
  const {
    prismaClient,
    proposalId,
    actor,
    preservePublishedReceipt = false,
    generateDraftImpl = generateDraft,
    resolveArticleHandleImpl = resolveArticleHandle,
    fetchBlogArticlesImpl = fetchBlogArticles,
    collectDraftCitationsImpl = collectDraftCitations,
    validateDraftImpl = validateDraftContent,
  } = input;

  const proposal = await prismaClient.contentProposal.findUnique({
    where: { id: proposalId },
  });
  if (!proposal) {
    throwNotFound(proposalId);
  }

  if (!canGenerateContentProposal(proposal)) {
    return {
      kind: "conflict",
      reason: `Only approved or override-approved proposals can generate drafts`,
    };
  }

  const claim = await claimDraftSlot(input, proposal);
  if (!claim) {
    return {
      kind: "conflict",
      reason: "Proposal is already generating or has active draft ownership",
    };
  }

  const { token } = claim;

  try {
    const resolvedArticleHandle = resolveArticleHandleImpl(proposal);
    if (proposal.proposalType !== "new-content" && !resolvedArticleHandle) {
      const missingIdentityError = `Proposal type "${proposal.proposalType}" requires an articleHandle or a Shopify article URL in proposal data`;
      const failed = await failGeneration({
        prismaClient,
        proposalId: proposal.id,
        token,
        error: missingIdentityError,
      });
      if (failed.count === 0) {
        return {
          kind: "discarded",
          reason: "Proposal changed before missing identity failure persistence could complete",
        };
      }
      return { kind: "failed", error: missingIdentityError };
    }

    const proposalForDraft =
      resolvedArticleHandle && !proposal.articleHandle ? { ...proposal, articleHandle: resolvedArticleHandle } : proposal;

    let article: BlogArticle | null = null;
    if (proposalForDraft.articleHandle) {
      const articles = await fetchBlogArticlesImpl();
      article = articles.find((item) => item.handle === proposalForDraft.articleHandle) ?? null;
    }

    const draftContent = await generateDraftImpl(proposalForDraft, article);
    const validationError = validateDraftImpl(proposalForDraft, draftContent);
    if (validationError) {
      const failed = await failGeneration({ prismaClient, proposalId: proposal.id, token, error: validationError });
      if (failed.count === 0) {
        return {
          kind: "discarded",
          reason: "Proposal changed before validation failure persistence could complete",
        };
      }

      return { kind: "failed", error: validationError };
    }

    let citations: DraftJsonValue | undefined;
    try {
      citations = asDraftContent(await collectDraftCitationsImpl(proposalForDraft));
    } catch (err) {
      console.warn("[generate-draft] skipped citation collection:", err);
    }

    const finalized = await prismaClient.$transaction(async (tx: GenerateDraftTransactionClient) => {
      const updated = await tx.contentProposal.updateMany({
      where: {
          id: proposal.id,
          status: { in: [...CONTENT_PROPOSAL_PUBLISHABLE_STATUSES] as string[] },
          draftGenerationToken: token,
        },
        data: {
          draftStatus: "ready",
          draftContent: asDraftContent(draftContent),
          draftGeneratedAt: new Date(),
          draftError: null,
          draftGenerationToken: null,
          draftGenerationStartedAt: null,
          ...(citations === undefined ? {} : { citations }),
        },
      });

      if (updated.count === 0) {
        return { kind: "discarded" as const, reason: "Proposal changed while generating" };
      }

      await tx.contentProposalDraftHistory.create({
        data: {
          proposalId,
          savedBy: actor,
          draftContent: asDraftContent(draftContent),
          reason: proposal.draftStatus === "ready" ? "regenerated" : "generated",
        },
      });

      const ready = await tx.contentProposal.findUnique({ where: { id: proposal.id } });
      if (!ready) {
        return {
          kind: "discarded" as const,
          reason: "Proposal changed while generating",
        };
      }

      return { kind: "ready" as const, proposal: ready };
    });

    if (finalized.kind === "discarded") {
      return finalized;
    }

    return {
      kind: "ready",
      proposal: {
        ...finalized.proposal,
        draftGenerationToken: null,
      },
    };
  } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
    if (classifyValidationFailure(message).kind === "validation") {
      const failed = await failGeneration({
        prismaClient,
        proposalId: proposal.id,
        token,
        error: message,
      });

      if (failed.count === 0) {
        return {
          kind: "discarded",
          reason: "Proposal changed before validation failure persistence could complete",
        };
      }

      return { kind: "failed", error: message };
    }

    const failed = await failGeneration({
      prismaClient,
      proposalId: proposal.id,
      token,
      error: message,
    });

    if (failed.count === 0) {
      return {
        kind: "discarded",
        reason: "Proposal changed before failure persistence could complete",
      };
    }

    return { kind: "failed", error: message };
  }
}
