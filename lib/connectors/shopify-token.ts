import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

let _refreshInFlight: Promise<string> | null = null;

export async function refreshAndStoreShopifyToken(): Promise<string> {
  // Deduplicate concurrent refresh attempts
  if (_refreshInFlight) return _refreshInFlight;

  _refreshInFlight = (async () => {
    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const apiKey = process.env.SHOPIFY_API_KEY;
    const apiSecret = process.env.SHOPIFY_API_SECRET;

    if (!storeDomain || !apiKey || !apiSecret) {
      throw new Error("SHOPIFY_STORE_DOMAIN, SHOPIFY_API_KEY, and SHOPIFY_API_SECRET are required to refresh the admin token");
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: apiKey,
      client_secret: apiSecret,
    }).toString();

    const res = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    const json = await res.json() as { access_token?: string; errors?: string };
    if (!json.access_token) {
      throw new Error(`Shopify token refresh failed: ${JSON.stringify(json)}`);
    }

    const newToken = json.access_token;

    // Persist to ApiCredential so the resolver reads the fresh value on next call
    await prisma.apiCredential.upsert({
      where: { key: "SHOPIFY_ADMIN_ACCESS_TOKEN" },
      create: { key: "SHOPIFY_ADMIN_ACCESS_TOKEN", value: encrypt(newToken), updatedBy: "system" },
      update: { value: encrypt(newToken), updatedBy: "system" },
    });

    console.log("[shopify-token] Token refreshed and stored in ApiCredential");
    return newToken;
  })().finally(() => { _refreshInFlight = null; });

  return _refreshInFlight;
}
