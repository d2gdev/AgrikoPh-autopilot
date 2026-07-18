export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAppAuth, getSessionShop, getSessionUser, PERMISSIONS, requirePermission } from "@/lib/auth";

const GUARDRAIL_DEFAULTS = [
  { key: "HARD_BLOCK_BID_CHANGE_PCT", value: "50", label: "Max bid change % (hard block)", valueType: "number" },
  { key: "HARD_BLOCK_BUDGET_CHANGE_PCT", value: "200", label: "Max budget change % (hard block)", valueType: "number" },
  { key: "HARD_BLOCK_MIN_CONVERSIONS", value: "10", label: "Min conversions required (hard block)", valueType: "number" },
  { key: "HARD_BLOCK_PAUSE_DAILY_BUDGET", value: "10000", label: "Pause campaign if daily budget exceeds ₱ (hard block)", valueType: "currency" },
  { key: "SOFT_FLAG_CHANGE_PCT", value: "30", label: "Change % triggers soft flag warning", valueType: "number" },
  { key: "SOFT_FLAG_PAUSE_DAILY_BUDGET", value: "200", label: "Pause campaign if daily budget exceeds ₱ (soft flag)", valueType: "currency" },
  { key: "SOFT_FLAG_MIN_CONFIDENCE", value: "0.5", label: "Min confidence score (below = soft flag)", valueType: "number" },
];

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const count = await prisma.guardrailConfig.count();
  if (count === 0) {
    await prisma.guardrailConfig.createMany({ data: GUARDRAIL_DEFAULTS });
  }
  const guardrails = await prisma.guardrailConfig.findMany({ orderBy: { key: "asc" } });
  return NextResponse.json({ guardrails });
}

const VALID_KEYS = new Set(GUARDRAIL_DEFAULTS.map((d) => d.key));

const GuardrailUpdateSchema = z.object({
  guardrails: z.array(
    z.object({
      key: z.string().refine((k) => VALID_KEYS.has(k), { message: "Unknown guardrail key" }),
      value: z.string().regex(/^\d+(\.\d+)?$/, "Value must be a positive number"),
    })
  ).min(1),
});

export async function PUT(req: NextRequest) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const authError = await requirePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (authError) return authError;

  const updatedBy = await getSessionUser(req) ?? "unknown";
  const actor = await getSessionShop(req) ?? updatedBy;

  const body = await req.json().catch(() => ({}));
  const parsed = GuardrailUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { guardrails } = parsed.data;

  await Promise.all(
    guardrails.map((g) =>
      prisma.guardrailConfig.update({
        where: { key: g.key },
        data: { value: g.value, updatedAt: new Date(), updatedBy },
      })
    )
  );

  await prisma.auditLog.create({
    data: {
      actor,
      action: "settings_changed",
      entityType: "settings",
      entityId: "guardrails",
      after: { guardrails },
    },
  });

  return NextResponse.json({ ok: true });
}
