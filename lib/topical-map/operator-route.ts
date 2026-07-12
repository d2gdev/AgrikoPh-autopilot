import { NextResponse } from "next/server";
import { CompilationContractIntegrityError } from "@/lib/topical-map/contract-integrity";
import { StrategyActivationConflictError } from "@/lib/topical-map/activation";
import { StrategyPackageError } from "@/lib/topical-map/manifest";
import { CompilationContractError, GovernedUrlError, SourceLocatorError, StrategyCompilerError } from "@/lib/topical-map/types";

const MAX_REASON_LENGTH = 500;

export function safeTopicalMapError(error: unknown): NextResponse {
  if (error instanceof StrategyActivationConflictError) {
    return NextResponse.json({ error: "Strategy lifecycle conflict." }, { status: 409 });
  }
  if (
    error instanceof StrategyPackageError
    || error instanceof CompilationContractError
    || error instanceof CompilationContractIntegrityError
    || error instanceof SourceLocatorError
    || error instanceof GovernedUrlError
    || error instanceof StrategyCompilerError
  ) {
    return NextResponse.json({ error: "Invalid strategy package.", code: error.code }, { status: 422 });
  }
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}

export async function optionalReason(req: Request): Promise<{ reason?: string } | NextResponse> {
  const text = await req.text().catch(() => null);
  if (text === null || text.trim() === "") return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const values = Object.entries(body as Record<string, unknown>);
  if (values.some(([key]) => key !== "reason")) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const reason = (body as { reason?: unknown }).reason;
  if (reason !== undefined && (typeof reason !== "string" || reason.trim().length === 0 || reason.length > MAX_REASON_LENGTH)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  return reason === undefined ? {} : { reason };
}
