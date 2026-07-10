import { shopifyApi, ApiVersion } from "@shopify/shopify-api";
import "@shopify/shopify-api/adapters/node";

// Lazy-initialised — avoids build failure when env vars are absent at compile time.
// Embedded App Bridge session tokens can be verified with a different Shopify
// app credential pair than the Admin API token-refresh app when a store has
// migrated apps. Default to the legacy single-pair setup.
let _shopify: ReturnType<typeof shopifyApi> | null = null;
let _shopifyCredentialKey: string | null = null;

function normalizeShopDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const withScheme = value.includes("://") ? value : `https://${value}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return value
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      ?.toLowerCase() || null;
  }
}

function expectedShopDomain(): string | null {
  return normalizeShopDomain(process.env.SHOPIFY_STORE_DOMAIN);
}

function sessionApiKey() {
  return process.env.SHOPIFY_SESSION_API_KEY ?? process.env.SHOPIFY_API_KEY;
}

function sessionApiSecret() {
  return process.env.SHOPIFY_SESSION_API_SECRET ?? process.env.SHOPIFY_API_SECRET;
}

function getShopify() {
  const credentialKey = `${sessionApiKey() ?? ""}:${sessionApiSecret() ? "set" : "missing"}`;
  if (!_shopify || _shopifyCredentialKey !== credentialKey) {
    _shopify = shopifyApi({
      apiKey: sessionApiKey()!,
      apiSecretKey: sessionApiSecret()!,
      scopes: (process.env.SCOPES ?? "read_orders,read_products,read_analytics,read_reports,read_customers").split(","),
      hostName: (process.env.SHOPIFY_APP_URL ?? "http://localhost:3000").replace(/https?:\/\//, ""),
      apiVersion: ApiVersion.April26,
      isEmbeddedApp: true,
    });
    _shopifyCredentialKey = credentialKey;
  }
  return _shopify;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function publicTokenMetadata(token: string) {
  const payload = decodeJwtPayload(token);
  return {
    aud: typeof payload?.aud === "string" ? payload.aud : null,
    dest: typeof payload?.dest === "string" ? normalizeShopDomain(payload.dest) : null,
    iss: typeof payload?.iss === "string" ? payload.iss : null,
    exp: typeof payload?.exp === "number" ? payload.exp : null,
    configuredAud: sessionApiKey() ?? null,
  };
}

function sessionTokenErrorReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("signature verification failed")) return "signature verification failed";
  if (message.includes("Invalid audience") || message.includes("audience")) return "audience mismatch";
  if (message.includes("expired")) return "token expired";
  if (message.includes("nbf")) return "token not active";
  return "session token verification failed";
}

// Verify App Bridge session token on API routes.
// Returns the shop domain on success, null on failure.
export async function verifySessionToken(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const payload = await getShopify().session.decodeSessionToken(token);
    const shop = normalizeShopDomain(payload.dest as string);
    const expectedShop = expectedShopDomain();
    if (!shop || !expectedShop || shop !== expectedShop) {
      console.warn("[shopify] Session token shop mismatch", { shop, expectedShop });
      return null;
    }
    return shop;
  } catch (err) {
    console.error("[shopify] Session token verification failed", {
      reason: sessionTokenErrorReason(err),
      token: publicTokenMetadata(token),
    });
    return null;
  }
}

// Returns the Shopify user ID (JWT sub) from the App Bridge session token.
// Falls back to dest (shop domain) if sub is absent (older tokens).
export async function decodeSessionUser(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const token = authHeader.slice(7);
    const payload = await getShopify().session.decodeSessionToken(token);
    const shop = normalizeShopDomain(payload.dest as string);
    const expectedShop = expectedShopDomain();
    if (!shop || !expectedShop || shop !== expectedShop) return null;
    return (payload.sub as string) ?? shop;
  } catch {
    return null;
  }
}
