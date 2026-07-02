export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizePermission, PERMISSIONS } from "@/lib/auth";
import { STATUS, STAGE } from "@/lib/ad-approval/constants";
import { resolveActor, isAdmin, badRequest, conflict, auditDenied } from "@/lib/ad-approval/route-helpers";

const ALLOWED_STATUSES = new Set<string>(Object.values(STATUS));

// GET /api/ad-approvals — list approvals visible to the actor (own + assigned;
// admins see all), with optional filters. The dashboard buckets these client-side.
export async function GET(req: Request) {
  const ctx = await resolveActor(req);
  if (ctx instanceof NextResponse) return ctx;
  const { actor } = ctx;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const stage = url.searchParams.get("stage");
  const submitter = url.searchParams.get("submitter");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const filters: Record<string, unknown> = {};
  if (status && ALLOWED_STATUSES.has(status)) filters.status = status;
  if (stage) filters.stage = stage;
  if (submitter) filters.submitterId = submitter;

  const admin = await isAdmin(req);
  const scope = admin
    ? filters
    : {
        ...filters,
        OR: [
          { submitterId: actor },
          { assignedConversionReviewerId: actor },
          { assignedPenultimateApproverId: actor },
          { assignedFinalApproverId: actor },
        ],
      };

  const [approvals, total] = await Promise.all([
    prisma.adApproval.findMany({ where: scope, orderBy: { updatedAt: "desc" }, take: limit, skip: offset }),
    prisma.adApproval.count({ where: scope }),
  ]);

  return NextResponse.json({ approvals, total, offset, limit, isAdmin: admin, actor });
}

const createSchema = z.object({
  campaignId: z.string().min(1).max(200),
  copy: z.record(z.unknown()).default({}),
  creative: z.record(z.unknown()).default({}),
});

// POST /api/ad-approvals — create a new draft ad owned by the actor.
export async function POST(req: Request) {
  const auth = await authorizePermission(req, PERMISSIONS.AD_APPROVAL_SUBMIT);
  if (!auth.allowed) {
    await auditDenied(auth.actor ?? "anonymous", "create_draft", "new", "missing_permission");
    return auth.response;
  }
  const actor = auth.actor;

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("Invalid input", parsed.error.flatten());

  try {
    const approval = await prisma.adApproval.create({
      data: {
        campaignId: parsed.data.campaignId,
        submitterId: actor,
        status: STATUS.DRAFT,
        stage: STAGE.PRE_REVIEW,
        draftCopy: parsed.data.copy as object,
        draftCreative: parsed.data.creative as object,
      },
    });
    await prisma.auditLog.create({
      data: { actor, action: "DRAFT_CREATED", entityType: "ad_approval", entityId: approval.id, after: { status: STATUS.DRAFT } },
    });
    return NextResponse.json({ approval }, { status: 201 });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return conflict("A campaign with this ID already exists");
    }
    console.error("[ad-approvals] create error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
