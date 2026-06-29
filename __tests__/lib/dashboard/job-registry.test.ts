import { describe, expect, it } from "vitest";
import {
  DASHBOARD_JOB_NAMES,
  DASHBOARD_JOB_REGISTRY,
  QUEUED_DASHBOARD_JOB_NAMES,
  TRIGGERABLE_DASHBOARD_JOBS,
  getDashboardJob,
} from "@/lib/dashboard/job-registry";

describe("dashboard job registry", () => {
  it("defines labels and unique names for all dashboard jobs", () => {
    expect(DASHBOARD_JOB_REGISTRY.length).toBeGreaterThan(0);
    expect(new Set(DASHBOARD_JOB_NAMES).size).toBe(DASHBOARD_JOB_NAMES.length);

    for (const job of DASHBOARD_JOB_REGISTRY) {
      expect(job.name).toMatch(/^[a-z0-9-]+$/);
      expect(job.label.length).toBeGreaterThan(0);
    }
  });

  it("requires triggerable jobs to have executable strategies", () => {
    for (const job of TRIGGERABLE_DASHBOARD_JOBS) {
      expect(job.triggerStrategy).not.toBe("disabled");
      if (job.triggerStrategy === "cron") {
        expect(job.cronPath).toMatch(/^\/api\/cron\//);
      }
    }
  });

  it("requires non-triggerable jobs to explain why manual runs are disabled", () => {
    const disabled = DASHBOARD_JOB_REGISTRY.filter((job) => !job.manualTriggerEnabled);

    expect(disabled.length).toBeGreaterThan(0);
    for (const job of disabled) {
      expect(job.manualTriggerDisabledReason).toBeTruthy();
      expect(job.triggerStrategy).toBe("disabled");
    }
  });

  it("keeps queued registry entries in the queued name export", () => {
    const queued = DASHBOARD_JOB_REGISTRY
      .filter((job) => job.triggerStrategy === "queued")
      .map((job) => job.name);

    expect(QUEUED_DASHBOARD_JOB_NAMES).toEqual(queued);
    expect(getDashboardJob("fetch-market-intel")?.label).toBe("Fetch Market Intelligence");
  });
});
