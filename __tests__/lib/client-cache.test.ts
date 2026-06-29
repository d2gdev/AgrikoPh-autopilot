import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCache,
  getCache,
  getCacheEntry,
  getFreshCache,
  getFreshCacheEntry,
  getStaleCache,
  setCache,
} from "@/lib/client-cache";

describe("client cache", () => {
  beforeEach(() => {
    clearCache();
  });

  it("stores values with freshness metadata", () => {
    setCache("status", { ok: true }, { now: 1_000, ttlMs: 500 });

    expect(getCacheEntry<{ ok: boolean }>("status")).toEqual({
      value: { ok: true },
      storedAt: 1_000,
      expiresAt: 1_500,
    });
    expect(getFreshCache("status", 1_499)).toEqual({ ok: true });
    expect(getFreshCacheEntry("status", 1_499)).toMatchObject({ storedAt: 1_000 });
  });

  it("returns null from fresh helpers after expiry but preserves stale entries", () => {
    setCache("status", "old", { now: 1_000, ttlMs: 500 });

    expect(getCache<string>("status")).toBeNull();
    expect(getFreshCache<string>("status", 1_499)).toBe("old");
    expect(getFreshCache<string>("status", 1_500)).toBeNull();
    expect(getStaleCache<string>("status", 1_500)).toMatchObject({
      value: "old",
      isFresh: false,
      isStale: true,
    });
  });
});
