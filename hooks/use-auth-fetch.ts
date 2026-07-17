"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

type ShopifyWindow = Window & {
  shopify?: {
    ready?: Promise<void>;
    idToken?: () => Promise<string>;
  };
  __agrikoNativeFetch?: typeof fetch;
};
type AuthStatus = "idle" | "loading" | "ready" | "error";
type LogLevel = "info" | "warn" | "error";

interface ShopifyContext {
  hasHost: boolean;
  hasShop: boolean;
  source: "url" | "session" | "missing" | "server";
}

interface AuthSnapshot {
  status: AuthStatus;
  hasHost: boolean;
  appBridgeReady: boolean;
  initialized: boolean;
  error: string | null;
  lastTokenStartedAt: number | null;
  lastTokenSucceededAt: number | null;
}

interface TokenLoadOptions {
  timeoutMs?: number;
  retryDelaysMs?: number[];
  pollIntervalMs?: number;
  retryExpiredOnly?: boolean;
}

const TOKEN_EXPIRY_SKEW_MS = 30_000;
const TOKEN_MINIMUM_USABLE_MS = 1_000;
const DEFAULT_TOKEN_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAYS_MS = [0, 1_000, 3_000];
const DEFAULT_POLL_INTERVAL_MS = 100;
const FETCH_TOKEN_TIMEOUT_MS = 2_000;
const FETCH_TOKEN_POLL_INTERVAL_MS = 50;
const CONTEXT_STORAGE_KEY = "agriko.shopify.context";
const EXPIRED_TOKEN_RETRY_COOLDOWN_MS = 2_000;

let cachedIdToken: { token: string; expiresAtMs: number } | null = null;
let idTokenRequest: Promise<string> | null = null;
let expiredTokenRetryUntil = 0;
let bootLogged = false;

let authSnapshot: AuthSnapshot = {
  status: "idle",
  hasHost: false,
  appBridgeReady: false,
  initialized: false,
  error: null,
  lastTokenStartedAt: null,
  lastTokenSucceededAt: null,
};

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return authSnapshot;
}

function setAuthSnapshot(next: Partial<AuthSnapshot>) {
  authSnapshot = { ...authSnapshot, ...next };
  listeners.forEach((listener) => listener());
}

function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => { out[k] = v; });
    return out;
  }
  if (Array.isArray(h)) return Object.fromEntries(h as [string, string][]);
  return h as Record<string, string>;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  if (typeof atob === "function") return atob(padded);
  return Buffer.from(padded, "base64").toString("utf8");
}

function getJwtExpiresAtMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const parsed = JSON.parse(decodeBase64Url(payload)) as { exp?: unknown };
    return typeof parsed.exp === "number" ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}

function getUrlSessionToken(nowMs: number): string | null {
  const win = getWindow();
  if (!win) return null;

  try {
    const token = new URL(win.location.href).searchParams.get("id_token");
    if (!token) return null;

    const expiresAtMs = getJwtExpiresAtMs(token);
    if (expiresAtMs && expiresAtMs - TOKEN_EXPIRY_SKEW_MS <= nowMs) {
      return null;
    }

    if (expiresAtMs) cachedIdToken = { token, expiresAtMs };
    return token;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTopLevelWindow(): boolean {
  try {
    return window.top === window.self;
  } catch {
    return false;
  }
}

function getWindow(): ShopifyWindow | null {
  if (typeof window === "undefined") return null;
  return window as ShopifyWindow;
}

function getFetchTransport(useNativeFetch: boolean): typeof fetch {
  const win = getWindow();
  if (useNativeFetch && win?.__agrikoNativeFetch) return win.__agrikoNativeFetch;
  if (win?.fetch) return win.fetch.bind(win);
  return fetch;
}

function logAuth(level: LogLevel, message: string, details?: Record<string, unknown>) {
  const logger = console[level] ?? console.log;
  logger(`[app-bridge-auth] ${message}`, details ?? {});
}

function safeGetSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readStoredContext(): { host?: string; shop?: string } {
  const storage = safeGetSessionStorage();
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(CONTEXT_STORAGE_KEY) ?? "{}") as {
      host?: unknown;
      shop?: unknown;
    };
    return {
      host: typeof parsed.host === "string" ? parsed.host : undefined,
      shop: typeof parsed.shop === "string" ? parsed.shop : undefined,
    };
  } catch {
    return {};
  }
}

function writeStoredContext(host: string | null, shop: string | null) {
  if (!host && !shop) return;
  const storage = safeGetSessionStorage();
  if (!storage) return;
  const existing = readStoredContext();
  storage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({
    host: host ?? existing.host,
    shop: shop ?? existing.shop,
  }));
}

function getShopifyContext(): ShopifyContext {
  const win = getWindow();
  if (!win) return { hasHost: false, hasShop: false, source: "server" };

  try {
    const url = new URL(win.location.href);
    const host = url.searchParams.get("host");
    const shop = url.searchParams.get("shop");
    if (host || shop) {
      writeStoredContext(host, shop);
      return { hasHost: Boolean(host), hasShop: Boolean(shop), source: "url" };
    }

    const stored = readStoredContext();
    if (stored.host || stored.shop) {
      return { hasHost: Boolean(stored.host), hasShop: Boolean(stored.shop), source: "session" };
    }
  } catch {
    // Keep missing context as the fallback below.
  }

  return { hasHost: false, hasShop: false, source: "missing" };
}

export function withShopifyContextUrl(href: string): string {
  if (typeof window === "undefined") return href;
  if (!href.startsWith("/") || href.startsWith("//")) return href;

  try {
    const currentUrl = new URL(window.location.href);
    const target = new URL(href, currentUrl.origin);
    const stored = readStoredContext();
    const host = currentUrl.searchParams.get("host") ?? stored.host;
    const shop = currentUrl.searchParams.get("shop") ?? stored.shop;

    if (host && !target.searchParams.has("host")) target.searchParams.set("host", host);
    if (shop && !target.searchParams.has("shop")) target.searchParams.set("shop", shop);

    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return href;
  }
}

function preserveShopifyContextInUrl(context: ShopifyContext) {
  if (typeof window === "undefined" || context.source !== "session" || context.hasHost === false) {
    return;
  }

  try {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has("host")) return;
    const next = withShopifyContextUrl(`${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    window.history.replaceState(window.history.state, "", next);
    logAuth("info", "Restored Shopify host context into current URL", {
      hasHost: true,
      source: "session",
    });
  } catch {
    // Non-critical. Auth can still continue if App Bridge is already initialized.
  }
}

function hasValidCachedToken(nowMs: number): boolean {
  return Boolean(cachedIdToken && cachedIdToken.expiresAtMs - TOKEN_MINIMUM_USABLE_MS > nowMs);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function waitForAppBridgeIdToken(
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<NonNullable<ShopifyWindow["shopify"]> & { idToken: () => Promise<string> }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const win = getWindow();
    if (win?.shopify) {
      if (win.shopify.ready) {
        await withTimeout(
          win.shopify.ready,
          Math.max(1, timeoutMs - (Date.now() - startedAt)),
          `Shopify App Bridge ready timed out after ${timeoutMs}ms`,
        );
      }
      if (win.shopify.idToken) {
        return win.shopify as NonNullable<ShopifyWindow["shopify"]> & { idToken: () => Promise<string> };
      }
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(`Shopify App Bridge idToken API unavailable after ${timeoutMs}ms`);
}

async function requestTokenWithRetry(
  nowMs: number,
  context: ShopifyContext,
  options: Required<TokenLoadOptions>,
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < options.retryDelaysMs.length; attempt += 1) {
    const retryDelayMs = options.retryDelaysMs[attempt] ?? 0;
    if (retryDelayMs > 0) await sleep(retryDelayMs);

    const startedAt = Date.now();
    setAuthSnapshot({
      status: "loading",
      hasHost: context.hasHost,
      initialized: false,
      error: null,
      lastTokenStartedAt: startedAt,
    });
    logAuth("info", "Token request started", {
      attempt: attempt + 1,
      hasHost: context.hasHost,
      contextSource: context.source,
    });

    try {
      const shopify = await waitForAppBridgeIdToken(options.timeoutMs, options.pollIntervalMs);
      setAuthSnapshot({ appBridgeReady: true, initialized: true });
      logAuth("info", "App Bridge initialized", {
        hasHost: context.hasHost,
        contextSource: context.source,
      });

      const token = await withTimeout(
        shopify.idToken(),
        options.timeoutMs,
        `Shopify App Bridge idToken request timed out after ${options.timeoutMs}ms`,
      );
      const expiresAtMs = getJwtExpiresAtMs(token);

      if (expiresAtMs && expiresAtMs <= Date.now()) {
        expiredTokenRetryUntil = Date.now() + EXPIRED_TOKEN_RETRY_COOLDOWN_MS;
        throw new Error("Shopify App Bridge returned an expired idToken");
      }

      cachedIdToken = expiresAtMs && expiresAtMs - TOKEN_MINIMUM_USABLE_MS > Date.now()
        ? { token, expiresAtMs }
        : null;
      setAuthSnapshot({
        status: "ready",
        hasHost: context.hasHost,
        appBridgeReady: true,
        initialized: true,
        error: null,
        lastTokenSucceededAt: Date.now(),
      });
      logAuth("info", "Token request succeeded", {
        attempt: attempt + 1,
        expiresAtKnown: Boolean(expiresAtMs),
      });
      return token;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      logAuth(attempt === options.retryDelaysMs.length - 1 ? "error" : "warn", "Token request failed", {
        attempt: attempt + 1,
        hasHost: context.hasHost,
        contextSource: context.source,
        error: message,
      });
      if (
        options.retryExpiredOnly
        && message !== "Shopify App Bridge returned an expired idToken"
      ) {
        break;
      }
    }
  }

  cachedIdToken = null;
  const finalMessage = lastError instanceof Error ? lastError.message : String(lastError);
  setAuthSnapshot({
    status: "error",
    hasHost: context.hasHost,
    appBridgeReady: Boolean(getWindow()?.shopify?.idToken),
    initialized: Boolean(getWindow()?.shopify?.idToken),
    error: finalMessage,
  });
  throw new Error(finalMessage);
}

export function __resetAuthFetchTokenCacheForTests() {
  cachedIdToken = null;
  idTokenRequest = null;
  expiredTokenRetryUntil = 0;
  bootLogged = false;
  authSnapshot = {
    status: "idle",
    hasHost: false,
    appBridgeReady: false,
    initialized: false,
    error: null,
    lastTokenStartedAt: null,
    lastTokenSucceededAt: null,
  };
}

export function __setAppBridgeAuthSnapshotForTests(next: Partial<AuthSnapshot>) {
  setAuthSnapshot(next);
}

export async function getAppBridgeIdToken(
  nowMs = Date.now(),
  options: TokenLoadOptions = {},
): Promise<string> {
  if (hasValidCachedToken(nowMs) && cachedIdToken) {
    return cachedIdToken.token;
  }
  if (idTokenRequest) return idTokenRequest;

  if (expiredTokenRetryUntil > nowMs) {
    throw new Error("Shopify App Bridge returned an expired idToken; retrying shortly");
  }

  const win = getWindow();
  if (!win) {
    throw new Error("Shopify App Bridge unavailable outside the browser");
  }

  const context = getShopifyContext();
  preserveShopifyContextInUrl(context);

  if (isTopLevelWindow()) {
    const message = "Shopify App Bridge unavailable outside Shopify Admin";
    cachedIdToken = null;
    setAuthSnapshot({
      status: "error",
      hasHost: context.hasHost,
      appBridgeReady: Boolean(win.shopify?.idToken),
      initialized: false,
      error: message,
    });
    throw new Error(message);
  }

  const urlSessionToken = getUrlSessionToken(nowMs);
  if (urlSessionToken) {
    setAuthSnapshot({
      status: "ready",
      hasHost: context.hasHost,
      appBridgeReady: Boolean(win.shopify?.idToken),
      initialized: true,
      error: null,
      lastTokenSucceededAt: Date.now(),
    });
    return urlSessionToken;
  }

  if (!context.hasHost && !win.shopify?.idToken) {
    const message = "Shopify host parameter missing";
    cachedIdToken = null;
    setAuthSnapshot({
      status: "error",
      hasHost: false,
      appBridgeReady: Boolean(win.shopify?.idToken),
      initialized: false,
      error: message,
    });
    throw new Error(message);
  }

  if (!bootLogged) {
    bootLogged = true;
    logAuth("info", "Shopify context checked", {
      hasHost: context.hasHost,
      hasShop: context.hasShop,
      contextSource: context.source,
      topLevelWindow: isTopLevelWindow(),
      appBridgeReady: Boolean(win.shopify?.idToken),
    });
  }

  setAuthSnapshot({
    status: "loading",
    hasHost: context.hasHost,
    appBridgeReady: Boolean(win.shopify?.idToken),
    initialized: Boolean(win.shopify?.idToken),
    error: null,
  });

  const resolvedOptions: Required<TokenLoadOptions> = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS,
    retryDelaysMs: options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    retryExpiredOnly: options.retryExpiredOnly ?? false,
  };

  idTokenRequest = requestTokenWithRetry(nowMs, context, resolvedOptions)
    .finally(() => {
      idTokenRequest = null;
    });

  return idTokenRequest;
}

export function useAppBridgeAuth() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    getAppBridgeIdToken(Date.now(), {
      timeoutMs: DEFAULT_TOKEN_TIMEOUT_MS,
      retryDelaysMs: DEFAULT_RETRY_DELAYS_MS,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    }).catch(() => undefined);
  }, []);

  return snapshot;
}

export function useAuthFetch() {
  return useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
      const normalized = normalizeHeaders(init.headers);
      const hasBody = init.body != null;
      const hasContentType = "Content-Type" in normalized || "content-type" in normalized;
      const baseHeaders: Record<string, string> = {
        ...(hasBody && !hasContentType ? { "Content-Type": "application/json" } : {}),
        ...normalized,
      };

      if (!hasHeader(baseHeaders, "authorization")) {
        const token = await getAppBridgeIdToken(Date.now(), {
          timeoutMs: FETCH_TOKEN_TIMEOUT_MS,
          retryDelaysMs: [0, 100],
          pollIntervalMs: FETCH_TOKEN_POLL_INTERVAL_MS,
          retryExpiredOnly: true,
        });
        baseHeaders.Authorization = `Bearer ${token}`;
      }

      const transport = getFetchTransport(false);
      return transport(input, { ...init, headers: baseHeaders });
    },
    [],
  );
}
