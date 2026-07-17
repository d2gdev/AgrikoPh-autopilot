export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  getSessionUser,
  PERMISSIONS,
  requireAppAuth,
  requirePermission,
} from "@/lib/auth";
import {
  CreateSeoTaskSchema,
  SeoTaskListQuerySchema,
} from "@/lib/seo-tasks/contracts";
import {
  createSeoTask,
  listSeoTasks,
} from "@/lib/seo-tasks/service";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const searchParams = new URL(req.url).searchParams;
  const parsed = SeoTaskListQuerySchema.safeParse({
    bucket: searchParams.get("bucket") ?? undefined,
    priority: searchParams.get("priority") ?? undefined,
    taskType: searchParams.get("taskType") ?? undefined,
    q: searchParams.get("q") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid SEO task query." }, { status: 400 });
  }
  try {
    return NextResponse.json(await listSeoTasks(parsed.data, new Date()));
  } catch (error) {
    console.error("[seo-tasks] list failed", error);
    return NextResponse.json({ error: "SEO tasks are unavailable." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const parsed = CreateSeoTaskSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid SEO task." }, { status: 400 });
  }
  const actor = (await getSessionUser(req)) ?? "authenticated-operator";
  try {
    const result = await createSeoTask(parsed.data, actor);
    if (result.outcome === "duplicate") {
      return NextResponse.json({
        error: "An SEO task with the same identity already exists.",
        existingId: result.existingId,
      }, { status: 409 });
    }
    return NextResponse.json({ task: result.task }, { status: 201 });
  } catch (error) {
    console.error("[seo-tasks] create failed", error);
    return NextResponse.json({ error: "SEO task creation failed." }, { status: 500 });
  }
}

