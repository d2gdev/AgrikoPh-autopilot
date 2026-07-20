export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  getSessionUser,
  PERMISSIONS,
  requireAppAuth,
  requirePermission,
} from "@/lib/auth";
import {
  BacklogListQuerySchema,
  CreateBacklogItemSchema,
} from "@/lib/backlog/contracts";
import {
  createBacklogItem,
  listBacklogItems,
} from "@/lib/backlog/service";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const parsed = BacklogListQuerySchema.safeParse({
    status: new URL(req.url).searchParams.get("status") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid backlog query." },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(
      await listBacklogItems(parsed.data, new Date()),
    );
  } catch (error) {
    console.error("[backlog] list failed", error);
    return NextResponse.json(
      { error: "Backlog is unavailable." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(
    req,
    PERMISSIONS.CONTENT_REVIEW,
  );
  if (permissionError) return permissionError;

  const parsed = CreateBacklogItemSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A title, description, and due date are required." },
      { status: 400 },
    );
  }
  const actor = (await getSessionUser(req)) ?? "authenticated-operator";
  try {
    const item = await createBacklogItem(parsed.data, actor);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    console.error("[backlog] create failed", error);
    return NextResponse.json(
      { error: "Backlog item creation failed." },
      { status: 500 },
    );
  }
}
