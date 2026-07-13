import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { toStoreTaskDetailDto } from "@/lib/store-tasks/dto";

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const { id } = await context.params;
  const task = await prisma.storeTask.findUnique({
    where: { id },
    select: { id: true, targetUrl: true, proposedState: true, sourceData: true, status: true, completionNote: true },
  });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try { return NextResponse.json({ task: toStoreTaskDetailDto(task) }); }
  catch { return NextResponse.json({ error: "Task detail is unavailable." }, { status: 422 }); }
}
