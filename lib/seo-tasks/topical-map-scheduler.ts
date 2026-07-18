import { prisma } from "@/lib/db";
import {
  CreateSeoTaskSchema,
  type CreateSeoTaskInput,
  type SeoTaskMutation,
} from "@/lib/seo-tasks/contracts";
import {
  createSeoTask,
  mutateSeoTask,
  type CreateSeoTaskResult,
  type MutateSeoTaskResult,
} from "@/lib/seo-tasks/service";
import {
  analysisEvidenceState,
  mapCandidateId,
  readAnalysisForStrategy,
  type MapAwareSeoAnalysis,
} from "@/lib/seo/analysis";
import {
  loadActiveTopicalMapCommandCenter,
  type CommandCenterPage,
} from "@/lib/topical-map/command-center";
import { topicalMapActionEligibility } from "@/lib/topical-map/action-eligibility";
import { getLatestSnapshot } from "@/lib/seo/snapshot";
import {
  getBlockingMappedContentProposals,
  mappedContentIdentityFromTask,
} from "@/lib/content-pilot/map-candidate-history";

const SITE_HOST = "agrikoph.com";
const ACTOR = "system:topical-map-task-scheduler";
const SOURCE_PREFIX = "topical-map-phase:";
export const CONTENT_SOURCE_PREFIX = "topical-map-content:";
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const PHASE_HEADING = /^Days ([1-9]\d*)-([1-9]\d*): (.+)$/;
const ON_OR_AFTER_DATE = /\bOn or after (\d{4}-\d{2}-\d{2})\b/g;

type CompiledRuleRecord = {
  ruleId: string;
  compiledPayload: unknown;
};

type ProjectionInput = {
  strategyVersionId: string;
  strategyVersion: string;
  packageSha256: string;
  activatedAt: Date;
  now: Date;
  horizonDays: number;
  rules: CompiledRuleRecord[];
};

type SchedulerDb = {
  topicalMapActivation: {
    findUnique(args: unknown): Promise<unknown>;
  };
  seoFollowUpTask: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
};

type SyncDependencies = {
  db?: SchedulerDb;
  now?: Date;
  createTask?: (
    input: CreateSeoTaskInput,
    actor: string,
  ) => Promise<CreateSeoTaskResult>;
  mutateTask?: (
    id: string,
    action: SeoTaskMutation,
    actor: string,
    now: Date,
    options?: { skipMappedProposalPreflight?: boolean },
  ) => Promise<MutateSeoTaskResult>;
  loadContentState?: () => Promise<{
    pages: CommandCenterPage[];
    analysis: MapAwareSeoAnalysis;
  } | null>;
  getBlockingProposals?: typeof getBlockingMappedContentProposals;
};

export type TopicalMapSeoTaskSyncResult = {
  status: "synced" | "no_active_strategy";
  strategyVersionId: string | null;
  projected: number;
  created: number;
  existing: number;
  superseded: number;
};

type SafeScheduleRule = {
  ruleId: string;
  phase: {
    startDay: number;
    endDay: number;
    label: string;
  };
  literalText: string;
};

type ContentProjectionInput = Omit<ProjectionInput, "rules"> & {
  pages: CommandCenterPage[];
  analysis: MapAwareSeoAnalysis;
  rules: CompiledRuleRecord[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSafeScheduleBoundary(value: unknown): boolean {
  return isRecord(value)
    && value.operationMode === "proposal_only"
    && value.executionProhibited === true
    && value.elapsedTimeAuthorizesAction === false
    && value.satisfactionCanTriggerMutation === false
    && value.independentSafeguardsRequired === true
    && value.absentEvidenceNonExecutable === true;
}

function parsePhaseHeading(value: unknown) {
  if (typeof value !== "string") return null;
  const match = PHASE_HEADING.exec(value);
  if (!match) return null;
  const startDay = Number(match[1]);
  const endDay = Number(match[2]);
  const label = match[3]?.trim() ?? "";
  if (!label || endDay < startDay || endDay > 365) return null;
  return { startDay, endDay, label };
}

function parseSafeScheduleRule(record: CompiledRuleRecord): SafeScheduleRule | null {
  if (!isRecord(record.compiledPayload)) return null;
  const compiled = record.compiledPayload;
  if (compiled.type !== "literal_schedule_obligation"
    || compiled.resolutionStatus !== "resolved"
    || !hasSafeScheduleBoundary(compiled.scheduleAuthorityBoundary)
    || !isRecord(compiled.payload)
    || compiled.payload.name !== "schedule-obligation"
    || typeof compiled.payload.literalText !== "string"
    || compiled.payload.literalText.trim().length === 0
    || !Array.isArray(compiled.sourceReferences)) {
    return null;
  }

  const phases = compiled.sourceReferences.flatMap((reference) => {
    if (!isRecord(reference) || !isRecord(reference.locator)) return [];
    const headingPath = reference.locator.headingPath;
    if (!Array.isArray(headingPath)) return [];
    const phase = parsePhaseHeading(headingPath.at(-1));
    return phase ? [phase] : [];
  });
  if (phases.length !== 1) return null;

  return {
    ruleId: record.ruleId,
    phase: phases[0]!,
    literalText: compiled.payload.literalText.trim(),
  };
}

function manilaDateStartFromInstant(value: Date): number {
  const shifted = new Date(value.getTime() + MANILA_OFFSET_MS);
  return Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  ) - MANILA_OFFSET_MS;
}

function strictManilaDateStart(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const parsed = new Date(utc);
  if (parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day) {
    return null;
  }
  return utc - MANILA_OFFSET_MS;
}

function explicitReviewStart(obligations: SafeScheduleRule[]): number | null {
  const starts = obligations.flatMap(({ literalText }) => {
    const matches = [...literalText.matchAll(ON_OR_AFTER_DATE)];
    return matches.flatMap((match) => {
      const start = strictManilaDateStart(match[1] ?? "");
      return start === null ? [] : [start];
    });
  });
  return starts.length > 0 ? Math.max(...starts) : null;
}

function contentPriority(value: string | undefined): "P0" | "P1" | "P2" | "P3" {
  const priority = value?.trim().toUpperCase();
  return priority === "P0" || priority === "P1" || priority === "P2" || priority === "P3"
    ? priority
    : "P2";
}

function contentAction(value: string): "create" | "refresh" | null {
  if (/\b(?:only if|unless|pending|dossier|manual review|medical review)\b/i.test(value)) {
    return null;
  }
  if (/\b(?:create|publish)\b/i.test(value)) return "create";
  if (/\b(?:refresh|strengthen|rewrite|expand|improve|optimi[sz]e)\b/i.test(value)) {
    return "refresh";
  }
  return null;
}

function exactBlogUrls(value: string): string[] {
  return [...new Set(
    value.match(/\/blogs\/[a-z0-9-]+\/[a-z0-9-]+/gi) ?? [],
  )].sort();
}

type ContentPhase = {
  phase: SafeScheduleRule["phase"];
  ruleIds: string[];
  earliestReviewAt: Date;
  dueAt: Date;
};

function contentPhasesByUrl(input: ContentProjectionInput): Map<string, ContentPhase> {
  const activationDayStart = manilaDateStartFromInstant(input.activatedAt);
  const horizonEnd = input.now.getTime() + input.horizonDays * DAY_MS;
  const candidates = new Map<string, Array<SafeScheduleRule & { action: "create" | "refresh" }>>();

  for (const record of input.rules) {
    const rule = parseSafeScheduleRule(record);
    if (!rule) continue;
    const action = contentAction(rule.literalText);
    if (!action) continue;
    for (const targetUrl of exactBlogUrls(rule.literalText)) {
      candidates.set(targetUrl, [
        ...(candidates.get(targetUrl) ?? []),
        { ...rule, action },
      ]);
    }
  }

  const result = new Map<string, ContentPhase>();
  for (const [targetUrl, rules] of candidates) {
    const sorted = [...rules].sort((left, right) =>
      left.phase.startDay - right.phase.startDay || left.ruleId.localeCompare(right.ruleId));
    const earliest = sorted[0]!;
    const samePhase = sorted.filter((rule) =>
      rule.phase.startDay === earliest.phase.startDay
      && rule.phase.endDay === earliest.phase.endDay
      && rule.action === earliest.action);
    const reviewStart = explicitReviewStart(samePhase)
      ?? activationDayStart + (earliest.phase.startDay - 1) * DAY_MS;
    const phaseEnd = activationDayStart + earliest.phase.endDay * DAY_MS - 1;
    if (reviewStart > horizonEnd || reviewStart > phaseEnd) continue;
    result.set(`${earliest.action}\u001f${targetUrl}`, {
      phase: earliest.phase,
      ruleIds: samePhase.map((rule) => rule.ruleId).sort(),
      earliestReviewAt: new Date(reviewStart),
      dueAt: new Date(phaseEnd),
    });
  }
  return result;
}

function sameRules(left: string[], right: string[]): boolean {
  return [...left].sort().join("\u001f") === [...right].sort().join("\u001f");
}

export function projectTopicalMapContentTasks(
  input: ContentProjectionInput,
): CreateSeoTaskInput[] {
  const pageByUrl = new Map(input.pages.map((page) => [page.url, page]));
  const phases = contentPhasesByUrl(input);
  const projected = new Map<string, {
    candidateId: string;
    action: "create" | "refresh";
    page: CommandCenterPage;
    phase: ContentPhase | null;
    current: boolean;
  }>();

  for (const gap of input.analysis.gaps) {
    if (gap.kind !== "content" || !gap.page) continue;
    const page = pageByUrl.get(gap.page);
    if (!page?.decision
      || !page.contentDecisionPolicy
      || !topicalMapActionEligibility(page.contentDecisionPolicy).actionable
      || !sameRules(page.ruleIds, gap.ruleIds)) {
      continue;
    }
    const action = gap.action === "create" ? "create" : "refresh";
    projected.set(gap.candidateId, {
      candidateId: gap.candidateId,
      action,
      page,
      phase: phases.get(`${action}\u001f${page.url}`) ?? null,
      current: true,
    });
  }

  for (const page of input.pages) {
    if (!page.decision
      || !page.contentDecisionPolicy
      || !topicalMapActionEligibility(page.contentDecisionPolicy).actionable) {
      continue;
    }
    const scheduled = (["create", "refresh"] as const)
      .flatMap((action) => {
        const phase = phases.get(`${action}\u001f${page.url}`);
        return phase ? [{ action, phase }] : [];
      })
      .sort((left, right) =>
        left.phase.earliestReviewAt.getTime() - right.phase.earliestReviewAt.getTime());
    const selected = scheduled[0];
    if (!selected) continue;
    const { action, phase } = selected;
    if (!phase || phase.earliestReviewAt.getTime() <= input.now.getTime()) continue;
    const candidateId = mapCandidateId({
      strategyVersionId: input.strategyVersionId,
      packageSha256: input.packageSha256,
      kind: "content",
      action,
      ruleIds: page.ruleIds,
      page: page.url,
    });
    const alreadyCurrent = [...projected.values()].some((item) =>
      item.current && item.action === action && item.page.url === page.url);
    if (!alreadyCurrent && !projected.has(candidateId)) {
      projected.set(candidateId, { candidateId, action, page, phase, current: false });
    }
  }

  return [...projected.values()]
    .sort((left, right) =>
      Number(right.current) - Number(left.current)
      || (left.phase?.earliestReviewAt.getTime() ?? 0) - (right.phase?.earliestReviewAt.getTime() ?? 0)
      || left.page.url.localeCompare(right.page.url))
    .map(({ candidateId, action, page, phase, current }) => {
      const ruleIds = [...page.ruleIds].sort();
      const parsed = CreateSeoTaskSchema.safeParse({
        taskType: "content_quality_review",
        title: page.title ?? page.url,
        description: page.decision!,
        targetUrl: page.url,
        topicalCluster: page.cluster ?? null,
        pageRole: page.role ?? null,
        ownerSurface: "content",
        destinationPath: "/content-pilot",
        priority: contentPriority(page.priority),
        earliestReviewAt: current ? input.now : phase!.earliestReviewAt,
        dueAt: current ? null : phase!.dueAt,
        requiresEvidence: false,
        evidenceRequirement: {
          kind: "topical-map-content",
          action,
          candidateId,
          ruleIds,
        },
        evidenceStatus: "not_required",
        sourceType: "topical_map",
        sourceKey: `${CONTENT_SOURCE_PREFIX}${input.strategyVersionId}:${candidateId}`,
        sourceData: {
          candidateId,
          targetUrl: page.url,
          mapTitle: page.title ?? page.url,
          mapDecision: page.decision,
          action,
          priority: contentPriority(page.priority),
          topicalCluster: page.cluster ?? null,
          pageRole: page.role ?? null,
          strategyVersionId: input.strategyVersionId,
          strategyVersion: input.strategyVersion,
          packageSha256: input.packageSha256,
          ruleIds,
          ...(phase ? {
            phase: phase.phase,
            phaseRuleIds: phase.ruleIds,
            phaseReviewAt: phase.earliestReviewAt.toISOString(),
            phaseDueAt: phase.dueAt.toISOString(),
          } : {}),
        },
      });
      if (!parsed.success) {
        throw new Error(`Invalid topical-map content task ${page.url}.`);
      }
      return parsed.data;
    });
}

export function projectTopicalMapPhaseTasks(
  input: ProjectionInput,
): CreateSeoTaskInput[] {
  const activationDayStart = manilaDateStartFromInstant(input.activatedAt);
  const horizonEnd = input.now.getTime() + input.horizonDays * DAY_MS;
  const grouped = new Map<string, SafeScheduleRule[]>();

  for (const record of input.rules) {
    const rule = parseSafeScheduleRule(record);
    if (!rule) continue;
    const key = `${rule.phase.startDay}-${rule.phase.endDay}`;
    const existing = grouped.get(key) ?? [];
    existing.push(rule);
    grouped.set(key, existing);
  }

  return [...grouped.values()]
    .sort((left, right) => left[0]!.phase.startDay - right[0]!.phase.startDay)
    .flatMap((obligations) => {
      const phase = obligations[0]!.phase;
      const phaseStart = activationDayStart + (phase.startDay - 1) * DAY_MS;
      const reviewStart = explicitReviewStart(obligations) ?? phaseStart;
      const phaseEnd = activationDayStart + phase.endDay * DAY_MS - 1;
      if (reviewStart > horizonEnd || reviewStart > phaseEnd) return [];

      const sorted = [...obligations].sort((left, right) =>
        left.ruleId.localeCompare(right.ruleId));
      const parsed = CreateSeoTaskSchema.safeParse({
        taskType: "other",
        title: `Review topical-map phase: ${phase.label}`,
        description: sorted
          .map((rule, index) => `${index + 1}. ${rule.literalText}`)
          .join("\n"),
        targetUrl: null,
        topicalCluster: null,
        pageRole: "90-day phase",
        ownerSurface: "seo",
        destinationPath: "/seo-pillar",
        priority: /\bP0\b/.test(phase.label) ? "P0" : "P2",
        earliestReviewAt: new Date(reviewStart),
        dueAt: new Date(phaseEnd),
        requiresEvidence: false,
        evidenceRequirement: {
          kind: "topical-map-phase-review",
          phase,
          ruleIds: sorted.map((rule) => rule.ruleId),
          proposalOnly: true,
          executionProhibited: true,
          independentSafeguardsRequired: true,
        },
        evidenceStatus: "not_required",
        sourceType: "topical_map",
        sourceKey: `${SOURCE_PREFIX}${input.strategyVersionId}:${phase.startDay}-${phase.endDay}`,
        sourceData: {
          strategyVersionId: input.strategyVersionId,
          strategyVersion: input.strategyVersion,
          packageSha256: input.packageSha256,
          phase,
          ruleIds: sorted.map((rule) => rule.ruleId),
          proposalOnly: true,
          executionProhibited: true,
        },
      });
      if (!parsed.success) {
        throw new Error(`Invalid topical-map phase task ${phase.startDay}-${phase.endDay}.`);
      }
      return [parsed.data];
    });
}

function parseActiveStrategy(value: unknown): {
  id: string;
  strategyVersion: string;
  packageSha256: string;
  activatedAt: Date;
  compiledRules: CompiledRuleRecord[];
} | null {
  if (!isRecord(value) || !isRecord(value.strategyVersion)) return null;
  const strategy = value.strategyVersion;
  if (typeof strategy.id !== "string"
    || typeof strategy.strategyVersion !== "string"
    || typeof strategy.packageSha256 !== "string"
    || !(strategy.activatedAt instanceof Date)
    || !Array.isArray(strategy.compiledRules)) {
    throw new Error("Active topical-map strategy is incomplete.");
  }
  return {
    id: strategy.id,
    strategyVersion: strategy.strategyVersion,
    packageSha256: strategy.packageSha256,
    activatedAt: strategy.activatedAt,
    compiledRules: strategy.compiledRules.flatMap((rule) => {
      if (!isRecord(rule) || typeof rule.ruleId !== "string") return [];
      return [{ ruleId: rule.ruleId, compiledPayload: rule.compiledPayload }];
    }),
  };
}

export async function syncTopicalMapSeoTasks(
  dependencies: SyncDependencies = {},
): Promise<TopicalMapSeoTaskSyncResult> {
  const db = dependencies.db ?? (prisma as unknown as SchedulerDb);
  const now = dependencies.now ?? new Date();
  const createTask = dependencies.createTask ?? createSeoTask;
  const mutateTask = dependencies.mutateTask ?? mutateSeoTask;
  const active = parseActiveStrategy(await db.topicalMapActivation.findUnique({
    where: { siteHost: SITE_HOST },
    select: {
      strategyVersion: {
        select: {
          id: true,
          strategyVersion: true,
          packageSha256: true,
          activatedAt: true,
          compiledRules: {
            where: { ruleType: "evidence_gates" },
            select: { ruleId: true, compiledPayload: true },
          },
        },
      },
    },
  }));

  if (!active) {
    return {
      status: "no_active_strategy",
      strategyVersionId: null,
      projected: 0,
      created: 0,
      existing: 0,
      superseded: 0,
    };
  }

  const phaseTasks = projectTopicalMapPhaseTasks({
    strategyVersionId: active.id,
    strategyVersion: active.strategyVersion,
    packageSha256: active.packageSha256,
    activatedAt: active.activatedAt,
    now,
    horizonDays: 90,
    rules: active.compiledRules,
  });
  const loadContentState = dependencies.loadContentState
    ?? (dependencies.db
      ? async () => null
      : async () => {
          const [commandCenter, snapshot] = await Promise.all([
            loadActiveTopicalMapCommandCenter(prisma),
            getLatestSnapshot("seo_analysis"),
          ]);
          if (!commandCenter
            || !snapshot
            || commandCenter.identity.versionId !== active.id
            || commandCenter.identity.packageSha256 !== active.packageSha256
            || analysisEvidenceState(snapshot.payload, now) !== "current") {
            return null;
          }
          const analysis = readAnalysisForStrategy(snapshot.payload, commandCenter.identity);
          return analysis ? { pages: commandCenter.pages, analysis } : null;
        });
  const contentState = await loadContentState();
  const projectedContentTasks = contentState
    ? projectTopicalMapContentTasks({
        strategyVersionId: active.id,
        strategyVersion: active.strategyVersion,
        packageSha256: active.packageSha256,
        activatedAt: active.activatedAt,
        now,
        horizonDays: 90,
        pages: contentState.pages,
        analysis: contentState.analysis,
        rules: active.compiledRules,
      })
    : [];
  const contentIdentities = projectedContentTasks.flatMap((task) => {
    const identity = mappedContentIdentityFromTask({
      sourceKey: task.sourceKey,
      sourceData: task.sourceData,
      targetUrl: task.targetUrl ?? null,
      title: task.title,
    });
    return identity ? [identity] : [];
  });
  const blockedProposals = contentIdentities.length > 0
    ? await (dependencies.getBlockingProposals ?? getBlockingMappedContentProposals)(
        prisma,
        contentIdentities,
      )
    : new Map<string, string>();
  const completedContentTasks = projectedContentTasks.length > 0
    ? await db.seoFollowUpTask.findMany({
        where: {
          status: "completed",
          sourceType: "topical_map",
          sourceKey: { startsWith: CONTENT_SOURCE_PREFIX },
          targetUrl: {
            in: projectedContentTasks.flatMap((task) => task.targetUrl ? [task.targetUrl] : []),
          },
        },
        select: {
          sourceKey: true,
          sourceData: true,
          targetUrl: true,
          title: true,
        },
      })
    : [];
  const completedContentKeys = new Set(completedContentTasks.flatMap((task) => {
    if (typeof task.sourceKey !== "string"
      || typeof task.title !== "string"
      || (typeof task.targetUrl !== "string" && task.targetUrl !== null)) {
      return [];
    }
    const identity = mappedContentIdentityFromTask({
      sourceKey: task.sourceKey,
      sourceData: task.sourceData,
      targetUrl: task.targetUrl,
      title: task.title,
    });
    return identity ? [`${identity.action}\u001f${identity.page}`] : [];
  }));
  const contentTasks = projectedContentTasks.filter((task) => {
    const identity = mappedContentIdentityFromTask({
      sourceKey: task.sourceKey,
      sourceData: task.sourceData,
      targetUrl: task.targetUrl ?? null,
      title: task.title,
    });
    return identity
      && !blockedProposals.has(identity.candidateId)
      && !completedContentKeys.has(`${identity.action}\u001f${identity.page}`);
  });
  const projected = [...phaseTasks, ...contentTasks];
  let created = 0;
  let existing = 0;

  for (const task of projected) {
    const result = await createTask(task, ACTOR);
    if (result.outcome === "created") created += 1;
    else existing += 1;
  }

  const currentPhasePrefix = `${SOURCE_PREFIX}${active.id}:`;
  const currentContentPrefix = `${CONTENT_SOURCE_PREFIX}${active.id}:`;
  const openTopicalMapTasks = await db.seoFollowUpTask.findMany({
    where: {
      status: "open",
      sourceType: "topical_map",
      OR: [
        { sourceKey: { startsWith: SOURCE_PREFIX } },
        { sourceKey: { startsWith: CONTENT_SOURCE_PREFIX } },
      ],
      NOT: {
        OR: [
          { sourceKey: { startsWith: currentPhasePrefix } },
          { sourceKey: { startsWith: currentContentPrefix } },
        ],
      },
    },
    select: { id: true, version: true },
  });
  let superseded = 0;
  for (const task of openTopicalMapTasks) {
    if (typeof task.id !== "string" || typeof task.version !== "number") continue;
    const result = await mutateTask(
      task.id,
      {
        action: "cancel",
        expectedVersion: task.version,
        note: `Superseded by active topical-map strategy ${active.id}.`,
        decisionData: { supersededByStrategyVersionId: active.id },
      },
      ACTOR,
      now,
      { skipMappedProposalPreflight: true },
    );
    if (result.outcome !== "updated") {
      throw new Error(`Could not supersede stale topical-map SEO task ${task.id}.`);
    }
    superseded += 1;
  }

  const blockedSourceKeys = projectedContentTasks.flatMap((task) => {
    const identity = mappedContentIdentityFromTask({
      sourceKey: task.sourceKey,
      sourceData: task.sourceData,
      targetUrl: task.targetUrl ?? null,
      title: task.title,
    });
    return identity
      && (blockedProposals.has(identity.candidateId)
        || completedContentKeys.has(`${identity.action}\u001f${identity.page}`))
      ? [task.sourceKey]
      : [];
  });
  if (blockedSourceKeys.length > 0) {
    const handledOpenTasks = await db.seoFollowUpTask.findMany({
      where: {
        status: "open",
        sourceType: "topical_map",
        sourceKey: { in: blockedSourceKeys },
      },
      select: { id: true, version: true },
    });
    for (const task of handledOpenTasks) {
      if (typeof task.id !== "string" || typeof task.version !== "number") continue;
      const result = await mutateTask(
        task.id,
        {
          action: "cancel",
          expectedVersion: task.version,
          note: "Corresponding content work is already recorded in task or proposal history.",
          decisionData: { reconciledBy: ACTOR },
        },
        ACTOR,
        now,
        { skipMappedProposalPreflight: true },
      );
      if (result.outcome !== "updated") {
        throw new Error(`Could not reconcile handled topical-map SEO task ${task.id}.`);
      }
      superseded += 1;
    }
  }

  return {
    status: "synced",
    strategyVersionId: active.id,
    projected: projected.length,
    created,
    existing,
    superseded,
  };
}
