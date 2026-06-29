import { NextResponse } from "next/server";

// Private app — no OAuth flow needed. Shopify will install via the partner dashboard.
// This route exists only to satisfy App Bridge's expected auth path.
export async function GET() {
  if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_API_KEY) {
    console.error("[auth] SHOPIFY_STORE_DOMAIN or SHOPIFY_API_KEY is not set");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const apiKey = process.env.SHOPIFY_API_KEY;
  return NextResponse.redirect(
    `https://${shop}/admin/apps/${apiKey}`
  );
}
