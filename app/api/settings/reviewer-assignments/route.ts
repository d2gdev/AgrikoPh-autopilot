export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, PERMISSIONS } from "@/lib/auth";
import { REQUIRED_ROLES } from "@/lib/ad-approval/reviewers";

// GET /api/settings/reviewer-assignments — the three roles with current holders
// and (best-effort) display names. Admin only.
export async function GET(req: Request) {
  const denied = await requirePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (denied) return denied;

  const rows = await prisma.reviewerAssignment.findMany();
  const byRole = new Map(rows.map((r) => [r.role, r]));

  // Resolve display names for assigned + backup users.
  const userIds = new Set<string>();
  for (const r of rows) {
    userIds.add(r.assignedUserId);
    if (r.backupUserId) userIds.add(r.backupUserId);
  }
  const users = await prisma.appUser.findMany({ where: { shopifyUserId: { in: [...userIds] } } });
  const nameOf = (uid: string | null | undefined) =>
    uid ? users.find((u) => u.shopifyUserId === uid)?.displayName || uid : null;

  const assignments = REQUIRED_ROLES.map((role) => {
    const row = byRole.get(role);
    return {
      role,
      assignedUserId: row?.assignedUserId ?? null,
      assignedUserName: nameOf(row?.assignedUserId),
      backupUserId: row?.backupUserId ?? null,
      backupUserName: nameOf(row?.backupUserId ?? null),
      configured: Boolean(row?.assignedUserId),
    };
  });

  return NextResponse.json({ assignments });
}
