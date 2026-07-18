export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";

const CreateInput = z.object({
  key: z.string().min(1).max(100).regex(/^[A-Z0-9_]+$/, "Key must be uppercase letters, digits, and underscores only"),
  value: z.string().min(1).max(5000),
});

// GET — list credential keys (never values)
export async function GET(req: NextRequest) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const authError = await requirePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (authError) return authError;

  const credentials = await prisma.apiCredential.findMany({
    select: { key: true, updatedAt: true, updatedBy: true },
    orderBy: { key: "asc" },
  });

  return NextResponse.json({ credentials });
}

// POST — create or update a credential
export async function POST(req: NextRequest) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const authError = await requirePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (authError) return authError;
  const actor = (await getSessionUser(req)) ?? "operator";

  const body = await req.json().catch(() => ({}));
  const parsed = CreateInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { key, value } = parsed.data;

  const existing = await prisma.apiCredential.findUnique({ where: { key } });

  const credential = await prisma.apiCredential.upsert({
    where: { key },
    create: { key, value: encrypt(value), updatedBy: actor },
    update: { value: encrypt(value), updatedBy: actor },
    select: { key: true, updatedAt: true, updatedBy: true },
  });

  return NextResponse.json({ credential }, { status: existing ? 200 : 201 });
}
