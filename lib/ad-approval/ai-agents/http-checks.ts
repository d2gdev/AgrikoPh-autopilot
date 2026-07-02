// Deterministic HTTP checks for the Brand and Technical review agents. No LLM.
// All fetches honor the job's AbortSignal. IMPORTANT: an abort (job timeout)
// must propagate as a thrown error so the worker retries the job — swallowing
// it into a FAIL verdict would terminally reject the ad on a transient timeout.

export interface HttpCheck {
  ok: boolean;
  note?: string;
}

/** Rethrow job-timeout aborts; anything else is a genuine check failure. */
function rethrowIfAborted(err: unknown, signal: AbortSignal): void {
  if (signal.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
}

/** GET a URL following redirects; ok if final status is 2xx. */
export async function checkUrlReachable(url: string, signal: AbortSignal): Promise<HttpCheck> {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal });
    return {
      ok: res.status >= 200 && res.status < 300,
      note: `HTTP ${res.status}${res.redirected ? " (redirected)" : ""}`,
    };
  } catch (err) {
    rethrowIfAborted(err, signal);
    return { ok: false, note: `Unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Trace redirects manually; fail if >maxHops (redirect loop / long chain). */
export async function checkRedirectChain(
  url: string,
  signal: AbortSignal,
  maxHops = 5,
): Promise<HttpCheck> {
  let current = url;
  const seen = new Set<string>();
  for (let hop = 0; hop <= maxHops; hop++) {
    if (seen.has(current)) return { ok: false, note: `Redirect loop at ${current}` };
    seen.add(current);
    let res: Response;
    try {
      res = await fetch(current, { method: "GET", redirect: "manual", signal });
    } catch (err) {
      rethrowIfAborted(err, signal);
      return { ok: false, note: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (res.status < 300 || res.status >= 400) {
      return { ok: true, note: `${hop} redirect(s)` };
    }
    const location = res.headers.get("location");
    if (!location) return { ok: true, note: `${hop} redirect(s), no location` };
    current = new URL(location, current).toString();
  }
  return { ok: false, note: `Exceeded ${maxHops} redirects` };
}

/**
 * Fetch the page HTML and look for a Facebook pixel install.
 *
 * Shopify stores rarely embed fbevents.js in the raw HTML — Meta pixels are
 * usually installed as sandboxed Web Pixels that load dynamically through
 * Shopify's Web Pixels Manager (only a `/cdn/wpm/...` bootstrap appears in the
 * HTML). Treating "no fbevents.js in HTML" as "no pixel" terminally rejected
 * every Shopify-hosted landing page (false negative found in prod E2E). So:
 *   1. fbevents.js / fbq() in HTML            -> PASS (direct install)
 *   2. Web Pixels bootstrap in HTML           -> verify via Meta Marketing API
 *      that a pixel on the ad account fired recently; PASS if so, PASS-with-
 *      caveat if the API is unavailable, FAIL if pixels exist but are silent
 *   3. neither                                -> FAIL
 */
export async function checkFacebookPixel(url: string, signal: AbortSignal): Promise<HttpCheck> {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal });
    if (!res.ok) return { ok: false, note: `Page returned HTTP ${res.status}` };
    const html = await res.text();

    const hasDirectPixel =
      /connect\.facebook\.net\/[^"']*\/fbevents\.js/i.test(html) ||
      /fbq\(\s*['"]init['"]/i.test(html);
    if (hasDirectPixel) return { ok: true, note: "Pixel embedded directly in page HTML" };

    const hasWebPixelsFramework = /\/cdn\/wpm\/|web-pixels@|webPixelsManager/i.test(html);
    if (hasWebPixelsFramework) {
      const fired = await metaPixelRecentlyFired(signal);
      if (fired === true) {
        return { ok: true, note: "Shopify Web Pixels install; Meta pixel verified firing via Marketing API" };
      }
      if (fired === null) {
        return { ok: true, note: "Shopify Web Pixels framework detected (pixel loads dynamically; Meta API verification unavailable)" };
      }
      return { ok: false, note: "Shopify Web Pixels framework present, but no pixel on the ad account fired in the last 7 days" };
    }

    return { ok: false, note: "No Facebook pixel found on page" };
  } catch (err) {
    rethrowIfAborted(err, signal);
    return { ok: false, note: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Ask the Meta Marketing API whether any pixel on the configured ad account
 * fired within the last 7 days. Returns null when unverifiable (no credentials,
 * API error, or no pixels on the account) — callers treat null as "unknown",
 * not as failure.
 */
async function metaPixelRecentlyFired(signal: AbortSignal): Promise<boolean | null> {
  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID;
  if (!token || !account) return null;
  const accountId = account.startsWith("act_") ? account : `act_${account}`;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${accountId}/adspixels?fields=id,last_fired_time&access_token=${encodeURIComponent(token)}`,
      { signal },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ last_fired_time?: string }> };
    const pixels = json.data ?? [];
    if (!pixels.length) return null;
    const cutoff = Date.now() - 7 * 24 * 3600_000;
    return pixels.some((p) => p.last_fired_time && new Date(p.last_fired_time).getTime() > cutoff);
  } catch (err) {
    rethrowIfAborted(err, signal);
    return null;
  }
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

/** All required UTM params present, non-empty, and space-free. */
export function checkUtmParams(utm: Record<string, string> | undefined): HttpCheck {
  if (!utm) return { ok: false, note: "No UTM parameters provided" };
  const missing = UTM_KEYS.filter((k) => !utm[k] || !utm[k]!.trim());
  if (missing.length) return { ok: false, note: `Missing UTM params: ${missing.join(", ")}` };
  const spaced = Object.entries(utm).filter(([, v]) => /\s/.test(v)).map(([k]) => k);
  if (spaced.length) return { ok: false, note: `UTM params contain spaces: ${spaced.join(", ")}` };
  return { ok: true };
}

// Convention: [Date]-[Product]-[Audience], e.g. 2026-08-01-Rice-Health.
const CAMPAIGN_NAME_RE = /^\d{4}-\d{2}-\d{2}-[A-Za-z0-9]+-[A-Za-z0-9]+$/;

export function checkCampaignName(name: string | undefined): HttpCheck {
  if (!name) return { ok: false, note: "No campaign name provided" };
  return {
    ok: CAMPAIGN_NAME_RE.test(name),
    note: CAMPAIGN_NAME_RE.test(name) ? undefined : "Expected [YYYY-MM-DD]-[Product]-[Audience]",
  };
}
