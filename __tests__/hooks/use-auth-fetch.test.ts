import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { AppBridgeAuthGate } from "@/components/app-bridge-auth-gate";
import {
  __resetAuthFetchTokenCacheForTests,
  __setAppBridgeAuthSnapshotForTests,
  getAppBridgeIdToken,
  useAuthFetch,
  withShopifyContextUrl,
} from "@/hooks/use-auth-fetch";

function jwtWithExp(expSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds }))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `header.${payload}.signature`;
}

function jwtExpiresIn(secondsFromNow: number): string {
  return jwtWithExp(Math.floor(Date.now() / 1000) + secondsFromNow);
}

function stubEmbeddedShopifyWindow(idToken: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("window", {
    self: {},
    top: {},
    location: {
      href: "https://autopilot.test/?host=admin-host&shop=test.myshopify.com",
    },
    shopify: { idToken },
  });
}

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
    clear: vi.fn(() => { store.clear(); }),
  };
}

afterEach(() => {
  __resetAuthFetchTokenCacheForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getAppBridgeIdToken", () => {
  it("deduplicates parallel App Bridge idToken requests", async () => {
    let resolveToken: ((token: string) => void) | undefined;
    const idToken = vi.fn(() => new Promise<string>((resolve) => {
      resolveToken = resolve;
    }));
    stubEmbeddedShopifyWindow(idToken);

    const first = getAppBridgeIdToken(1_000);
    const second = getAppBridgeIdToken(1_000);

    await Promise.resolve();
    expect(idToken).toHaveBeenCalledTimes(1);
    const token = jwtExpiresIn(120);
    resolveToken?.(token);

    await expect(Promise.all([first, second])).resolves.toEqual([token, token]);
  });

  it("reuses a cached token while it is not close to expiry", async () => {
    const token = jwtExpiresIn(120);
    const idToken = vi.fn().mockResolvedValue(token);
    stubEmbeddedShopifyWindow(idToken);

    const now = Date.now();
    await expect(getAppBridgeIdToken(now)).resolves.toBe(token);
    await expect(getAppBridgeIdToken(now + 20_000)).resolves.toBe(token);

    expect(idToken).toHaveBeenCalledTimes(1);
  });

  it("refreshes the token when it is inside the expiry skew", async () => {
    const firstToken = jwtExpiresIn(120);
    const secondToken = jwtExpiresIn(240);
    const idToken = vi.fn()
      .mockResolvedValueOnce(firstToken)
      .mockResolvedValueOnce(secondToken);
    stubEmbeddedShopifyWindow(idToken);

    const now = Date.now();
    await expect(getAppBridgeIdToken(now)).resolves.toBe(firstToken);
    await expect(getAppBridgeIdToken(now + 100_000)).resolves.toBe(secondToken);

    expect(idToken).toHaveBeenCalledTimes(2);
  });

  it("does not call App Bridge idToken in a direct top-level window", async () => {
    const idToken = vi.fn().mockResolvedValue(jwtExpiresIn(120));
    const top = {};
    vi.stubGlobal("window", {
      self: top,
      top,
      shopify: { idToken },
    });

    await expect(getAppBridgeIdToken()).rejects.toThrow("outside Shopify Admin");
    expect(idToken).not.toHaveBeenCalled();
  });

  it("uses App Bridge idToken when host context is missing but App Bridge is available", async () => {
    const token = jwtExpiresIn(120);
    const idToken = vi.fn().mockResolvedValue(token);
    vi.stubGlobal("window", {
      self: {},
      top: {},
      location: {
        href: "https://autopilot.test/",
      },
      shopify: { idToken },
    });

    await expect(getAppBridgeIdToken()).resolves.toBe(token);
    expect(idToken).toHaveBeenCalledTimes(1);
  });

  it("fails when host context and App Bridge token API are both missing", async () => {
    const idToken = vi.fn().mockResolvedValue(jwtExpiresIn(120));
    vi.stubGlobal("window", {
      self: {},
      top: {},
      location: {
        href: "https://autopilot.test/",
      },
      shopify: {},
    });

    await expect(getAppBridgeIdToken()).rejects.toThrow("host parameter missing");
    expect(idToken).not.toHaveBeenCalled();
  });

  it("waits for App Bridge ready before requesting idToken", async () => {
    const token = jwtExpiresIn(120);
    const idToken = vi.fn().mockResolvedValue(token);
    let resolveReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    vi.stubGlobal("window", {
      self: {},
      top: {},
      location: {
        href: "https://autopilot.test/?host=admin-host&shop=test.myshopify.com",
      },
      shopify: { ready, idToken },
    });

    const request = getAppBridgeIdToken(Date.now(), {
      retryDelaysMs: [0],
      timeoutMs: 1_000,
      pollIntervalMs: 1,
    });

    await Promise.resolve();
    expect(idToken).not.toHaveBeenCalled();

    resolveReady?.();

    await expect(request).resolves.toBe(token);
    expect(idToken).toHaveBeenCalledTimes(1);
  });

  it("retries a failed App Bridge idToken request", async () => {
    const token = jwtExpiresIn(120);
    const idToken = vi.fn()
      .mockRejectedValueOnce(new Error("host did not respond in time"))
      .mockResolvedValueOnce(token);
    stubEmbeddedShopifyWindow(idToken);

    await expect(getAppBridgeIdToken(Date.now(), {
      retryDelaysMs: [0, 0],
      timeoutMs: 50,
      pollIntervalMs: 1,
    })).resolves.toBe(token);

    expect(idToken).toHaveBeenCalledTimes(2);
  });

  it("times out when App Bridge idToken never resolves", async () => {
    const idToken = vi.fn(() => new Promise<string>(() => undefined));
    stubEmbeddedShopifyWindow(idToken);

    await expect(getAppBridgeIdToken(Date.now(), {
      retryDelaysMs: [0],
      timeoutMs: 5,
      pollIntervalMs: 1,
    })).rejects.toThrow("timed out");
  });
});

describe("useAuthFetch", () => {
  it("does not attach x-autopilot-api-key from browser-exposed env", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTOPILOT_API_KEY", "do-not-send");
    const token = jwtExpiresIn(120);
    const idToken = vi.fn().mockResolvedValue(token);
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("window", {
      self: {},
      top: {},
      location: {
        href: "https://autopilot.test/?host=admin-host&shop=test.myshopify.com",
      },
      fetch: fetchMock,
      shopify: { idToken },
    });

    let authFetch: ReturnType<typeof useAuthFetch> | undefined;
    function Probe() {
      authFetch = useAuthFetch();
      return null;
    }
    renderToStaticMarkup(React.createElement(Probe));

    await authFetch?.("/api/jobs/status");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jobs/status",
      expect.objectContaining({
        headers: expect.not.objectContaining({ "x-autopilot-api-key": "do-not-send" }),
      }),
    );
    const fetchInit = fetchMock.mock.calls[0]?.[1];
    expect(fetchInit?.headers).toMatchObject({
      Authorization: `Bearer ${token}`,
    });
  });
});

describe("AppBridgeAuthGate", () => {
  function renderGate() {
    return renderToStaticMarkup(
      React.createElement(
        AppProvider,
        { i18n: enTranslations },
        React.createElement(
          AppBridgeAuthGate,
          null,
          React.createElement("main", null, "Protected dashboard"),
        ),
      ),
    );
  }

  it("blocks children while App Bridge auth is loading", () => {
    __setAppBridgeAuthSnapshotForTests({
      status: "loading",
      initialized: false,
      error: null,
    });

    const html = renderGate();

    expect(html).toContain("Connecting to Shopify Admin");
    expect(html).not.toContain("Protected dashboard");
  });

  it("shows an error state instead of children when auth fails", () => {
    __setAppBridgeAuthSnapshotForTests({
      status: "error",
      initialized: false,
      error: "Shopify host parameter missing",
    });

    const html = renderGate();

    expect(html).toContain("Unable to connect to Shopify Admin");
    expect(html).toContain("Shopify host parameter missing");
    expect(html).not.toContain("Protected dashboard");
  });

  it("renders children only after auth is ready and initialized", () => {
    __setAppBridgeAuthSnapshotForTests({
      status: "ready",
      initialized: true,
      appBridgeReady: true,
      error: null,
    });

    expect(renderGate()).toContain("Protected dashboard");
  });
});

describe("withShopifyContextUrl", () => {
  it("preserves host and shop from the current URL", () => {
    const sessionStorage = createMemoryStorage();
    vi.stubGlobal("window", {
      location: {
        href: "https://autopilot.test/content-pilot?host=admin-host&shop=test.myshopify.com",
      },
      sessionStorage,
    });

    expect(withShopifyContextUrl("/seo?tab=1")).toBe("/seo?tab=1&host=admin-host&shop=test.myshopify.com");
  });

  it("uses stored host context when the current URL lost it", async () => {
    const sessionStorage = createMemoryStorage();
    vi.stubGlobal("window", {
      self: {},
      top: {},
      location: {
        href: "https://autopilot.test/content-pilot?host=admin-host&shop=test.myshopify.com",
      },
      history: { state: null, replaceState: vi.fn() },
      sessionStorage,
      shopify: { idToken: vi.fn().mockResolvedValue(jwtExpiresIn(120)) },
    });

    await getAppBridgeIdToken();

    vi.stubGlobal("window", {
      location: {
        href: "https://autopilot.test/settings",
      },
      sessionStorage,
    });

    expect(withShopifyContextUrl("/content-pilot?tab=1")).toBe("/content-pilot?tab=1&host=admin-host&shop=test.myshopify.com");
  });
});
