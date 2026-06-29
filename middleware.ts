import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Let API routes, Next.js internals, and static assets through
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/generated/") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // If the request already has Shopify launch/auth params, it is being opened
  // from the Admin host and should be allowed into the embedded app shell.
  if (searchParams.get("shop") && (searchParams.get("hmac") || searchParams.get("host"))) {
    return NextResponse.next();
  }

  // Embedded app pages must be loaded by Shopify Admin. A direct top-level visit
  // has no host frame, so App Bridge idToken() will time out waiting for Shopify.
  const fetchDest = request.headers.get("sec-fetch-dest");
  const referer = request.headers.get("referer") ?? "";
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const fromShopifyAdmin =
    referer.startsWith("https://admin.shopify.com/") ||
    Boolean(storeDomain && referer.startsWith(`https://${storeDomain}/admin`));

  if (!fromShopifyAdmin && (!fetchDest || fetchDest === "document")) {
    const authUrl = request.nextUrl.clone();
    authUrl.pathname = "/api/auth/shopify";
    authUrl.search = "";
    return NextResponse.redirect(authUrl);
  }

  // Iframe requests pass through — App Bridge handles auth in the Shopify Admin
  // host context. Real security is enforced at the API layer via requireAppAuth.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
