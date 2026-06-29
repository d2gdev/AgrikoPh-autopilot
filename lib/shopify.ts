import { shopifyApi, ApiVersion } from "@shopify/shopify-api";
import "@shopify/shopify-api/adapters/node";

// Lazy-initialised — avoids build failure when env vars are absent at compile time
let _shopify: ReturnType<typeof shopifyApi> | null = null;

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

function getShopify() {
  if (!_shopify) {
    _shopify = shopifyApi({
      apiKey: process.env.SHOPIFY_API_KEY!,
      apiSecretKey: process.env.SHOPIFY_API_SECRET!,
      scopes: (process.env.SCOPES ?? "read_orders,read_products,read_analytics,read_reports,read_customers").split(","),
      hostName: (process.env.SHOPIFY_APP_URL ?? "http://localhost:3000").replace(/https?:\/\//, ""),
      apiVersion: ApiVersion.April26,
      isEmbeddedApp: true,
    });
  }
  return _shopify;
}

// Verify App Bridge session token on API routes.
// Returns the shop domain on success, null on failure.
export async function verifySessionToken(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const token = authHeader.slice(7);
    const payload = await getShopify().session.decodeSessionToken(token);
    const shop = normalizeShopDomain(payload.dest as string);
    const expectedShop = expectedShopDomain();
    if (!shop || !expectedShop || shop !== expectedShop) {
      console.warn("[shopify] Session token shop mismatch", { shop, expectedShop });
      return null;
    }
    return shop;
  } catch (err) {
    console.error("[shopify] Session token verification failed:", (err as Error)?.message ?? err);
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
