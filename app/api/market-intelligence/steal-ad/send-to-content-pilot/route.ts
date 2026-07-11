import { NextResponse } from "next/server";
import { PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";

interface SendBody {
  headline: string;
  adCopy: string;
  cta: string;
  platform: string;
  suggestedContentType: string;
  sourceAdId: string;
}

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  try {
    const body = await req.json().catch(() => null) as SendBody | null;
    if (!body || !body.headline || !body.adCopy || !body.sourceAdId) {
      return NextResponse.json({ error: "headline, adCopy, and sourceAdId are required" }, { status: 400 });
    }

    const proposal = await prisma.contentProposal.create({
      data: {
        proposalType: "social_ad",
        changeType: "create",
        priority: "medium",
        impact: "medium",
        effort: "low",
        title: body.headline,
        description: body.adCopy,
        status: "pending",
        proposedState: {
          headline: body.headline,
          adCopy: body.adCopy,
          cta: body.cta,
          platform: body.platform,
          suggestedContentType: body.suggestedContentType,
        },
        sourceData: {
          source: "steal_ad",
          sourceAdId: body.sourceAdId,
          platform: body.platform,
        },
      },
    });

    return NextResponse.json({ proposalId: proposal.id });
  } catch (err) {
    console.error("[steal-ad/send-to-content-pilot]", err);
    return NextResponse.json({ error: "Failed to create proposal" }, { status: 500 });
  }
}
