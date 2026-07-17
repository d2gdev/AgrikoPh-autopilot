import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";

export type ExactInternalLinkReplacement = {
  fromUrl: string;
  toUrl: string;
};

function normalizeHref(value: string): string {
  const normalized = normalizeGovernedUrl(value);
  if (normalized.startsWith("/")) {
    const parsed = new URL(normalized, "https://agrikoph.com");
    const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
    return `${pathname}${parsed.search}${parsed.hash}`;
  }
  const parsed = new URL(normalized);
  const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
  return `${pathname}${parsed.search}${parsed.hash}`;
}

function safeNormalizeHref(value: string): string | null {
  try {
    return normalizeHref(value);
  } catch {
    return null;
  }
}

export function replaceExactInternalLinkTargets(
  bodyHtml: string,
  replacements: readonly ExactInternalLinkReplacement[],
): { bodyHtml: string; changed: number } {
  const bySource = new Map(replacements.map((item) => [
    normalizeHref(item.fromUrl),
    normalizeHref(item.toUrl),
  ]));
  let changed = 0;
  const next = bodyHtml.replace(
    /(<a\b[^>]*\bhref\s*=\s*)(["'])([^"']+)\2/gi,
    (match, prefix: string, quote: string, href: string) => {
      const normalized = safeNormalizeHref(href);
      const replacement = normalized ? bySource.get(normalized) : undefined;
      if (!replacement) return match;
      changed += 1;
      return `${prefix}${quote}${replacement}${quote}`;
    },
  );
  return { bodyHtml: next, changed };
}
