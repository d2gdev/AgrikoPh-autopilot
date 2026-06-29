import type { MetaAdLibraryAd, MetaAdLibraryInput } from "./meta-ad-library";

function asText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function adLibraryUrl(input: MetaAdLibraryInput) {
  const url = new URL("https://www.facebook.com/ads/library/");
  url.searchParams.set("active_status", process.env.MARKET_INTEL_META_ACTIVE_STATUS ?? "all");
  url.searchParams.set("ad_type", "all");
  url.searchParams.set("country", input.country ?? process.env.MARKET_INTEL_DEFAULT_COUNTRY ?? "PH");
  url.searchParams.set("media_type", "all");
  url.searchParams.set("q", input.searchTerms ?? input.pageName);
  url.searchParams.set("search_type", "keyword_unordered");
  if (input.pageId) url.searchParams.set("view_all_page_id", input.pageId);
  return url.toString();
}

function makeStableArchiveId(pageName: string, index: number, text: string) {
  const base = `${pageName}:${index}:${text}`.toLowerCase();
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
  }
  return `scraped-${Math.abs(hash)}`;
}

function parseDate(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function trimAdText(text: string) {
  const start = text.search(/(?:Active|Inactive)?\s*Library ID/i);
  const sliced = start >= 0 ? text.slice(start) : text;
  return sliced.replace(/^(?:Active|Inactive)?\s*Library ID[:\s]+\d+/i, "").replace(/\s+/g, " ").trim();
}

export function isMetaAdLibraryScraperEnabled() {
  return process.env.META_AD_LIBRARY_SCRAPE_ENABLED === "true";
}

export async function scrapeMetaAdLibraryAds(input: MetaAdLibraryInput, limit = 10): Promise<{ ads: MetaAdLibraryAd[] }> {
  if (!isMetaAdLibraryScraperEnabled()) return { ads: [] };

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage({
      locale: "en-US",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      viewport: { width: 1365, height: 900 },
    });
    const url = adLibraryUrl(input);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(5_000);

    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 1600);
      await page.waitForTimeout(1_500);
    }

    const pageText = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
    if (/captcha|security check|temporarily blocked/i.test(pageText) || (/log in to facebook/i.test(pageText) && !/Library ID/i.test(pageText))) {
      throw new Error("Meta Ad Library scraper blocked by login/captcha/security page");
    }

    const cards = await page.locator('div:has-text("Library ID")').evaluateAll((nodes, max) => {
      const byId = new Map<string, { text: string; hrefs: string[]; images: string[] }>();
      const fallbacks: Array<{ text: string; hrefs: string[]; images: string[] }> = [];
      for (const node of nodes) {
        const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text || text.length < 40 || !text.includes("Library ID")) continue;
        const ids = Array.from(text.matchAll(/Library ID[:\s]+(\d+)/gi)).map((match) => match[1]);
        if (ids.length > 1) continue;
        const element = node as Element;
        const card = {
          text,
          hrefs: Array.from(element.querySelectorAll("a"))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter(Boolean),
          images: Array.from(element.querySelectorAll("img"))
            .map((img) => (img as HTMLImageElement).src)
            .filter((src) => /^https?:\/\//.test(src)),
        };
        const id = ids[0];
        if (!id) {
          fallbacks.push(card);
          continue;
        }
        const previous = byId.get(id);
        if (!previous || card.text.length > previous.text.length) byId.set(id, card);
      }
      return [...byId.values(), ...fallbacks].slice(0, Number(max));
    }, limit);

    const ads = cards.map((card, index): MetaAdLibraryAd => {
      const libraryId = card.text.match(/Library ID[:\s]+(\d+)/i)?.[1];
      const pageName = asText(card.text.match(/Page ID[:\s]+\d+\s+([^·|]+)/i)?.[1]) ?? input.pageName;
      const snapshotUrl = card.hrefs.find((href) => href.includes("/ads/library/")) ?? url;
      const landingPageUrl = card.hrefs.find((href) => !href.includes("facebook.com") && !href.includes("fbcdn.net")) ?? null;
      // Meta prints either a range "Mon D, YYYY - Mon D, YYYY" or, for active
      // ads, a single "Started running on Mon D, YYYY". Capture both forms.
      const dateRange = card.text.match(/([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})\s+-\s+([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4}|Present)/);
      const startedOn = card.text.match(/Started running on\s+([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})/i);
      const activeStatus = /Inactive/i.test(card.text)
        ? "INACTIVE"
        : /Active/i.test(card.text)
          ? "ACTIVE"
          : null;
      const platforms = ["facebook", "instagram", "messenger", "audience network"]
        .filter((platform) => card.text.toLowerCase().includes(platform));
      const adText = trimAdText(card.text);

      return {
        adArchiveId: libraryId ?? makeStableArchiveId(input.pageName, index, card.text),
        pageName,
        pageId: input.pageId ?? null,
        adCopy: asText(adText.slice(0, 3000)),
        headline: null,
        description: null,
        cta: null,
        landingPageUrl,
        adSnapshotUrl: snapshotUrl,
        platforms,
        startDate: parseDate(dateRange?.[1] ?? startedOn?.[1]),
        endDate: dateRange?.[2] && dateRange[2] !== "Present" ? parseDate(dateRange[2]) : null,
        activeStatus,
        creativeType: null,
        imageUrl: card.images[0] ?? null,
        videoUrl: null,
        rawPayload: {
          source: "playwright_scraper",
          url,
          text: card.text,
          hrefs: card.hrefs.slice(0, 20),
          images: card.images.slice(0, 5),
        },
      };
    });

    return { ads };
  } finally {
    await browser.close();
  }
}
