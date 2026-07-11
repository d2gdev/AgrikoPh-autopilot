export interface LatestRequestCoordinator {
  start(options: { background: boolean }): AbortController | null;
  isCurrent(request: AbortController): boolean;
  finish(request: AbortController): void;
}

export function createLatestRequestCoordinator(): LatestRequestCoordinator {
  let current: AbortController | null = null;
  return {
    start({ background }) {
      if (background && current) return null;
      current?.abort();
      current = new AbortController();
      return current;
    },
    isCurrent(request) {
      return current === request;
    },
    finish(request) {
      if (current === request) current = null;
    },
  };
}
