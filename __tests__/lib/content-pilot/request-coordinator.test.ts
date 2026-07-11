import { describe, expect, it } from "vitest";
import { createLatestRequestCoordinator } from "@/lib/content-pilot/request-coordinator";

describe("Content Pilot request coordination", () => {
  it("skips background polling while a load is active", () => {
    const coordinator = createLatestRequestCoordinator();
    const visible = coordinator.start({ background: false });

    expect(visible).not.toBeNull();
    expect(coordinator.start({ background: true })).toBeNull();
  });

  it("lets a newer foreground refresh abort and supersede an older load", () => {
    const coordinator = createLatestRequestCoordinator();
    const older = coordinator.start({ background: false })!;
    const newer = coordinator.start({ background: false })!;

    expect(older.signal.aborted).toBe(true);
    expect(coordinator.isCurrent(older)).toBe(false);
    expect(coordinator.isCurrent(newer)).toBe(true);
    coordinator.finish(older);
    expect(coordinator.isCurrent(newer)).toBe(true);
  });
});
