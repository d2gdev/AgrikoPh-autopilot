"use client";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

export interface CacheEntry<T> {
  value: T;
  storedAt: number;
  expiresAt: number;
}

export interface CacheLookup<T> extends CacheEntry<T> {
  isFresh: boolean;
  isStale: boolean;
}

const cache = new Map<string, CacheEntry<unknown>>();

function isCacheEntry(value: unknown): value is CacheEntry<unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      "value" in value &&
      "storedAt" in value &&
      "expiresAt" in value,
  );
}

export function getCacheEntry<T>(key: string): CacheEntry<T> | null {
  const entry = cache.get(key);
  return isCacheEntry(entry) ? (entry as CacheEntry<T>) : null;
}

export function getFreshCache<T>(key: string, now = Date.now()): T | null {
  const entry = getCacheEntry<T>(key);
  if (!entry || entry.expiresAt <= now) return null;
  return entry.value;
}

export function getFreshCacheEntry<T>(key: string, now = Date.now()): CacheEntry<T> | null {
  const entry = getCacheEntry<T>(key);
  if (!entry || entry.expiresAt <= now) return null;
  return entry;
}

export function getStaleCache<T>(key: string, now = Date.now()): CacheLookup<T> | null {
  const entry = getCacheEntry<T>(key);
  if (!entry) return null;
  const isFresh = entry.expiresAt > now;
  return {
    ...entry,
    isFresh,
    isStale: !isFresh,
  };
}

export function getCache<T>(key: string): T | null {
  return getFreshCache<T>(key);
}

export function setCache(
  key: string,
  value: unknown,
  options: { ttlMs?: number; now?: number } = {},
): CacheEntry<unknown> {
  const storedAt = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const entry = {
    value,
    storedAt,
    expiresAt: storedAt + ttlMs,
  };
  cache.set(key, entry);
  return entry;
}

export function clearCache(key?: string): void {
  if (key) {
    cache.delete(key);
    return;
  }
  cache.clear();
}
