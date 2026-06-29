import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
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

  // If the request already has Shopify OAuth params, it's part of the install flow
  if (searchParams.get("shop") && searchParams.get("hmac")) {
    return NextResponse.next();
  }

  // All page requests pass through — App Bridge handles auth in the iframe context.
  // Real security is enforced at the API layer via requireAppAuth on every route.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
