import { createHash } from "crypto";
import pLimit from "p-limit";
import type { RawSnapshot } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendOperatorAlert } from "@/lib/alerts";
import { checkGuardrails } from "@/lib/guardrails";
import { isSupportedAction } from "@/lib/executor";
import { loadAllSkillsSync } from "@/lib/skills/loader";
import { assembleDataPayload } from "@/lib/skills/runner";
import {
  checkSourceStatus,
  refreshSourcesOnce,
  selectBaseSnapshotForSource,
} from "@/lib/skills/source-registry";
import type {
  SkillDataSource,
  SkillDefinition,
} from "@/lib/skills/loader";
import type { JobResult, JobStatus } from "@/lib/jobs/types";
import type {
  SourceRefreshResult,
  SourceStatus,
} from "@/lib/skills/source-registry";

const MAX_SKILLS_PER_RUN = 30;

type RunSkillsSummary = {
  recommendationsGenerated: number;
  skillsRun: number;
  skillsSkipped: number;
  skillsTotal: number;
  skillHashes: Record<string, string>;
  skillLastRun: Record<string, string>;
  unsupportedSkipped: number;
  fatigueActions: { pauseRecs: number; refreshTasks: number };
  sourceStatus: Record<string, SourceStatus>;
  sourceRefreshes: Record<string, SourceRefreshResult>;
  skillsUnavailable: Array<{
    skillId: string;
    missingRequiredSources: string[];
    staleRequiredSources: string[];
    reason: string;
  }>;
};

type RunSkillsResult = JobResult<RunSkillsSummary> & { newRecs: number };

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function requiredSourcesForSkill(skill: SkillDefinition): SkillDataSource[] {
  if (skill.requiredSources?.length) return skill.requiredSources;
  if (skill.platform === "seo") return Array.from(new Set(skill.extraSources ?? []));
  return [];
}

function optionalSourcesForSkill(skill: SkillDefinition): SkillDataSource[] {
  const required = new Set(requiredSourcesForSkill(skill));
  const optional = [...(skill.optionalSources ?? []), ...(skill.extraSources ?? [])];
  return Array.from(new Set(optional.filter((source) => !required.has(source))));
}

function allContextSourcesForSkill(skill: SkillDefinition): SkillDataSource[] {
  return Array.from(new Set([
    ...requiredSourcesForSkill(skill),
    ...optionalSourcesForSkill(skill),
  ]));
}

function emptySummary(overrides: Partial<RunSkillsSummary> = {}): RunSkillsSummary {
  return {
    recommendationsGenerated: 0,
    skillsRun: 0,
    skillsSkipped: 0,
    skillsTotal: 0,
    skillHashes: {},
    skillLastRun: {},
    unsupportedSkipped: 0,
    fatigueActions: { pauseRecs: 0, refreshTasks: 0 },
    sourceStatus: {},
    sourceRefreshes: {},
    skillsUnavailable: [],
    ...overrides,
  };
}

// Deterministic pre-AI cache key for skip decisions. This intentionally hashes
// the assembled data/prompt inputs available before the model call, not dynamic
// KB grounding retrieval, provider behavior, or model output.
function hashSkillInputFingerprint(
  skill: SkillDefinition,
  snapshotPayload: Record<string, unknown>,
  extraContext?: Record<string, unknown>
): string {
  return hashPayload({
    version: 2,
    skillId: skill.id,
    skillName: skill.name,
    skillPromptHash: hashPayload(skill.fullPrompt),
    platform: skill.platform,
    insightBlock: skill.insightBlock ?? null,
    extraSources: skill.extraSources ?? [],
    assembledDataPayload: assembleDataPayload(skill, snapshotPayload, extraContext),
  });
}

export async function runSkillsHandler(): Promise<RunSkillsResult> {
  const runId = (
    await prisma.jobRun.create({ data: { jobName: "run-skills" } })
  ).id;

  const metaSnap = await prisma.rawSnapshot.findFirst({ where: { source: "meta" }, orderBy: { fetchedAt: "desc" } });

  // Load per-skill hashes stored from the last successful run
  const lastRun = await prisma.jobRun.findFirst({
    where: { jobName: "run-skills", status: { in: ["success", "partial"] }, id: { not: runId } },
    orderBy: { completedAt: "desc" },
  });
  const lastSkillHashes = (
    (lastRun?.summary as Record<string, unknown> | null)?.skillHashes ?? {}
  ) as Record<string, string>;
  const lastSkillLastRun = (
    (lastRun?.summary as Record<string, unknown> | null)?.skillLastRun ?? {}
  ) as Record<string, string>;

  const allSkills = loadAllSkillsSync().filter((s) => s.enabled);

  // H-9: filter to dispatchable platforms BEFORE cap so linkedin/reddit don't starve real skills
  const DISPATCHABLE_PLATFORMS: SkillDefinition["platform"][] = ["meta", "both", "seo"];
  const dispatchableSkills = allSkills.filter((skill) => DISPATCHABLE_PLATFORMS.includes(skill.platform));
  const requiredSourceFreshness: Partial<Record<SkillDataSource, number>> = {};
  for (const skill of dispatchableSkills) {
    const freshnessHours = skill.freshnessHours ?? 72;
    for (const source of requiredSourcesForSkill(skill)) {
      const current = requiredSourceFreshness[source];
      requiredSourceFreshness[source] = current === undefined
        ? freshnessHours
        : Math.min(current, freshnessHours);
    }
  }

  const allRequiredSources = Array.from(new Set(
    dispatchableSkills.flatMap((skill) => requiredSourcesForSkill(skill))
  ));
  const sourceStatus: Record<string, SourceStatus> = {};
  for (const source of allRequiredSources) {
    sourceStatus[source] = await checkSourceStatus(source, requiredSourceFreshness[source]);
  }

  const sourcesToRefresh = allRequiredSources.filter((source) => {
    const state = sourceStatus[source]?.state;
    return state === "missing" || state === "stale";
  });
  const sourceRefreshes = sourcesToRefresh.length > 0
    ? await refreshSourcesOnce(sourcesToRefresh)
    : {};

  for (const source of sourcesToRefresh) {
    sourceStatus[source] = await checkSourceStatus(source, requiredSourceFreshness[source]);
  }

  const skillsUnavailable: RunSkillsSummary["skillsUnavailable"] = [];
  const eligibleSkills = dispatchableSkills.filter((skill) => {
    if ((skill.platform === "meta" || skill.platform === "both") && !metaSnap) return false;

    const required = requiredSourcesForSkill(skill);
    const missing = required.filter((source) => {
      const state = sourceStatus[source]?.state;
      return state === "missing" || state === "error" || state === "disabled";
    });
    const stale = required.filter((source) => sourceStatus[source]?.state === "stale");
    if (missing.length > 0 || stale.length > 0) {
      skillsUnavailable.push({
        skillId: skill.id,
        missingRequiredSources: missing,
        staleRequiredSources: stale,
        reason: "required data unavailable after refresh attempt",
      });
      return false;
    }
    return true;
  });

  if (
    eligibleSkills.length === 0
    && skillsUnavailable.length === 0
    && (!metaSnap || dispatchableSkills.length > 0)
  ) {
    const summary = emptySummary({
      skillsTotal: allSkills.length,
      sourceStatus,
      sourceRefreshes,
      skillsUnavailable,
      skillHashes: { ...lastSkillHashes },
      skillLastRun: { ...lastSkillLastRun },
    });
    const errors = [metaSnap ? "No eligible skills available for current snapshots" : "No meta snapshot available for meta-linked skills"];
    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        completedAt: new Date(),
        status: "failed",
        summary,
        errorLog: errors[0],
      },
    });
    return { newRecs: 0, jobName: "run-skills", runId, status: "failed", summary, errors };
  }

  if (eligibleSkills.length > MAX_SKILLS_PER_RUN) {
    console.warn(`[run-skills] ${eligibleSkills.length - MAX_SKILLS_PER_RUN} skills deferred to next run (round-robin)`);
  }

  // H-7: sort oldest-first by last-run timestamp (persisted in JobRun summary as skillLastRun)
  // so starved skills get priority each cycle. A skill missing from the map (never run) sorts
  // as epoch 0, i.e. runs first.
  const applicableSkills = eligibleSkills
    .sort((a, b) => {
      const aTs = lastSkillLastRun[a.id];
      const bTs = lastSkillLastRun[b.id];
      const aLast = aTs ? new Date(aTs).getTime() : 0;
      const bLast = bTs ? new Date(bTs).getTime() : 0;
      return aLast - bLast;
    })
    .slice(0, MAX_SKILLS_PER_RUN);

  // Fix A: a single shared timestamp for every skill dispatched this run (executed or hash-skipped)
  const dispatchTimestamp = new Date().toISOString();

  const { runSkill } = await import("@/lib/skills/runner");
  const { buildExtraContext } = await import("@/lib/skills/extra-context");

  // Build the union of extraSources needed by any applicable skill once per run,
  // then hand each skill only the subset it declared.
  const extraSourcesUnion = Array.from(
    new Set(applicableSkills.flatMap((skill) => allContextSourcesForSkill(skill)))
  );
  const extraContext = extraSourcesUnion.length > 0 ? await buildExtraContext(extraSourcesUnion) : {};

  function extraContextForSkill(skill: SkillDefinition): Record<string, unknown> | undefined {
    const sources = allContextSourcesForSkill(skill);
    if (sources.length === 0) return undefined;
    const subset: Record<string, unknown> = {};
    for (const source of sources) {
      if (source in extraContext) subset[source] = extraContext[source];
    }
    return Object.keys(subset).length > 0 ? subset : undefined;
  }

  let totalRecs = 0;
  let skipped = 0;
  let unsupportedSkipped = 0;
  const errors: string[] = [];

  type SkillResult = {
    count: number;
    skillId: string;
    skillName: string;
    snapshotId: string;
    hash: string;
    insights: unknown[];
    wasSkipped?: boolean;
    unsupportedCount: number;
    unavailableReason?: string;
    primarySource?: SkillDataSource;
  };

  const limit = pLimit(4); // max 4 concurrent skill executions

  const results = await Promise.allSettled(
    applicableSkills.map((skill): Promise<SkillResult> => limit(async () => {
      const requiredSources = requiredSourcesForSkill(skill);
      const optionalSources = optionalSourcesForSkill(skill);
      const primarySource = skill.primarySource
        ?? (skill.platform === "seo" ? (requiredSources[0] ?? optionalSources[0]) : undefined);
      const snapshot = primarySource
        ? await selectBaseSnapshotForSource(primarySource)
        : metaSnap;
      if (!snapshot) {
        return {
          count: 0,
          skillId: skill.id,
          skillName: skill.name,
          snapshotId: "",
          hash: "",
          insights: [],
          wasSkipped: true,
          unsupportedCount: 0,
          unavailableReason: "missing_base_snapshot",
          primarySource,
        };
      }

      const skillExtraContext = extraContextForSkill(skill);
      const currentHash = hashSkillInputFingerprint(skill, snapshot.payload as Record<string, unknown>, skillExtraContext);
      if (currentHash && lastSkillHashes[skill.id] === currentHash) {
        // H-8: return currentHash (not "") so the stored hash stays valid across skipped runs
        return { count: 0, skillId: skill.id, skillName: skill.name, snapshotId: snapshot.id, hash: currentHash, insights: [], wasSkipped: true, unsupportedCount: 0 };
      }

      const { recs: recommendations, insights, truncated } = await Promise.race([
        runSkill(skill, snapshot as RawSnapshot, skillExtraContext),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('runSkill timeout after 120s')), 120_000))
      ]);
      if (truncated) {
        // Don't throw — a truncated response is a permanent data-size issue; retrying won't help.
        console.warn(`[run-skills] skill ${skill.id} response truncated by token limit — skipping`);
        return { count: 0, skillId: skill.id, skillName: skill.name, snapshotId: snapshot.id, hash: "", insights: [], wasSkipped: true, unsupportedCount: 0 };
      }
      let count = 0;
      let unsupportedCount = 0;
      const platform = snapshot.source;

      for (const rec of recommendations) {
        if (rec.actionType === "adjust_budget") {
          const numeric = parseFloat((rec.proposedValue ?? "").replace(/[^0-9.]/g, ""));
          if (!numeric || isNaN(numeric) || numeric <= 0) continue;
        }

        // Fix B: don't persist recs whose actionType is not executable on this platform
        // (e.g. change_bid/add_negative_keyword on meta). Skill narrative/insight output is unaffected.
        if (!isSupportedAction(platform, rec.actionType)) {
          unsupportedCount++;
          continue;
        }

        const guard = await checkGuardrails(rec);

        const existing = await prisma.recommendation.findFirst({
          where: { platform, actionType: rec.actionType, targetEntityId: rec.targetEntityId, status: "pending" },
        });
        if (existing) continue;

        try {
          await prisma.recommendation.create({
            data: {
              platform,
              skillId: skill.id,
              skillName: skill.name,
              actionType: rec.actionType,
              targetEntityType: rec.targetEntityType,
              targetEntityId: rec.targetEntityId,
              targetEntityName: rec.targetEntityName,
              currentValue: rec.currentValue,
              proposedValue: rec.proposedValue,
              changePercent: rec.changePercent,
              rationale: rec.rationale,
              estimatedImpact: rec.estimatedImpact,
              confidenceScore: rec.confidenceScore,
              guardStatus: guard.status,
              guardReason: guard.status !== "clear" ? guard.reason : null,
              snapshotId: snapshot.id,
            },
          });
          count++;
        } catch (err: unknown) {
          if (
            err != null &&
            typeof err === "object" &&
            "code" in err &&
            (err as { code: string }).code === "P2002"
          ) {
            // duplicate pending recommendation for this entity — safe to skip
          } else {
            throw err;
          }
        }
      }

      if (unsupportedCount > 0) {
        console.warn(`[run-skills] skill ${skill.id}: skipped ${unsupportedCount} unsupported recommendation(s) (actionType not executable on platform "${platform}")`);
      }

      return { count, skillId: skill.id, skillName: skill.name, snapshotId: snapshot.id, hash: currentHash, insights, unsupportedCount };
    }))
  );

  // Collect hash/lastRun updates and insights after all concurrent work completes — avoids mid-flight mutation
  const hashUpdates: Array<{ skillId: string; hash: string }> = [];
  const hashRemovals = new Set<string>();
  const lastRunUpdates: string[] = [];
  const insightRows: Array<{ skillId: string; skillName: string; insightType: string; items: unknown[]; snapshotId: string }> = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") {
      const { count, skillId, skillName, snapshotId, hash, insights, wasSkipped, unsupportedCount, unavailableReason, primarySource } = r.value;
      unsupportedSkipped += unsupportedCount;
      // Only successful executions or hash-skips with a current fingerprint count
      // as "ran" for rotation. Truncated/no-hash attempts should retry sooner.
      if (hash) lastRunUpdates.push(skillId);
      if (wasSkipped) {
        skipped++;
        if (unavailableReason) {
          skillsUnavailable.push({
            skillId,
            missingRequiredSources: primarySource ? [primarySource] : [],
            staleRequiredSources: [],
            reason: unavailableReason,
          });
        }
        // H-8: preserve the current hash for skipped skills so next run still sees it
        if (hash) hashUpdates.push({ skillId, hash });
        else hashRemovals.add(skillId);
      } else {
        totalRecs += count;
        if (hash) hashUpdates.push({ skillId, hash });
        else hashRemovals.add(skillId);
        const insightType = applicableSkills[i]?.insightBlock;
        if (insightType && insights.length > 0) {
          insightRows.push({ skillId, skillName, insightType, items: insights, snapshotId });
        }
      }
    } else {
      const failedSkillId = applicableSkills[i]?.id;
      if (failedSkillId) hashRemovals.add(failedSkillId);
      errors.push(`${applicableSkills[i]?.id ?? `skill-${i}`}: ${String(r.reason)}`);
    }
  }

  if (insightRows.length > 0) {
    await prisma.skillInsight.createMany({
      data: insightRows.map((row) => ({
        skillId: row.skillId,
        skillName: row.skillName,
        insightType: row.insightType,
        items: row.items as import("@prisma/client").Prisma.InputJsonValue,
        snapshotId: row.snapshotId,
        jobRunId: runId,
      })),
    });
  }

  let fatigueActions = { pauseRecs: 0, refreshTasks: 0 };
  if (insightRows.length > 0) {
    const { createFatigueActions } = await import("@/lib/skills/insight-actions");
    try {
      fatigueActions = await createFatigueActions({ runId, rows: insightRows });
      totalRecs += fatigueActions.pauseRecs; // counts toward the Phase 1 new_recommendations alert
    } catch (err) {
      errors.push(`insight-actions: ${String(err)}`);
    }
  }

  // Preserve hashes for deferred skills, but remove stale hashes for dispatched
  // skills that failed or were skipped without a current hash (e.g. truncation).
  const updatedSkillHashes: Record<string, string> = { ...lastSkillHashes };
  for (const skillId of hashRemovals) {
    delete updatedSkillHashes[skillId];
  }
  for (const { skillId, hash } of hashUpdates) {
    updatedSkillHashes[skillId] = hash;
  }

  // Fix A: merge fresh timestamps for skills dispatched this run over the previous run's map,
  // so skills not dispatched this run keep their prior timestamp (round-robin bookkeeping).
  const updatedSkillLastRun: Record<string, string> = { ...lastSkillLastRun };
  for (const skillId of lastRunUpdates) {
    updatedSkillLastRun[skillId] = dispatchTimestamp;
  }

  const status: JobStatus = errors.length === 0 ? "success" : "partial";
  const summary: RunSkillsSummary = {
    recommendationsGenerated: totalRecs,
    skillsRun: applicableSkills.length - skipped,
    skillsSkipped: skipped,
    skillsTotal: allSkills.length,
    skillHashes: updatedSkillHashes,
    skillLastRun: updatedSkillLastRun,
    unsupportedSkipped,
    fatigueActions,
    sourceStatus,
    sourceRefreshes,
    skillsUnavailable,
  };

  await prisma.jobRun.update({
    where: { id: runId },
    data: {
      completedAt: new Date(),
      status,
      summary,
      errorLog: errors.length > 0 ? errors.join("\n").slice(0, 10_000) : null,
    },
  });

  if (totalRecs > 0) {
    await sendOperatorAlert("new_recommendations", {
      count: totalRecs,
      runId,
      skillsRun: summary.skillsRun,
    });
  }

  return { newRecs: totalRecs, jobName: "run-skills", runId, status, summary, errors };
}
