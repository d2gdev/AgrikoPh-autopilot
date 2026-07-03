import { createHash } from "crypto";
import pLimit from "p-limit";
import { prisma } from "@/lib/db";
import { checkGuardrails } from "@/lib/guardrails";
import { isSupportedAction } from "@/lib/executor";
import { loadAllSkillsSync } from "@/lib/skills/loader";
import type { SkillDefinition } from "@/lib/skills/loader";
import type { JobResult, JobStatus } from "@/lib/jobs/types";

const MAX_SKILLS_PER_RUN = 30;

type RunSkillsSummary = {
  recommendationsGenerated: number;
  skillsRun: number;
  skillsSkipped: number;
  skillsTotal: number;
  skillHashes: Record<string, string>;
  skillLastRun: Record<string, string>;
  unsupportedSkipped: number;
};

type RunSkillsResult = JobResult<RunSkillsSummary> & { newRecs: number };

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function runSkillsHandler(): Promise<RunSkillsResult> {
  const runId = (
    await prisma.jobRun.create({ data: { jobName: "run-skills" } })
  ).id;

  const metaSnap = await prisma.rawSnapshot.findFirst({ where: { source: "meta" }, orderBy: { fetchedAt: "desc" } });

  if (!metaSnap) {
    const summary: RunSkillsSummary = {
      recommendationsGenerated: 0,
      skillsRun: 0,
      skillsSkipped: 0,
      skillsTotal: 0,
      skillHashes: {},
      skillLastRun: {},
      unsupportedSkipped: 0,
    };
    const errors = ["No snapshots available — run data fetch first"];
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

  // Hash each platform's current payload
  const currentHashes: Record<string, string> = {};
  if (metaSnap) currentHashes.meta = hashPayload(metaSnap.payload);

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
  const DISPATCHABLE_PLATFORMS: SkillDefinition["platform"][] = ["meta", "both"];
  const eligibleSkills = allSkills.filter((s) => {
    if (!DISPATCHABLE_PLATFORMS.includes(s.platform)) return false;
    if (s.platform === "meta") return !!metaSnap;
    if (s.platform === "both") return !!metaSnap;
    return false;
  });

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

  function hashForSkill(): string {
    if (!metaSnap) return "";
    return currentHashes[metaSnap.source] ?? currentHashes.meta ?? "";
  }

  const { runSkill } = await import("@/lib/skills/runner");
  const { buildExtraContext } = await import("@/lib/skills/extra-context");

  // Build the union of extraSources needed by any applicable skill once per run,
  // then hand each skill only the subset it declared.
  const extraSourcesUnion = Array.from(
    new Set(applicableSkills.flatMap((s) => s.extraSources ?? []))
  );
  const extraContext = extraSourcesUnion.length > 0 ? await buildExtraContext(extraSourcesUnion) : {};

  function extraContextForSkill(skill: SkillDefinition): Record<string, unknown> | undefined {
    if (!skill.extraSources || skill.extraSources.length === 0) return undefined;
    const subset: Record<string, unknown> = {};
    for (const source of skill.extraSources) {
      if (source in extraContext) subset[source] = extraContext[source];
    }
    return subset;
  }

  let totalRecs = 0;
  let skipped = 0;
  let unsupportedSkipped = 0;
  const errors: string[] = [];

  type SkillResult = { count: number; skillId: string; skillName: string; snapshotId: string; hash: string; insights: unknown[]; wasSkipped?: boolean; unsupportedCount: number };

  const limit = pLimit(4); // max 4 concurrent skill executions

  const results = await Promise.allSettled(
    applicableSkills.map((skill): Promise<SkillResult> => limit(async () => {
      const snapshot = metaSnap;
      if (!snapshot) return { count: 0, skillId: skill.id, skillName: skill.name, snapshotId: "", hash: "", insights: [], unsupportedCount: 0 };

      const currentHash = hashForSkill();
      if (currentHash && lastSkillHashes[skill.id] === currentHash) {
        // H-8: return currentHash (not "") so the stored hash stays valid across skipped runs
        return { count: 0, skillId: skill.id, skillName: skill.name, snapshotId: snapshot.id, hash: currentHash, insights: [], wasSkipped: true, unsupportedCount: 0 };
      }

      const { recs: recommendations, insights, truncated } = await Promise.race([
        runSkill(skill, snapshot, extraContextForSkill(skill)),
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
  const lastRunUpdates: string[] = [];
  const insightRows: Array<{ skillId: string; skillName: string; insightType: string; items: unknown[]; snapshotId: string }> = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") {
      const { count, skillId, skillName, snapshotId, hash, insights, wasSkipped, unsupportedCount } = r.value;
      unsupportedSkipped += unsupportedCount;
      // Fix A: any dispatched skill that completed (executed or hash-skipped) counts as "ran"
      lastRunUpdates.push(skillId);
      if (wasSkipped) {
        skipped++;
        // H-8: preserve the current hash for skipped skills so next run still sees it
        if (hash) hashUpdates.push({ skillId, hash });
      } else {
        totalRecs += count;
        if (hash) hashUpdates.push({ skillId, hash });
        const insightType = applicableSkills[i]?.insightBlock;
        if (insightType && insights.length > 0) {
          insightRows.push({ skillId, skillName, insightType, items: insights, snapshotId });
        }
      }
    } else {
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

  // Only preserve hashes for skills that completed (fulfilled). Failed skills get no hash
  // entry, so they re-run next cycle instead of being permanently frozen by a stale hash.
  const updatedSkillHashes: Record<string, string> = {};
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

  return { newRecs: totalRecs, jobName: "run-skills", runId, status, summary, errors };
}
