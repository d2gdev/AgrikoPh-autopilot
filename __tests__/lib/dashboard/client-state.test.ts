import { describe, expect, it } from "vitest";
import {
  errorPanel,
  loadingPanel,
  panelFromCache,
  readyPanel,
  stalePanel,
} from "@/lib/dashboard/client-state";

describe("dashboard client panel state", () => {
  it("marks ready data as empty when the panel-specific predicate matches", () => {
    expect(readyPanel([], { isEmpty: (items) => items.length === 0 })).toMatchObject({
      status: "empty",
      data: [],
      error: null,
    });
  });

  it("keeps previous data visible as stale after a refresh error", () => {
    const previous = readyPanel({ count: 1 }, { loadedAt: "2026-06-25T00:00:00.000Z" });

    expect(errorPanel("Network failed", previous)).toEqual({
      status: "stale",
      data: { count: 1 },
      error: "Network failed",
      loadedAt: "2026-06-25T00:00:00.000Z",
    });
  });

  it("converts fresh and expired cache entries into ready or stale panel states", () => {
    expect(panelFromCache({
      value: { ok: true },
      storedAt: 1_000,
      expiresAt: 2_000,
      isFresh: true,
      isStale: false,
    })).toMatchObject({
      status: "ready",
      loadedAt: "1970-01-01T00:00:01.000Z",
    });

    expect(panelFromCache({
      value: { ok: true },
      storedAt: 1_000,
      expiresAt: 2_000,
      isFresh: false,
      isStale: true,
    })).toMatchObject({
      status: "stale",
      loadedAt: "1970-01-01T00:00:01.000Z",
    });
  });

  it("preserves previous data while loading", () => {
    expect(loadingPanel(stalePanel("cached"))).toMatchObject({
      status: "loading",
      data: "cached",
    });
  });
});
