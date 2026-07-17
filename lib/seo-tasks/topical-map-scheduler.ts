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

const SITE_HOST = "agrikoph.com";
const ACTOR = "system:topical-map-task-scheduler";
const SOURCE_PREFIX = "topical-map-phase:";
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
    findMany(args: unknown): Promise<Array<{ id: string; version: number; sourceKey?: string }>>;
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
  ) => Promise<MutateSeoTaskResult>;
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

  const projected = projectTopicalMapPhaseTasks({
    strategyVersionId: active.id,
    strategyVersion: active.strategyVersion,
    packageSha256: active.packageSha256,
    activatedAt: active.activatedAt,
    now,
    horizonDays: 90,
    rules: active.compiledRules,
  });
  let created = 0;
  let existing = 0;

  for (const task of projected) {
    const result = await createTask(task, ACTOR);
    if (result.outcome === "created") created += 1;
    else existing += 1;
  }

  const currentPrefix = `${SOURCE_PREFIX}${active.id}:`;
  const openTopicalMapTasks = await db.seoFollowUpTask.findMany({
    where: {
      status: "open",
      sourceType: "topical_map",
      sourceKey: { startsWith: SOURCE_PREFIX },
      NOT: { sourceKey: { startsWith: currentPrefix } },
    },
    select: { id: true, version: true },
  });
  let superseded = 0;
  for (const task of openTopicalMapTasks) {
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
    );
    if (result.outcome !== "updated") {
      throw new Error(`Could not supersede stale topical-map SEO task ${task.id}.`);
    }
    superseded += 1;
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
