import { describe, expect, it } from "vitest";
import {
  topicalMapInternalLinkRequiresReplacement,
  topicalMapRedirectRequiresDelete,
  topicalMapRedirectRequiresLegacyLinkCleanup,
  topicalMapRedirectRequiresUpdate,
} from "@/lib/topical-map/action-eligibility";

describe("topical-map exact mutation instructions", () => {
  it("recognizes only the exact one-hop redirect instruction", () => {
    expect(topicalMapRedirectRequiresUpdate("replace with one-hop target")).toBe(true);
    expect(topicalMapRedirectRequiresUpdate("review redirect target")).toBe(false);
  });

  it("recognizes only an unconditional live-owner redirect deletion", () => {
    expect(topicalMapRedirectRequiresDelete("retain live page as owner; remove redirect record")).toBe(true);
    expect(topicalMapRedirectRequiresDelete("retain live page as provisional hub; remove redirect record unless a dossier selects tag archive")).toBe(false);
  });

  it("recognizes the scoped legacy-link cleanup and exact replacement wording", () => {
    expect(topicalMapRedirectRequiresLegacyLinkCleanup("retain unless source is still internally linked")).toBe(true);
    expect(topicalMapInternalLinkRequiresReplacement("replace legacy target with this current comparison URL")).toBe(true);
    expect(topicalMapInternalLinkRequiresReplacement("remove only if consolidation is executed")).toBe(false);
  });
});
