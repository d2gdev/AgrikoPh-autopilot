import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { verifySessionToken, decodeSessionUser } from "@/lib/shopify";

export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard:view",
  JOBS_RUN: "jobs:run",
  RECOMMENDATIONS_REVIEW: "recommendations:review",
  RECOMMENDATIONS_OVERRIDE: "recommendations:override",
  SETTINGS_ADMIN: "settings:admin",
  CONTENT_REVIEW: "content:review",
  CONTENT_PUBLISH: "content:publish",
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

type PermissionDecision =
  | { allowed: true; actor: string; permission: Permission }
  | { allowed: false; actor: string | null; permission: Permission; response: NextResponse };

const API_KEY_ACTOR = "api-key";
const PERMISSION_ENV: Record<Permission, string> = {
  [PERMISSIONS.DASHBOARD_VIEW]: "AUTOPILOT_DASHBOARD_VIEW_ACTORS",
  [PERMISSIONS.JOBS_RUN]: "AUTOPILOT_JOBS_RUN_ACTORS",
  [PERMISSIONS.RECOMMENDATIONS_REVIEW]: "AUTOPILOT_RECOMMENDATIONS_REVIEW_ACTORS",
  [PERMISSIONS.RECOMMENDATIONS_OVERRIDE]: "AUTOPILOT_RECOMMENDATIONS_OVERRIDE_ACTORS",
  [PERMISSIONS.SETTINGS_ADMIN]: "AUTOPILOT_SETTINGS_ADMIN_ACTORS",
  [PERMISSIONS.CONTENT_REVIEW]: "AUTOPILOT_CONTENT_REVIEW_ACTORS",
  [PERMISSIONS.CONTENT_PUBLISH]: "AUTOPILOT_CONTENT_PUBLISH_ACTORS",
};

// Constant-time check of the private-tool X-Autopilot-Api-Key header against
// AUTOPILOT_API_KEY. This is intentionally separate from requireAppAuth so
// browser routes do not inherit server-to-server API-key access implicitly.
function apiKeyMatches(request: Request): boolean {
  const apiKey = request.headers.get("x-autopilot-api-key");
  const expectedKey = process.env.AUTOPILOT_API_KEY;
  if (!apiKey || !expectedKey) return false;
  const received = Buffer.from(apiKey);
  const expected = Buffer.from(expectedKey);
  // Length must match for timingSafeEqual (it throws on unequal lengths).
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function parseActorList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function actorHasPermission(actor: string, permission: Permission): boolean {
  if (actor === API_KEY_ACTOR) return true;

  const admins = parseActorList(process.env.AUTOPILOT_ADMIN_ACTORS);
  if (admins.has(actor) || admins.has("*")) return true;

  const allowed = parseActorList(process.env[PERMISSION_ENV[permission]]);
  return allowed.has(actor) || allowed.has("*");
}

async function getAuthenticatedActor(request: Request): Promise<string | null> {
  if (apiKeyMatches(request)) return API_KEY_ACTOR;

  const shop = await verifySessionToken(request);
  if (!shop) return null;

  return (await decodeSessionUser(request)) ?? shop;
}

// Guards embedded app API routes — verifies Shopify App Bridge session token.
// Returns a 401 NextResponse if unauthorized, or null if the request is valid.
export async function requireAppAuth(request: Request): Promise<NextResponse | null> {
  const shop = await verifySessionToken(request);
  if (!shop) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// Explicit server-only auth path for direct/scripted access.
export function requirePrivateApiKeyAuth(request: Request): NextResponse | null {
  if (apiKeyMatches(request)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function authorizePermission(
  request: Request,
  permission: Permission,
): Promise<PermissionDecision> {
  const actor = await getAuthenticatedActor(request);
  if (!actor) {
    return {
      allowed: false,
      actor: null,
      permission,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!actorHasPermission(actor, permission)) {
    return {
      allowed: false,
      actor,
      permission,
      response: NextResponse.json({ error: "Forbidden", permission }, { status: 403 }),
    };
  }

  return { allowed: true, actor, permission };
}

export async function requirePermission(
  request: Request,
  permission: Permission,
): Promise<NextResponse | null> {
  const decision = await authorizePermission(request, permission);
  return decision.allowed ? null : decision.response;
}

// Returns the verified shop domain from the session token.
export async function getSessionShop(request: Request): Promise<string | null> {
  return verifySessionToken(request);
}

// Returns the Shopify user ID (JWT sub) for actor attribution in audit logs.
// Falls back to shop domain if sub is absent. Explicit private API-key requests
// use a stable actor for audit logs.
export async function getSessionUser(request: Request): Promise<string | null> {
  if (apiKeyMatches(request)) return API_KEY_ACTOR;
  return decodeSessionUser(request);
}

// Guards cron routes — verifies Bearer $CRON_SECRET header.
// Fails closed: if CRON_SECRET is not set in production, all requests are rejected.
export function requireCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const isLocalDev = process.env.NODE_ENV === "development" &&
    !(process.env.DATABASE_URL ?? "").includes("neon.tech");
  if (!secret) {
    if (isLocalDev) return null;
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authHeader ?? "");
  // Removed early-exit length pre-check: it leaked timing info about secret length.
  // Instead pad both buffers to equal length so timingSafeEqual can always run.
  // Length XOR is evaluated without short-circuit, then folded into the result.
  const len = Math.max(expected.length, received.length);
  const a = Buffer.concat([expected, Buffer.alloc(len - expected.length)]);
  const b = Buffer.concat([received, Buffer.alloc(len - received.length)]);
  const lengthMatch = (expected.length ^ received.length) === 0;
  if (!lengthMatch || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
