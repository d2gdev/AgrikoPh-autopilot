import { NextResponse } from "next/server";

// Private app — no OAuth flow needed. Shopify will install via the partner dashboard.
// This route exists only to satisfy App Bridge's expected auth path.
export async function GET() {
  const adminAppUrl = process.env.SHOPIFY_ADMIN_APP_URL;
  if (!adminAppUrl) {
    console.error("[auth] SHOPIFY_ADMIN_APP_URL is not set");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }
  return NextResponse.redirect(adminAppUrl);
}
