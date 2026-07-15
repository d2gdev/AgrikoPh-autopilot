import type { SerperOrganicDevice, SerperOrganicResult } from "@/lib/connectors/serper-organic";
import type { SerperOrganicInput } from "@/lib/connectors/serper-organic";

export const FDA_ADVISORY_URL = "https://www.fda.gov.ph/fda-advisory-no-2026-0489-public-health-warning-against-the-purchase-and-consumption-of-the-unregistered-food-product-agriko-agriculture-keeps-organic-cacao-powder-with-5-in-1-turmeric-blend/";

export type BrandSerpObservation = {
  observedAt: string;
  provider: "serper";
  query: string;
  location: string;
  language: string;
  device: SerperOrganicDevice;
  organicPosition: number | "not_in_top_30";
  normalizedUrl: string;
  domain: string;
  title: string;
  isAdvisory: boolean;
  rawCaptureId: string;
};

export function normalizeBrandSerpUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.delete("srsltid");
  return url.toString();
}

function observation(input: {
  observedAt: string;
  query: string;
  location: string;
  language: string;
  device: SerperOrganicDevice;
  rawCaptureId: string;
}, item: SerperOrganicResult): BrandSerpObservation {
  const normalizedUrl = normalizeBrandSerpUrl(item.link);
  const advisory = normalizedUrl === FDA_ADVISORY_URL;
  return {
    ...input,
    provider: "serper",
    organicPosition: item.position,
    normalizedUrl,
    domain: new URL(normalizedUrl).hostname,
    title: item.title,
    isAdvisory: advisory,
  };
}

export function buildBrandSerpObservations(input: {
  observedAt: string;
  query: string;
  location: string;
  language: string;
  device: SerperOrganicDevice;
  rawCaptureId: string;
  results: SerperOrganicResult[];
}): BrandSerpObservation[] {
  const rows = input.results.map(item => observation(input, item));
  if (rows.some(row => row.isAdvisory)) return rows;
  return [...rows, {
    observedAt: input.observedAt,
    provider: "serper",
    query: input.query,
    location: input.location,
    language: input.language,
    device: input.device,
    organicPosition: "not_in_top_30",
    normalizedUrl: FDA_ADVISORY_URL,
    domain: "www.fda.gov.ph",
    title: "FDA Advisory No.2026-0489",
    isAdvisory: true,
    rawCaptureId: input.rawCaptureId,
  }];
}

const DAILY_CHECKS: Array<{ location: string; device: SerperOrganicDevice }> = [
  { location: "Philippines", device: "desktop" },
  { location: "Philippines", device: "mobile" },
  { location: "Cebu City, Central Visayas, Philippines", device: "desktop" },
  { location: "Cebu City, Central Visayas, Philippines", device: "mobile" },
];

export async function captureDailyBrandSerp(input: {
  observedAt: string;
  fetchResults: (input: SerperOrganicInput) => Promise<{ disabled?: boolean; results: SerperOrganicResult[] }>;
}) {
  const captures = [];
  const timestamp = input.observedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  for (const check of DAILY_CHECKS) {
    const response = await input.fetchResults({
      query: "agriko",
      location: check.location,
      countryCode: "ph",
      languageCode: "en",
      device: check.device,
      limit: 30,
    });
    if (response.disabled) throw new Error("SERPER_ORGANIC_UNAVAILABLE");
    const locationId = check.location === "Philippines" ? "ph" : "cebu";
    const rawCaptureId = `serper-${timestamp}-${locationId}-${check.device}`;
    captures.push({
      location: check.location,
      device: check.device,
      rawCaptureId,
      results: response.results,
      observations: buildBrandSerpObservations({
        observedAt: input.observedAt,
        query: "agriko",
        location: check.location,
        language: "en",
        device: check.device,
        rawCaptureId,
        results: response.results,
      }),
    });
  }
  return captures;
}

const OBSERVATION_HEADERS = [
  "observed_at", "provider", "query", "location", "language", "device",
  "organic_position", "normalized_url", "domain", "title", "is_advisory", "raw_capture_id",
];

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeBrandSerpObservations(
  observations: BrandSerpObservation[],
  options: { includeHeader: boolean },
): string {
  const rows: Array<Array<string | number | boolean>> = observations.map(row => [
    row.observedAt, row.provider, row.query, row.location, row.language, row.device,
    row.organicPosition, row.normalizedUrl, row.domain, row.title, row.isAdvisory, row.rawCaptureId,
  ]);
  const lines = options.includeHeader ? [OBSERVATION_HEADERS, ...rows] : rows;
  return `${lines.map(row => row.map(csvCell).join(",")).join("\n")}\n`;
}
