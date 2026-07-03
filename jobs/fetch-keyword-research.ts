import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fetchSearchVolume } from "@/lib/connectors/dataforseo-keywords";
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
  const source = String(data.source ?? "dataforseo");
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
  // DataForSEO's bulk search-volume lookup is a single batched call, so cover
  // all active seeds by default. Cap at 100 as a safety bound.
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

    const volumeResult = await fetchSearchVolume(seeds.map((seed) => seed.keyword));
    if (volumeResult.disabled) {
      summary.disabledSources.push("dataforseo");
    }

    for (const seed of seeds) {
      const avgMonthlySearches = volumeResult.volumes.get(seed.keyword.toLowerCase().trim()) ?? null;
      if (avgMonthlySearches === null) continue;
      const write = await saveKeywordResearchResult({
        jobRunId: runId,
        marketKeywordId: seed.id,
        seedKeyword: seed.keyword,
        keyword: seed.keyword,
        source: "dataforseo",
        locationName: seed.locationName ?? process.env.MARKET_INTEL_DEFAULT_LOCATION ?? "Philippines",
        languageCode: seed.languageCode ?? "en",
        avgMonthlySearches,
        competition: null,
        competitionIndex: null,
        lowTopOfPageBidMicros: null,
        highTopOfPageBidMicros: null,
        monthlySearchVolumes: Prisma.JsonNull,
        rawPayload: Prisma.JsonNull,
        capturedAt,
      });
      summary.researchRowsStored++;
      if (write === "created") summary.researchRowsCreated++;
      else summary.researchRowsUpdated++;
    }

    // Long-tail keyword-idea discovery and auto-promotion into the active seed
    // list (previously via Google Ads Keyword Planner's idea-expansion API) has
    // no equivalent here — DataForSEO's bulk search-volume endpoint only returns
    // volume for keywords you already supply, it does not expand or discover new
    // ones. Google Ads is not a supported data source. Revisit with DataForSEO
    // Labs or a similar vendor if keyword discovery is wanted back.

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
