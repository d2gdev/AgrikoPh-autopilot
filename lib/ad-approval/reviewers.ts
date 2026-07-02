// Reviewer role lookup. Reads the centralized ReviewerAssignment table (one
// row per role). Values are Shopify user-id strings. See spec §Reviewer Assignment.

import { prisma } from "@/lib/db";
import { REVIEWER_ROLE, type ReviewerRole } from "./constants";

export interface RoleAssignment {
  assignedUserId: string;
  backupUserId: string | null;
}

export type ReviewerMap = Partial<Record<ReviewerRole, RoleAssignment>>;

export async function getReviewerAssignments(): Promise<ReviewerMap> {
  const rows = await prisma.reviewerAssignment.findMany();
  const map: ReviewerMap = {};
  for (const row of rows) {
    map[row.role as ReviewerRole] = {
      assignedUserId: row.assignedUserId,
      backupUserId: row.backupUserId ?? null,
    };
  }
  return map;
}

export async function getRole(role: ReviewerRole): Promise<RoleAssignment | null> {
  const row = await prisma.reviewerAssignment.findUnique({ where: { role } });
  if (!row) return null;
  return { assignedUserId: row.assignedUserId, backupUserId: row.backupUserId ?? null };
}

export const REQUIRED_ROLES: ReviewerRole[] = [
  REVIEWER_ROLE.CONVERSION_REVIEWER,
  REVIEWER_ROLE.PENULTIMATE_APPROVER,
  REVIEWER_ROLE.FINAL_APPROVER,
];
