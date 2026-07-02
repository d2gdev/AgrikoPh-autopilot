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

/** Fetch the page HTML and look for a Facebook pixel install. */
export async function checkFacebookPixel(url: string, signal: AbortSignal): Promise<HttpCheck> {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal });
    if (!res.ok) return { ok: false, note: `Page returned HTTP ${res.status}` };
    const html = await res.text();
    const hasPixel =
      /connect\.facebook\.net\/[^"']*\/fbevents\.js/i.test(html) ||
      /fbq\(\s*['"]init['"]/i.test(html);
    return { ok: hasPixel, note: hasPixel ? "Pixel detected" : "No Facebook pixel found on page" };
  } catch (err) {
    rethrowIfAborted(err, signal);
    return { ok: false, note: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
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
