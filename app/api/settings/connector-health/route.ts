export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSessionShop } from "@/lib/auth";
import { getConnectorHealth } from "@/lib/config/connector-health";

type ConnectorHealthPayload = {
  connectors: Awaited<ReturnType<typeof getConnectorHealth>>;
  cachedAt: string;
  cacheTtlMs: number;
};

const CONNECTOR_HEALTH_CACHE_TTL_MS = 60_000;

let connectorHealthCache: { expiresAt: number; payload: ConnectorHealthPayload } | null = null;
let connectorHealthInFlight: Promise<ConnectorHealthPayload> | null = null;

async function loadConnectorHealthPayload(forceRefresh: boolean): Promise<ConnectorHealthPayload> {
  const now = Date.now();
  if (!forceRefresh && connectorHealthCache && connectorHealthCache.expiresAt > now) {
    return connectorHealthCache.payload;
  }
  if (!forceRefresh && connectorHealthInFlight) return connectorHealthInFlight;

  const request = (async () => {
    const payload: ConnectorHealthPayload = {
      connectors: await getConnectorHealth(),
      cachedAt: new Date().toISOString(),
      cacheTtlMs: CONNECTOR_HEALTH_CACHE_TTL_MS,
    };
    connectorHealthCache = { expiresAt: Date.now() + CONNECTOR_HEALTH_CACHE_TTL_MS, payload };
    return payload;
  })();

  connectorHealthInFlight = request;
  try {
    return await request;
  } finally {
    if (connectorHealthInFlight === request) connectorHealthInFlight = null;
  }
}

export async function GET(req: Request) {
  const actor = await getSessionShop(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const forceRefresh = new URL(req.url).searchParams.get("refresh") === "1";
    return NextResponse.json(await loadConnectorHealthPayload(forceRefresh));
  } catch (err) {
    console.error("[settings/connector-health] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
