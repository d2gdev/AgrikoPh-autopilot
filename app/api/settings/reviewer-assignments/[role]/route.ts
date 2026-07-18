export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizePermission, PERMISSIONS, requireAppAuth } from "@/lib/auth";
import { REVIEWER_ROLE } from "@/lib/ad-approval/constants";

const ROLES = new Set<string>(Object.values(REVIEWER_ROLE));

// assigned_user_id is required — a null/empty value is an unassign attempt,
// which is rejected (spec §Role Requirement Enforcement: roles must always be
// assigned; use reassignment to change them).
const schema = z.object({
  assigned_user_id: z.string().min(1),
  backup_user_id: z.string().min(1).nullable().optional(),
});

// PUT /api/settings/reviewer-assignments/[role] — (re)assign a reviewer role.
export async function PUT(req: Request, { params }: { params: Promise<{ role: string }> }) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const auth = await authorizePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (!auth.allowed) return auth.response;
  const { role } = await params;

  if (!ROLES.has(role)) {
    return NextResponse.json({ error: "Unknown role" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  // Explicit unassign attempt -> 400 (roles must always be assigned).
  if (body && "assigned_user_id" in body && !body.assigned_user_id) {
    const current = await prisma.reviewerAssignment.findUnique({ where: { role } });
    return NextResponse.json(
      {
        error: "Cannot unassign role. All reviewer roles must be assigned at all times.",
        current_assignment: current
          ? { role, assigned_user_id: current.assignedUserId }
          : { role, assigned_user_id: null },
      },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  // A backup identical to the assignee silently disables SLA escalation
  // (reassignToBackup requires backup !== current assignee) — reject it here.
  if (parsed.data.backup_user_id && parsed.data.backup_user_id === parsed.data.assigned_user_id) {
    return NextResponse.json(
      { error: "Backup user must be different from the assigned user." },
      { status: 400 },
    );
  }

  const previous = await prisma.reviewerAssignment.findUnique({ where: { role } });

  const row = await prisma.reviewerAssignment.upsert({
    where: { role },
    create: {
      role,
      assignedUserId: parsed.data.assigned_user_id,
      backupUserId: parsed.data.backup_user_id ?? null,
      updatedBy: auth.actor,
    },
    update: {
      assignedUserId: parsed.data.assigned_user_id,
      backupUserId: parsed.data.backup_user_id ?? null,
      updatedBy: auth.actor,
    },
  });

  await prisma.auditLog.create({
    data: {
      actor: auth.actor,
      action: "REVIEWER_REASSIGNED",
      entityType: "reviewer_assignment",
      entityId: role,
      before: previous ? { assignedUserId: previous.assignedUserId, backupUserId: previous.backupUserId } : {},
      after: { assignedUserId: row.assignedUserId, backupUserId: row.backupUserId },
    },
  });

  return NextResponse.json({
    role,
    previous_user: previous?.assignedUserId ?? null,
    new_user: row.assignedUserId,
    backup_user: row.backupUserId,
    effective_immediately: true,
    note: "Reassignment is effective immediately. In-progress approvals stay with the previous reviewer; future approvals use the new assignment.",
  });
}
