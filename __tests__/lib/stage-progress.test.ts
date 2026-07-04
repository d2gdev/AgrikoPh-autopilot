import { describe, it, expect } from "vitest";
import { STATUS, STAGE } from "@/lib/ad-approval/constants";
import { stageProgress } from "@/lib/ad-approval/stage-progress";

const KEYS = ["ai_pre_review", "brand", "conversion", "technical", "penultimate", "final", "approved"];

describe("stageProgress", () => {
  it("covers every STATUS value without throwing and always returns 7 ordered steps", () => {
    for (const status of Object.values(STATUS)) {
      for (const stage of Object.values(STAGE)) {
        const { steps } = stageProgress(status, stage);
        expect(steps.map((s) => s.key)).toEqual(KEYS);
        for (const s of steps) expect(["done", "current", "blocked", "pending"]).toContain(s.state);
      }
    }
  });

  it("maps the happy path", () => {
    expect(stageProgress(STATUS.DRAFT, STAGE.PRE_REVIEW).steps.every((s) => s.state === "pending")).toBe(true);
    const inBrand = stageProgress(STATUS.IN_BRAND_REVIEW, STAGE.BRAND).steps;
    expect(inBrand[0]!.state).toBe("done");
    expect(inBrand[1]!.state).toBe("current");
    expect(inBrand[2]!.state).toBe("pending");
    const final = stageProgress(STATUS.WITH_FINAL_APPROVER, STAGE.FINAL).steps;
    expect(final[5]!.state).toBe("current");
    expect(final[6]!.state).toBe("pending");
    expect(stageProgress(STATUS.APPROVED, STAGE.FINAL).steps.every((s) => s.state === "done")).toBe(true);
  });

  it("locates blocked states via the stage argument", () => {
    const bounced = stageProgress(STATUS.NEEDS_REVISION, STAGE.CONVERSION).steps;
    expect(bounced[0]!.state).toBe("done");
    expect(bounced[1]!.state).toBe("done");
    expect(bounced[2]!.state).toBe("blocked");
    expect(bounced[3]!.state).toBe("pending");
    expect(stageProgress(STATUS.REJECTED, STAGE.FINAL).steps[5]!.state).toBe("blocked");
    expect(stageProgress(STATUS.CANCELLED, STAGE.PRE_REVIEW).steps[0]!.state).toBe("blocked");
  });

  it("degrades to all-pending on unknown input", () => {
    expect(stageProgress("mystery_status", "MYSTERY").steps.every((s) => s.state === "pending")).toBe(true);
  });
});
