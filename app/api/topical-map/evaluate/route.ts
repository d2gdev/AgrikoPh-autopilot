export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { evaluatePersistedGovernedOperation } from "@/lib/topical-map/governed-operations";

const Url = z.string().trim().min(1).max(2_000);
const SourceConditionEvidence = z.object({
  coverageUnitId: z.string().trim().min(1).max(500), state: z.enum(["satisfied", "unsatisfied"]), observedValue: z.number().finite().optional(),
}).strict();
const HighStakesTopics = z.array(z.enum(["medical", "dosage", "safety", "health"])).max(4).optional();
const Candidate = z.discriminatedUnion("type", [
  z.object({ type: z.literal("content"), action: z.enum(["create", "update"]), targetUrl: Url, exclusiveIntentScope: z.string().trim().min(1).max(500).optional(), sourceConditionEvidence: z.array(SourceConditionEvidence).max(100).optional(), highStakesTopics: HighStakesTopics }).strict(),
  z.object({ type: z.literal("internal_link"), fromUrl: Url, toUrl: Url }).strict(),
  z.object({ type: z.literal("redirect"), fromUrl: Url, toUrl: Url }).strict(),
  z.object({ type: z.literal("canonical"), currentUrl: Url, proposedCanonicalUrl: Url }).strict(),
  z.object({ type: z.literal("indexation"), currentUrl: Url, proposedCanonicalUrl: Url }).strict(),
  z.object({ type: z.literal("seo_metadata"), targetUrl: Url, highStakesTopics: HighStakesTopics }).strict(),
]);

export async function POST(req: NextRequest) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const parsed = Candidate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid evaluation candidate." }, { status: 400 });
  try {
    return NextResponse.json(await evaluatePersistedGovernedOperation(prisma, parsed.data));
  } catch {
    return NextResponse.json({ error: "Strategy evaluation service is unavailable." }, { status: 503 });
  }
}
