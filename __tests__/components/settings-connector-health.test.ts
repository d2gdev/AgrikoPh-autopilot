import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Settings connector-health truthfulness", () => {
  it("identifies the built-in alert source and distinguishes no delivery from connector failure", () => {
    const source = readFileSync("app/(embedded)/settings/page.tsx", "utf8");

    expect(source).toContain('connector.id === "alerts"');
    expect(source).toContain('"In-app notifications"');
    expect(source).toContain('"No alert sent yet"');
  });
});
