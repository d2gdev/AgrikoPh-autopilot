import { CTA_PATTERNS } from "@/lib/config/topic-clusters";
import type { ParsedArticleHtml } from "./html-parser";

export interface LinkRecord {
  href: string;
  text: string;
}

export interface LinksAnalysis {
  internal: LinkRecord[];
  external: LinkRecord[];
  cta: LinkRecord[];
}

function isInternal(href: string): boolean {
  if (href.startsWith("/")) return true;
  try {
    const url = new URL(href);
    return url.hostname === "agrikoph.com" || url.hostname === "www.agrikoph.com";
  } catch {
    return false;
  }
}

function isCta(text: string): boolean {
  const lower = text.toLowerCase();
  return CTA_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function analyzeLinks(parsed: ParsedArticleHtml): LinksAnalysis {
  const internal: LinkRecord[] = [];
  const external: LinkRecord[] = [];
  const cta: LinkRecord[] = [];

  for (const anchor of parsed.anchors) {
    if (!anchor.href) continue;
    const record: LinkRecord = { href: anchor.href, text: anchor.text };

    if (isInternal(anchor.href)) {
      internal.push(record);
    } else {
      external.push(record);
    }

    if (isCta(anchor.text)) {
      cta.push(record);
    }
  }

  return { internal, external, cta };
}
