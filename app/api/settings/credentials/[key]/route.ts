export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";

const UpdateInput = z.object({
  value: z.string().min(1).max(5000),
});

// PUT — update value
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const authError = await requirePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (authError) return authError;
  const { key } = await params;
  const actor = (await getSessionUser(req)) ?? "operator";

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.apiCredential.findUnique({ where: { key } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const credential = await prisma.apiCredential.update({
    where: { key },
    data: { value: encrypt(parsed.data.value), updatedBy: actor },
    select: { key: true, updatedAt: true, updatedBy: true },
  });

  return NextResponse.json({ credential });
}

// DELETE — remove credential
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const authError = await requirePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (authError) return authError;
  const { key } = await params;

  const existing = await prisma.apiCredential.findUnique({ where: { key } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.apiCredential.delete({ where: { key } });

  return NextResponse.json({ deleted: true });
}

// GET — return masked value only (never decrypt in GET)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const authError = await requirePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (authError) return authError;
  const { key } = await params;
  const cred = await prisma.apiCredential.findUnique({ where: { key } });
  if (!cred) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Return masked value only — never decrypt in GET
  return NextResponse.json({ key: cred.key, masked: "••••••••", updatedAt: cred.updatedAt });
}
