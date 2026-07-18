export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, authorizePermission, PERMISSIONS, requireAppAuth } from "@/lib/auth";

// GET /api/app-users — roster of people who have used the app, for the reviewer
// assignment dropdowns. Admin only.
export async function GET(req: Request) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const denied = await requirePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (denied) return denied;

  const users = await prisma.appUser.findMany({ orderBy: { lastSeenAt: "desc" }, take: 200 });
  return NextResponse.json({
    users: users.map((u) => ({
      shopifyUserId: u.shopifyUserId,
      displayName: u.displayName,
      email: u.email,
      lastSeenAt: u.lastSeenAt,
    })),
  });
}

const patchSchema = z.object({
  shopifyUserId: z.string().min(1),
  displayName: z.string().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
});

// PATCH /api/app-users — set a friendly display name / email for a user so they
// are recognizable in the assignment dropdowns. Admin only.
export async function PATCH(req: Request) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const auth = await authorizePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (!auth.allowed) return auth.response;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  const user = await prisma.appUser.update({
    where: { shopifyUserId: parsed.data.shopifyUserId },
    data: {
      ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
      ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
    },
  }).catch(() => null);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({ ok: true, user: { shopifyUserId: user.shopifyUserId, displayName: user.displayName, email: user.email } });
}
