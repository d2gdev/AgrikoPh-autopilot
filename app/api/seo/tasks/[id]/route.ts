export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  getSessionUser,
  PERMISSIONS,
  requireAppAuth,
  requirePermission,
} from "@/lib/auth";
import { SeoTaskMutationSchema } from "@/lib/seo-tasks/contracts";
import {
  getSeoTaskDetail,
  mutateSeoTask,
} from "@/lib/seo-tasks/service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: RouteContext) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const { id } = await context.params;
  if (!id || id.length > 200) {
    return NextResponse.json({ error: "Invalid SEO task ID." }, { status: 400 });
  }
  try {
    const detail = await getSeoTaskDetail(id);
    if (!detail) return NextResponse.json({ error: "SEO task not found." }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    console.error("[seo-tasks] detail failed", error);
    return NextResponse.json({ error: "SEO task detail is unavailable." }, { status: 500 });
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const parsed = SeoTaskMutationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid SEO task action." }, { status: 400 });
  }
  const { id } = await context.params;
  if (!id || id.length > 200) {
    return NextResponse.json({ error: "Invalid SEO task ID." }, { status: 400 });
  }
  const actor = (await getSessionUser(req)) ?? "authenticated-operator";
  try {
    const result = await mutateSeoTask(id, parsed.data, actor, new Date());
    if (result.outcome === "not_found") {
      return NextResponse.json({ error: "SEO task not found." }, { status: 404 });
    }
    if (result.outcome === "conflict") {
      return NextResponse.json({
        error: "This SEO task changed after it was loaded. Refresh and try again.",
      }, { status: 409 });
    }
    if (result.outcome === "invalid_transition") {
      return NextResponse.json({ error: result.message }, { status: 409 });
    }
    return NextResponse.json({ task: result.task });
  } catch (error) {
    console.error("[seo-tasks] update failed", error);
    return NextResponse.json({ error: "SEO task update failed." }, { status: 500 });
  }
}
