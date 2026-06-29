import type { CacheLookup } from "@/lib/client-cache";

export type PanelStatus = "idle" | "loading" | "ready" | "empty" | "error" | "stale";

export interface PanelState<T> {
  status: PanelStatus;
  data: T | null;
  error: string | null;
  loadedAt: string | null;
}

export function idlePanel<T>(): PanelState<T> {
  return {
    status: "idle",
    data: null,
    error: null,
    loadedAt: null,
  };
}

export function loadingPanel<T>(previous?: PanelState<T>): PanelState<T> {
  return {
    status: "loading",
    data: previous?.data ?? null,
    error: null,
    loadedAt: previous?.loadedAt ?? null,
  };
}

export function readyPanel<T>(
  data: T,
  options: { loadedAt?: string; isEmpty?: (data: T) => boolean } = {},
): PanelState<T> {
  return {
    status: options.isEmpty?.(data) ? "empty" : "ready",
    data,
    error: null,
    loadedAt: options.loadedAt ?? new Date().toISOString(),
  };
}

export function stalePanel<T>(
  data: T,
  options: { loadedAt?: string; error?: string | null } = {},
): PanelState<T> {
  return {
    status: "stale",
    data,
    error: options.error ?? null,
    loadedAt: options.loadedAt ?? new Date().toISOString(),
  };
}

export function errorPanel<T>(
  error: string,
  previous?: PanelState<T>,
): PanelState<T> {
  if (previous?.data != null) {
    return stalePanel(previous.data, {
      loadedAt: previous.loadedAt ?? undefined,
      error,
    });
  }

  return {
    status: "error",
    data: null,
    error,
    loadedAt: null,
  };
}

export function panelFromCache<T>(
  entry: CacheLookup<T> | null,
  options: { isEmpty?: (data: T) => boolean } = {},
): PanelState<T> {
  if (!entry) return idlePanel<T>();

  const loadedAt = new Date(entry.storedAt).toISOString();
  if (entry.isFresh) {
    return readyPanel(entry.value, { loadedAt, isEmpty: options.isEmpty });
  }

  return stalePanel(entry.value, { loadedAt });
}
