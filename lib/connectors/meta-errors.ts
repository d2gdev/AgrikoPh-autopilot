export type MetaErrorScope = "global" | "row" | "transient" | "unknown";

type MetaApiErrorInput = {
  httpStatus: number;
  message: string;
  type?: string | null;
  code?: number | null;
  subcode?: number | null;
  isTransient?: boolean | null;
  fbtraceId?: string | null;
  rawBody?: string | null;
};

export class MetaApiError extends Error {
  readonly httpStatus: number;
  readonly type: string | null;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly isTransient: boolean | null;
  readonly fbtraceId: string | null;
  readonly rawBody: string | null;

  constructor(input: MetaApiErrorInput) {
    super(input.message);
    this.name = "MetaApiError";
    this.httpStatus = input.httpStatus;
    this.type = input.type ?? null;
    this.code = input.code ?? null;
    this.subcode = input.subcode ?? null;
    this.isTransient = input.isTransient ?? null;
    this.fbtraceId = input.fbtraceId ?? null;
    this.rawBody = input.rawBody ?? null;
  }
}

export function parseMetaApiError(httpStatus: number, body: string): MetaApiError {
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        is_transient?: boolean;
        fbtrace_id?: string;
      };
    };
    const error = parsed.error ?? {};
    return new MetaApiError({
      httpStatus,
      message: error.message ? `Meta API error ${httpStatus}: ${error.message}` : `Meta API error ${httpStatus}`,
      type: error.type,
      code: error.code,
      subcode: error.error_subcode,
      isTransient: error.is_transient,
      fbtraceId: error.fbtrace_id,
      rawBody: body,
    });
  } catch {
    return new MetaApiError({
      httpStatus,
      message: `Meta API error ${httpStatus}: ${body}`,
      rawBody: body,
    });
  }
}

export function classifyMetaError(err: unknown): MetaErrorScope {
  if (!(err instanceof MetaApiError)) return "unknown";
  if (err.isTransient === true || err.httpStatus >= 500 || err.code === 613 || err.code === 80004) return "transient";
  if (err.code === 190 || err.code === 463 || err.code === 200) return "global";

  const message = err.message.toLowerCase();
  if (
    message.includes("not writable") ||
    message.includes("permission") ||
    message.includes("access token") ||
    message.includes("session") ||
    message.includes("account status") ||
    message.includes("ad account")
  ) {
    return "global";
  }

  if (err.httpStatus === 400 && err.isTransient === false) return "row";
  return "unknown";
}

export function serializableMetaError(err: unknown): Record<string, unknown> | null {
  if (!(err instanceof MetaApiError)) return null;
  return {
    name: err.name,
    message: err.message,
    httpStatus: err.httpStatus,
    type: err.type,
    code: err.code,
    subcode: err.subcode,
    isTransient: err.isTransient,
    fbtraceId: err.fbtraceId,
    scope: classifyMetaError(err),
  };
}
