export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSessionShop,
  getSessionUser,
  PERMISSIONS,
  requireAppAuth,
  requirePermission,
} from "@/lib/auth";
import {
  getBlockingMapContentProposals,
  hasReadyMappedContentTask,
} from "@/lib/content-pilot/map-candidate-history";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  analysisEvidenceState,
  readAnalysisForStrategy,
} from "@/lib/seo/analysis";
import { getLatestSnapshot } from "@/lib/seo/snapshot";
import { topicalMapInternalLinkEligibility } from "@/lib/topical-map/action-eligibility";
import {
  loadActiveTopicalMapCommandCenter,
  type CommandCenterPage,
  type TopicalMapCommandCenter,
} from "@/lib/topical-map/command-center";

const BriefInput = z.object({
  strategyVersionId: z.string().min(1),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  analysisGeneratedAt: z.string().datetime(),
  candidateId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

function mappedBrief(input: {
  page: CommandCenterPage;
  action: string;
  observedEvidence: unknown;
  commandCenter: TopicalMapCommandCenter;
}): string {
  const { page, action, observedEvidence, commandCenter } = input;
  const siblings = page.cluster
    ? commandCenter.pages.filter((item) => item.url !== page.url && item.cluster === page.cluster)
    : [];
  const links = commandCenter.work.internalLinks.filter((link) =>
    (link.fromUrl === page.url || link.toUrl === page.url)
    && topicalMapInternalLinkEligibility(
      link.policy,
      link.currentBodyState,
      link.requiredAction,
    ).actionable);
  const value = (item: string | undefined) => item ?? "Not specified by the active topical map.";

  return [
    `# ${value(page.title)}`,
    "",
    "## Exact mapped assignment",
    `- Action: ${action}`,
    `- Target URL: ${page.url}`,
    `- Cluster: ${value(page.cluster)}`,
    `- Page role: ${value(page.role)}`,
    `- Primary keyword/theme: ${value(page.primaryKeywordOrTheme)}`,
    `- Secondary variants: ${value(page.secondaryVariants)}`,
    `- Exclusive intent scope: ${value(page.exclusiveIntentScope)}`,
    "",
    "## Required work",
    `- Map decision: ${value(page.decision)}`,
    `- Exact target, if specified: ${value(page.exactTargetIfAny)}`,
    `- Map evidence: ${value(page.evidence)}`,
    `- Observed evidence: ${JSON.stringify(observedEvidence)}`,
    "",
    "## Ownership boundaries",
    ...(siblings.length > 0
      ? siblings.map((sibling) =>
        `- Do not duplicate ${value(sibling.exclusiveIntentScope)} owned by ${value(sibling.title)} (${sibling.url}); role: ${value(sibling.role)}; keyword/theme: ${value(sibling.primaryKeywordOrTheme)}.`)
      : ["- No sibling ownership boundary is specified for this cluster."]),
    "",
    "## Map-authorized internal links",
    ...(links.length > 0
      ? links.map((link) =>
        `- ${link.fromUrl} → ${link.toUrl}; action: ${value(link.requiredAction)}; anchor: ${value(link.recommendedAnchor)}; purpose: ${value(link.linkPurpose)}.`)
      : ["- No internal link involving this page is specified by the active topical map."]),
    "",
    "## Completion checks",
    `- Keep the exact target URL: ${page.url}.`,
    `- Complete only the mapped decision: ${value(page.decision)}`,
    "- Do not add another topic, page, URL, intent, claim, or internal link that is not listed above.",
    "- Keep sibling-owned intent out of this page.",
  ].join("\n");
}

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`brief:${actor}`, 10, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded: max 10 briefs per minute" }, { status: 429 });
  }
  const parsed = BriefInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid mapped content candidate." }, { status: 400 });
  }

  const [snapshot, commandCenter] = await Promise.all([
    getLatestSnapshot("seo_analysis"),
    loadActiveTopicalMapCommandCenter(prisma),
  ]);
  const generatedAt = snapshot?.payload?.generatedAt;
  if (!snapshot
    || !commandCenter
    || generatedAt !== parsed.data.analysisGeneratedAt
    || commandCenter.identity.versionId !== parsed.data.strategyVersionId
    || commandCenter.identity.packageSha256 !== parsed.data.packageSha256
    || analysisEvidenceState(snapshot.payload) !== "current") {
    return NextResponse.json({ error: "Analysis or strategy changed." }, { status: 409 });
  }
  const analysis = readAnalysisForStrategy(snapshot.payload, commandCenter.identity);
  const candidate = analysis?.gaps.find((gap) =>
    gap.candidateId === parsed.data.candidateId
    && gap.kind === "content"
    && typeof gap.page === "string");
  const page = candidate
    ? commandCenter.pages.find((item) =>
      item.url === candidate.page
      && item.ruleIds.slice().sort().join("\0") === candidate.ruleIds.slice().sort().join("\0"))
    : null;
  if (!candidate || !page?.decision) {
    return NextResponse.json({ error: "Mapped content candidate is no longer available." }, { status: 409 });
  }
  if (!await hasReadyMappedContentTask(prisma, {
    strategyVersionId: parsed.data.strategyVersionId,
    candidateId: candidate.candidateId,
  })) {
    return NextResponse.json(
      { error: "Mapped content work is not Ready in SEO Tasks." },
      { status: 409 },
    );
  }
  const blockedProposals = await getBlockingMapContentProposals(prisma, [candidate]);
  if (blockedProposals.has(candidate.candidateId)) {
    return NextResponse.json(
      { error: "Mapped content work is already queued or completed." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    brief: mappedBrief({
      page,
      action: candidate.action,
      observedEvidence: candidate.observedEvidence,
      commandCenter,
    }),
  });
}
