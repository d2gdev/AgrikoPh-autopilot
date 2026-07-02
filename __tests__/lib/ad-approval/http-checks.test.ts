import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkFacebookPixel } from "@/lib/ad-approval/ai-agents/http-checks";

const signal = new AbortController().signal;

function htmlResponse(html: string) {
  return { ok: true, status: 200, text: async () => html } as Response;
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("checkFacebookPixel", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    vi.stubEnv("META_ACCESS_TOKEN", "tok");
    vi.stubEnv("META_AD_ACCOUNT_ID", "act_123");
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  it("passes on a direct fbevents.js install", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      htmlResponse('<script src="https://connect.facebook.net/en_US/fbevents.js"></script>'),
    );
    const res = await checkFacebookPixel("https://example.com", signal);
    expect(res.ok).toBe(true);
    expect(res.note).toMatch(/directly/);
  });

  it("passes a Shopify web-pixel install when the Meta API confirms recent firing", async () => {
    const recent = new Date(Date.now() - 3600_000).toISOString();
    global.fetch = vi
      .fn()
      // page fetch: web-pixels bootstrap only, no fbevents.js
      .mockResolvedValueOnce(htmlResponse('<script src="https://shop.example/cdn/wpm/b407.js"></script>'))
      // Meta API fetch
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "1", last_fired_time: recent }] }));
    const res = await checkFacebookPixel("https://example.com", signal);
    expect(res.ok).toBe(true);
    expect(res.note).toMatch(/verified firing/);
  });

  it("passes with a caveat when web pixels are present but the Meta API is unavailable", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "");
    global.fetch = vi.fn().mockResolvedValue(htmlResponse('<script src="/cdn/wpm/x.js"></script>'));
    const res = await checkFacebookPixel("https://example.com", signal);
    expect(res.ok).toBe(true);
    expect(res.note).toMatch(/verification unavailable/);
  });

  it("fails when web pixels exist but no account pixel fired recently", async () => {
    const stale = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse('<script src="/cdn/wpm/x.js"></script>'))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "1", last_fired_time: stale }] }));
    const res = await checkFacebookPixel("https://example.com", signal);
    expect(res.ok).toBe(false);
    expect(res.note).toMatch(/no pixel/i);
  });

  it("fails when neither a direct pixel nor the web-pixels framework is present", async () => {
    global.fetch = vi.fn().mockResolvedValue(htmlResponse("<html><body>plain page</body></html>"));
    const res = await checkFacebookPixel("https://example.com", signal);
    expect(res.ok).toBe(false);
    expect(res.note).toMatch(/No Facebook pixel/);
  });

  it("rethrows aborts so the worker retries instead of terminally rejecting", async () => {
    const ctrl = new AbortController();
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    global.fetch = vi.fn().mockRejectedValue(abortErr);
    ctrl.abort();
    await expect(checkFacebookPixel("https://example.com", ctrl.signal)).rejects.toThrow();
  });
});
