// Lightweight app-user roster. Auto-captured whenever an authenticated user
// hits an embedded API route, so Settings can offer a dropdown of real people
// to assign as reviewers (the app has no User model — actors are Shopify user
// ids). Best-effort: never throws, never blocks the request.

import { prisma } from "@/lib/db";

/**
 * Upsert the current actor into AppUser. `shopifyUserId` is the JWT `sub`.
 * Session tokens carry no name/email, so those stay null until an admin fills
 * them in via Settings; we only bump lastSeenAt on repeat visits.
 */
export async function captureAppUser(shopifyUserId: string | null | undefined): Promise<void> {
  if (!shopifyUserId || shopifyUserId === "api-key") return;
  try {
    await prisma.appUser.upsert({
      where: { shopifyUserId },
      create: { shopifyUserId },
      update: { lastSeenAt: new Date() },
    });
  } catch (err) {
    console.error("[app-users] capture failed:", err);
  }
}
