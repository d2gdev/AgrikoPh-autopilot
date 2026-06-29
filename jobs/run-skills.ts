import { createHash } from "crypto";
import pLimit from "p-limit";
import { prisma } from "@/lib/db";
import { checkGuardrails } from "@/lib/guardrails";
import { loadAllSkillsSync } from "@/lib/skills/loader";
import type { SkillDefinition } from "@/lib/skills/loader";
import type { RawSnapshot } from "@prisma/client";
import type { JobResult, JobStatus } from "@/lib/jobs/types";

const MAX_SKILLS_PER_RUN = 30;

type RunSkillsSummary = {
  recommendationsGenerated: number;
  skillsRun: number;
  skillsSkipped: number;
  skillsTotal: number;
  skillHashes: Record<string, string>;
};

type RunSkillsResult = JobResult<RunSkillsSummary> & { newRecs: number };

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function runSkillsHandler(): Promise<RunSkillsResult> {
  const runId = (
    await prisma.jobRun.create({ data: { jobName: "run-skills" } })
  ).id;

  const [metaSnap, googleSnap] = await Promise.all([
    prisma.rawSnapshot.findFirst({ where: { source: "meta" }, orderBy: { fetchedAt: "desc" } }),
    prisma.rawSnapshot.findFirst({ where: { source: "google_ads" }, orderBy: { fetchedAt: "desc" } }),
  ]);

  if (!metaSnap && !googleSnap) {
    const summary: RunSkillsSummary = {
      recommendationsGenerated: 0,
      skillsRun: 0,
      skillsSkipped: 0,
      skillsTotal: 0,
      skillHashes: {},
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
  if (googleSnap) currentHashes.google_ads = hashPayload(googleSnap.payload);

  // Load per-skill hashes stored from the last successful run
  const lastRun = await prisma.jobRun.findFirst({
    where: { jobName: "run-skills", status: { in: ["success", "partial"] }, id: { not: runId } },
    orderBy: { completedAt: "desc" },
  });
  const lastSkillHashes = (
    (lastRun?.summary as Record<string, unknown> | null)?.skillHashes ?? {}
  ) as Record<string, string>;

  const allSkills = loadAllSkillsSync().filter((s) => s.enabled);

  // H-9: filter to dispatchable platforms BEFORE cap so linkedin/reddit don't starve real skills
  const DISPATCHABLE_PLATFORMS: SkillDefinition["platform"][] = ["meta", "google_ads", "both"];
  const eligibleSkills = allSkills.filter((s) => {
    if (!DISPATCHABLE_PLATFORMS.includes(s.platform)) return false;
    if (s.platform === "meta") return !!metaSnap;
    if (s.platform === "google_ads") return !!googleSnap;
    if (s.platform === "both") return !!(metaSnap ?? googleSnap);
    return false;
  });

  if (eligibleSkills.length > MAX_SKILLS_PER_RUN) {
    console.warn(`[run-skills] ${eligibleSkills.length - MAX_SKILLS_PER_RUN} skills deferred to next run (round-robin)`);
  }

  // H-7: sort oldest-first by lastRunAt so starved skills get priority each cycle
  // SkillDefinition does not carry lastRunAt (loaded from files); absent field sorts to 0 (always first)
  const applicableSkills = eligibleSkills
    .sort((a, b) => {
      const aLast = ((a as unknown as Record<string, unknown>).lastRunAt as Date | undefined)?.getTime() ?? 0;
      const bLast = ((b as unknown as Record<string, unknown>).lastRunAt as Date | undefined)?.getTime() ?? 0;
      return aLast - bLast;
    })
    .slice(0, MAX_SKILLS_PER_RUN);

  function snapshotForSkill(skill: SkillDefinition): RawSnapshot | null {
    if (skill.platform === "meta") return metaSnap;
    if (skill.platform === "google_ads") return googleSnap;
    return metaSnap ?? googleSnap;
  }

  function hashForSkill(skill: SkillDefinition): string {
    const snap = snapshotForSkill(skill);
    if (!snap) return "";
    return currentHashes[snap.source] ?? currentHashes.meta ?? currentHashes.google_ads ?? "";
  }

  const { runSkill } = await import("@/lib/skills/runner");

  let totalRecs = 0;
  let skipped = 0;
  const errors: string[] = [];

  type SkillResult = { count: number; skillId: string; skillName: string; snapshotId: string; hash: string; insights: unknown[]; wasSkipped?: boolean };

  const limit = pLimit(4); // max 4 concurrent skill executions

  const results = await Promise.allSettled(
    applicableSkills.map((skill): Promise<SkillResult> => limit(async () => {
      const snapshot = snapshotForSkill(skill);
      if (!snapshot) return { count: 0, skillId: skill.id, skillName: skill.name, snapshotId: "", hash: "", insights: [] };

      const currentHash = hashForSkill(skill);
      if (currentHash && lastSkillHashes[skill.id] === currentHash) {
        // H-8: return currentHash (not "") so the stored hash stays valid across skipped runs
        return { count: 0, skillId: skill.id, skillName: skill.name, snapshotId: snapshot.id, hash: currentHash, insights: [], wasSkipped: true };
      }

      const { recs: recommendations, insights, truncated } = await Promise.race([
        runSkill(skill, snapshot),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('runSkill timeout after 120s')), 120_000))
      ]);
      if (truncated) {
        // Don't throw — a truncated response is a permanent data-size issue; retrying won't help.
        console.warn(`[run-skills] skill ${skill.id} response truncated by token limit — skipping`);
        return { count: 0, skillId: skill.id, skillName: skill.name, snapshotId: snapshot.id, hash: "", insights: [], wasSkipped: true };
      }
      let count = 0;
      const platform = snapshot.source === "meta" ? "meta" : "google_ads";

      for (const rec of recommendations) {
        if (rec.actionType === "adjust_budget") {
          const numeric = parseFloat((rec.proposedValue ?? "").replace(/[^0-9.]/g, ""));
          if (!numeric || isNaN(numeric) || numeric <= 0) continue;
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

      return { count, skillId: skill.id, skillName: skill.name, snapshotId: snapshot.id, hash: currentHash, insights };
    }))
  );

  // Collect hash updates and insights after all concurrent work completes — avoids mid-flight mutation
  const hashUpdates: Array<{ skillId: string; hash: string }> = [];
  const insightRows: Array<{ skillId: string; skillName: string; insightType: string; items: unknown[]; snapshotId: string }> = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") {
      const { count, skillId, skillName, snapshotId, hash, insights, wasSkipped } = r.value;
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

  const status: JobStatus = errors.length === 0 ? "success" : "partial";
  const summary: RunSkillsSummary = {
    recommendationsGenerated: totalRecs,
    skillsRun: applicableSkills.length - skipped,
    skillsSkipped: skipped,
    skillsTotal: allSkills.length,
    skillHashes: updatedSkillHashes,
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
