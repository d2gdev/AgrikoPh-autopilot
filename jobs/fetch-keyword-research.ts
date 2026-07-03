import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fetchGoogleAdsKeywordResearch, fetchGoogleAdsKeywordIdeas } from "@/lib/connectors/google-ads";
import { envInt } from "@/lib/market-intel/profiles";
import type { JobResult, JobStatus } from "@/lib/jobs/types";

type FetchKeywordResearchSummary = {
  keywordsChecked: number;
  researchRowsStored: number;
  researchRowsCreated: number;
  researchRowsUpdated: number;
  ideaRowsStored: number;
  ideaRowsCreated: number;
  ideaRowsUpdated: number;
  keywordsPromoted: number;
  disabledSources: string[];
};

type FetchKeywordResearchOptions = {
  runId?: string;
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function getOrCreateRunId(runId?: string): Promise<string> {
  if (!runId) {
    const run = await prisma.jobRun.create({
      data: { jobName: "fetch-keyword-research" },
      select: { id: true },
    });
    return run.id;
  }

  const existing = await prisma.jobRun.findUnique({
    where: { id: runId },
    select: { id: true, jobName: true },
  });
  if (!existing) {
    throw new Error(`Keyword research run not found: ${runId}`);
  }
  if (existing.jobName !== "fetch-keyword-research") {
    throw new Error(`Run ${runId} belongs to ${existing.jobName}, not fetch-keyword-research`);
  }
  return existing.id;
}

function micros(value: string | null | undefined): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function captureDayRange(capturedAt: Date) {
  const start = new Date(Date.UTC(capturedAt.getUTCFullYear(), capturedAt.getUTCMonth(), capturedAt.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function nullableStringFilter(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim();
  return normalized === "" ? null : normalized;
}

async function saveKeywordResearchResult(data: Prisma.KeywordResearchResultUncheckedCreateInput): Promise<"created" | "updated"> {
  const capturedAt = data.capturedAt instanceof Date ? data.capturedAt : new Date(String(data.capturedAt ?? Date.now()));
  const { start } = captureDayRange(capturedAt);
  const keyword = String(data.keyword);
  const source = String(data.source ?? "google_ads");
  const locationNameFilter = nullableStringFilter(data.locationName == null ? null : String(data.locationName));
  const languageCodeFilter = nullableStringFilter(data.languageCode == null ? null : String(data.languageCode));
  const existing = await prisma.keywordResearchResult.findUnique({
    where: {
      source_keyword_locationNameForDedupe_languageCodeForDedupe_captureDate: {
        source,
        keyword,
        languageCodeForDedupe: languageCodeFilter ?? "",
        locationNameForDedupe: locationNameFilter ?? "",
        captureDate: start,
      },
    },
    select: { id: true },
  });

  const payload = {
    ...data,
    languageCodeForDedupe: languageCodeFilter ?? "",
    locationNameForDedupe: locationNameFilter ?? "",
    captureDate: start,
    source,
    keyword,
    languageCode: languageCodeFilter,
    locationName: locationNameFilter,
  } as Prisma.KeywordResearchResultUncheckedCreateInput;

  await prisma.keywordResearchResult.upsert({
    where: {
      source_keyword_locationNameForDedupe_languageCodeForDedupe_captureDate: {
        source,
        keyword,
        languageCodeForDedupe: languageCodeFilter ?? "",
        locationNameForDedupe: locationNameFilter ?? "",
        captureDate: start,
      },
    },
    create: payload,
    update: payload,
  });

  return existing ? "updated" : "created";
}

export async function fetchKeywordResearchHandler(
  options: FetchKeywordResearchOptions = {},
): Promise<JobResult<FetchKeywordResearchSummary>> {
  const runId = await getOrCreateRunId(options.runId);
  // Keyword Planner volume lookup + idea expansion is a single batched call, so
  // cover all active seeds by default. Cap at 100 as a safety bound.
  const keywordLimit = Math.max(1, envInt(process.env.MARKET_INTEL_KEYWORD_LIMIT, 100));
  const capturedAt = new Date();
  const summary: FetchKeywordResearchSummary = {
    keywordsChecked: 0,
    researchRowsStored: 0,
    researchRowsCreated: 0,
    researchRowsUpdated: 0,
    ideaRowsStored: 0,
    ideaRowsCreated: 0,
    ideaRowsUpdated: 0,
    keywordsPromoted: 0,
    disabledSources: [],
  };
  const errors: string[] = [];

  try {
    const seeds = await prisma.marketKeyword.findMany({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      take: keywordLimit,
    });
    summary.keywordsChecked = seeds.length;

    const research = await fetchGoogleAdsKeywordResearch({
      keywords: seeds.map((seed) => seed.keyword),
    });
    if (research.disabled) {
      summary.disabledSources.push("google_ads");
    }

    for (const result of research.results) {
      const seed = seeds.find((item) => item.keyword.toLowerCase() === result.keyword.toLowerCase())
        ?? seeds.find((item) => result.closeVariants.map((variant) => variant.toLowerCase()).includes(item.keyword.toLowerCase()));
      const write = await saveKeywordResearchResult({
        jobRunId: runId,
        marketKeywordId: seed?.id,
        seedKeyword: seed?.keyword ?? result.keyword,
        keyword: result.keyword,
        source: "google_ads",
        locationName: seed?.locationName ?? process.env.MARKET_INTEL_DEFAULT_LOCATION ?? "Philippines",
        languageCode: seed?.languageCode ?? "en",
        avgMonthlySearches: result.avgMonthlySearches,
        competition: result.competition,
        competitionIndex: result.competitionIndex,
        lowTopOfPageBidMicros: micros(result.lowTopOfPageBidMicros),
        highTopOfPageBidMicros: micros(result.highTopOfPageBidMicros),
        monthlySearchVolumes: json(result.monthlySearchVolumes),
        rawPayload: json(result.rawPayload),
        capturedAt,
      });
      summary.researchRowsStored++;
      if (write === "created") summary.researchRowsCreated++;
      else summary.researchRowsUpdated++;
    }

    // Long-tail discovery: expand the seeds (and optionally the store URL) into
    // NEW keyword ideas the seed list never contained, then store the fresh ones.
    const ideaLimit = Math.max(0, envInt(process.env.MARKET_INTEL_KEYWORD_IDEAS_LIMIT, 50));
    if (ideaLimit > 0 && seeds.length > 0) {
      const ideas = await fetchGoogleAdsKeywordIdeas({
        seedKeywords: seeds.map((seed) => seed.keyword),
        pageUrl: process.env.MARKET_INTEL_KEYWORD_SEED_URL ?? null,
        limit: ideaLimit,
      });
      if (ideas.disabled) {
        if (!summary.disabledSources.includes("google_ads")) summary.disabledSources.push("google_ads");
      } else {
        const seen = new Set(research.results.map((r) => r.keyword.toLowerCase()));
        const freshIdeas = ideas.results
          .filter((idea) => !seen.has(idea.keyword.toLowerCase()))
          .sort((a, b) => (b.avgMonthlySearches ?? 0) - (a.avgMonthlySearches ?? 0))
          .slice(0, ideaLimit);
        for (const idea of freshIdeas) {
          const seed = seeds.find((item) => idea.keyword.toLowerCase().includes(item.keyword.toLowerCase()));
          const write = await saveKeywordResearchResult({
            jobRunId: runId,
            marketKeywordId: seed?.id,
            seedKeyword: seed?.keyword ?? "(discovery)",
            keyword: idea.keyword,
            source: "google_ads_ideas",
            locationName: seed?.locationName ?? process.env.MARKET_INTEL_DEFAULT_LOCATION ?? "Philippines",
            languageCode: seed?.languageCode ?? "en",
            avgMonthlySearches: idea.avgMonthlySearches,
            competition: idea.competition,
            competitionIndex: idea.competitionIndex,
            lowTopOfPageBidMicros: micros(idea.lowTopOfPageBidMicros),
            highTopOfPageBidMicros: micros(idea.highTopOfPageBidMicros),
            monthlySearchVolumes: json(idea.monthlySearchVolumes),
            rawPayload: json(idea.rawPayload),
            capturedAt,
          });
          summary.ideaRowsStored++;
          if (write === "created") summary.ideaRowsCreated++;
          else summary.ideaRowsUpdated++;
        }

        // Discovery loop: promote the best on-brand long-tails into the active
        // seed list so the keyword universe compounds week over week. Hard-capped
        // at MAX_ACTIVE (100) to keep keyword discipline — curated keywords are
        // never evicted; discovery only fills remaining slots, highest-volume
        // first (freshIdeas is already sorted desc). On-brand = contains an Agriko
        // root and not in the stop-list. Promoted rows are tagged "Discovered" so
        // they're easy to review/revert.
        const ROOTS = [
          "rice", "turmeric", "ginger", "moringa", "malunggay", "honey", "salabat",
          "dulaw", "cacao", "blue ternate", "butterfly pea", "guyabano", "organic",
        ];
        const STOPLIST = [
          "red yeast rice", "ginger beer", "ginger ale", "ginger shot", "ginger snap",
          "ginger cat", "ginger hair", "jasmine rice", "fried rice", "rice cooker",
          "rice purity", "rice paper", "rice water hair",
        ];
        const MAX_ACTIVE = Math.max(1, Number(process.env.MARKET_INTEL_MAX_ACTIVE_KEYWORDS ?? 100));
        const PROMOTE_PER_RUN = Math.max(0, Number(process.env.MARKET_INTEL_PROMOTE_PER_RUN ?? 15));
        const PROMOTE_MIN_VOLUME = Math.max(0, Number(process.env.MARKET_INTEL_PROMOTE_MIN_VOLUME ?? 10));
        const onBrand = (kw: string) => {
          const k = kw.toLowerCase();
          if (STOPLIST.some((s) => k.includes(s))) return false;
          return ROOTS.some((r) => k.includes(r));
        };

        const activeCount = await prisma.marketKeyword.count({ where: { active: true } });
        let slots = Math.min(MAX_ACTIVE - activeCount, PROMOTE_PER_RUN);
        for (const idea of freshIdeas) {
          if (slots <= 0) break;
          if ((idea.avgMonthlySearches ?? 0) < PROMOTE_MIN_VOLUME) continue;
          if (!onBrand(idea.keyword)) continue;
          const exists = await prisma.marketKeyword.findFirst({
            where: { keyword: { equals: idea.keyword, mode: "insensitive" } },
            select: { id: true },
          });
          if (exists) continue;
          await prisma.marketKeyword.create({
            data: {
              keyword: idea.keyword,
              category: "Discovered",
              locationName: process.env.MARKET_INTEL_DEFAULT_LOCATION ?? "Philippines",
              languageCode: "en",
              active: true,
            },
          });
          summary.keywordsPromoted++;
          slots--;
        }
      }
    }

    const rowsStored = summary.researchRowsStored + summary.ideaRowsStored;
    if (rowsStored === 0 && summary.disabledSources.length === 0) {
      errors.push("No keyword research rows were stored.");
    }
    const status: JobStatus = summary.disabledSources.length === 0 && rowsStored > 0
      ? "success"
      : summary.disabledSources.length > 0
        ? "partial"
        : "failed";
    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        completedAt: new Date(),
        status,
        summary: json(summary),
        errorLog: errors.length > 0 ? errors.join("\n").slice(0, 10_000) : null,
      },
    });
    return { jobName: "fetch-keyword-research", runId, status, summary, errors };
  } catch (err) {
    const message = String(err).slice(0, 10_000);
    errors.push(message);
    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        completedAt: new Date(),
        status: "failed",
        summary: json(summary),
        errorLog: message,
      },
    });
    return { jobName: "fetch-keyword-research", runId, status: "failed", summary, errors };
  }
}
