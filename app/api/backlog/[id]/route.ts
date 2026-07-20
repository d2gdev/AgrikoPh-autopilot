export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  getSessionUser,
  PERMISSIONS,
  requireAppAuth,
  requirePermission,
} from "@/lib/auth";
import {
  BacklogItemMutationSchema,
  DeleteBacklogItemSchema,
} from "@/lib/backlog/contracts";
import {
  deleteBacklogItem,
  mutateBacklogItem,
} from "@/lib/backlog/service";

type RouteContext = { params: Promise<{ id: string }> };

function validId(id: string): boolean {
  return id.length > 0 && id.length <= 200;
}

function mutationResponse(
  result: Awaited<ReturnType<typeof mutateBacklogItem>>,
) {
  if (result.outcome === "not_found") {
    return NextResponse.json(
      { error: "Backlog item not found." },
      { status: 404 },
    );
  }
  if (result.outcome === "conflict") {
    return NextResponse.json(
      { error: "This backlog item changed. Refresh and try again." },
      { status: 409 },
    );
  }
  if (result.outcome === "invalid_transition") {
    return NextResponse.json(
      { error: result.message },
      { status: 409 },
    );
  }
  return NextResponse.json({ item: result.item });
}

export async function PATCH(req: Request, context: RouteContext) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(
    req,
    PERMISSIONS.CONTENT_REVIEW,
  );
  if (permissionError) return permissionError;

  const parsed = BacklogItemMutationSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid backlog action." },
      { status: 400 },
    );
  }
  const { id } = await context.params;
  if (!validId(id)) {
    return NextResponse.json(
      { error: "Invalid backlog item ID." },
      { status: 400 },
    );
  }
  const actor = (await getSessionUser(req)) ?? "authenticated-operator";
  try {
    return mutationResponse(
      await mutateBacklogItem(id, parsed.data, actor, new Date()),
    );
  } catch (error) {
    console.error("[backlog] update failed", error);
    return NextResponse.json(
      { error: "Backlog item update failed." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(
    req,
    PERMISSIONS.CONTENT_REVIEW,
  );
  if (permissionError) return permissionError;

  const parsed = DeleteBacklogItemSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid backlog delete request." },
      { status: 400 },
    );
  }
  const { id } = await context.params;
  if (!validId(id)) {
    return NextResponse.json(
      { error: "Invalid backlog item ID." },
      { status: 400 },
    );
  }
  const actor = (await getSessionUser(req)) ?? "authenticated-operator";
  try {
    const result = await deleteBacklogItem(
      id,
      parsed.data.expectedVersion,
      actor,
    );
    if (result.outcome === "not_found") {
      return NextResponse.json(
        { error: "Backlog item not found." },
        { status: 404 },
      );
    }
    if (result.outcome === "conflict") {
      return NextResponse.json(
        { error: "This backlog item changed. Refresh and try again." },
        { status: 409 },
      );
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("[backlog] delete failed", error);
    return NextResponse.json(
      { error: "Backlog item deletion failed." },
      { status: 500 },
    );
  }
}
