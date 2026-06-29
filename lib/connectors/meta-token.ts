/**
 * Shared token utilities for Meta connectors.
 * Import from here in both meta.ts and meta-organic.ts.
 */

import { getSecret } from "@/lib/config/resolver";

export async function getToken(): Promise<string> {
  const token = await getSecret("META_ACCESS_TOKEN");
  if (!token) throw new Error("META_ACCESS_TOKEN not set");
  return token;
}

/**
 * Inspect a raw error body for Meta token-expiry codes (190, 463).
 * Logs a human-readable message and returns true if expiry was detected.
 */
export function detectAndLogTokenExpiry(errBody: string): boolean {
  try {
    const parsed = JSON.parse(errBody);
    const code: number | undefined = parsed?.error?.code;
    if (code === 190 || code === 463) {
      console.error(
        "[meta] Access token expired (code " + code + "). Rotate META_ACCESS_TOKEN in .env"
      );
      return true;
    }
  } catch {
    // Not JSON — not a structured Meta error, ignore
  }
  return false;
}
