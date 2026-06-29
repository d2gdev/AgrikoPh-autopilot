export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { requireAppAuth, getSessionShop } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const shop = (await getSessionShop(req)) ?? "api";
  if (!checkRateLimit(`manual:${shop}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "Rate limit exceeded — max 5 manual proposals per minute" },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({})) as { topic?: string; brief?: string; blogHandle?: string };
  // Cap input lengths before persisting to bound payload/prompt size.
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });
  const brief = typeof body.brief === "string" ? body.brief.slice(0, 5000) : null;
  const blogHandle = typeof body.blogHandle === "string" ? body.blogHandle.trim() : null;

  const title = `New article: ${topic}`;
  // Dedup: don't create a second active proposal for the same title.
  const existing = await prisma.contentProposal.findFirst({
    where: { title, status: { in: ["pending", "approved", "override_approved"] } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ proposal: { id: existing.id, title }, existed: true });
  }

  const proposal = await prisma.contentProposal.create({
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
    },
  });
  return NextResponse.json({ proposal });
}
