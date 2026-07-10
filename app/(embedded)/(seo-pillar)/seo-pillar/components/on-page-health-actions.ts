export type OnPageHealthActions = {
  meta: boolean;
  h1: boolean;
  thin: boolean;
  manual: boolean;
};

const META_ISSUES = new Set([
  "Missing meta title",
  "Missing meta description",
  "Title length off",
  "Description length off",
]);

const AUTOMATED_ISSUES = new Set([
  ...META_ISSUES,
  "Missing H1",
  "Thin content",
]);

export function onPageHealthActions(issues: string[]): OnPageHealthActions {
  return {
    meta: issues.some((issue) => META_ISSUES.has(issue)),
    h1: issues.includes("Missing H1"),
    thin: issues.includes("Thin content"),
    manual: issues.some((issue) => !AUTOMATED_ISSUES.has(issue)),
  };
}
