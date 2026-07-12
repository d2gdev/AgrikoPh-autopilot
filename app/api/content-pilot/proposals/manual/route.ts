export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSessionShop, getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { createGovernedContentProposal } from "@/lib/topical-map/compliance-store";

export async function POST(req: NextRequest) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`manual:${actor}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "Rate limit exceeded — max 5 manual proposals per minute" },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({})) as { topic?: string; brief?: string; blogHandle?: string; targetUrl?: string; exclusiveIntentScope?: string; highStakesTopics?: Array<"medical" | "dosage"> };
  // Cap input lengths before persisting to bound payload/prompt size.
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });
  const brief = typeof body.brief === "string" ? body.brief.slice(0, 5000) : null;
  const blogHandle = typeof body.blogHandle === "string" ? body.blogHandle.trim() : null;
  const targetUrl = typeof body.targetUrl === "string" ? body.targetUrl.trim() : "";
  if (!targetUrl) return NextResponse.json({ error: "targetUrl is required for strategy review", compliance: { result: "needs_evidence", reasonCodes: ["MISSING_GOVERNED_CONTEXT"] } }, { status: 400 });

  const title = `New article: ${topic}`;
  // Dedup: don't recreate a proposal the operator already handled.
  const result = await createGovernedContentProposal(prisma as never, {
    candidate: {
      type: "content",
      action: "create",
      targetUrl,
      ...(typeof body.exclusiveIntentScope === "string" && body.exclusiveIntentScope.trim() ? { exclusiveIntentScope: body.exclusiveIntentScope.trim() } : {}),
      ...(Array.isArray(body.highStakesTopics) ? { highStakesTopics: body.highStakesTopics.filter((topic): topic is "medical" | "dosage" => topic === "medical" || topic === "dosage") } : {}),
    },
    data: {
      proposalType: "new-content",
      changeType: "create",
      priority: "P2",
      impact: "high",
      effort: "high",
      title,
      description: `Manually created proposal to write a new article on "${topic}".${brief ? " Brief attached." : ""}`,
      proposedState: {
        targetKeyword: topic,
        brief: brief ?? null,
        blogHandle: blogHandle ?? null,
      },
      sourceData: { trigger: "manual", topic },
    } as never,
  });
  if (!result.created) return NextResponse.json({ proposal: null, existed: false, compliance: result.compliance }, { status: 409 });
  return NextResponse.json({ proposal: result.proposal, existed: false });
}
