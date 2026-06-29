import { describe, it, expect, beforeEach } from "vitest";
import { resolveRunLimits, VALID_PROFILES } from "@/lib/market-intel/profiles";

beforeEach(() => {
  delete process.env.MARKET_INTEL_KEYWORD_LIMIT;
  delete process.env.MARKET_INTEL_RESULTS_PER_KEYWORD;
  delete process.env.MARKET_INTEL_COMPETITOR_PAGE_LIMIT;
  delete process.env.MARKET_INTEL_ADS_PER_PAGE_LIMIT;
  delete process.env.MARKET_INTEL_LONG_RUNNING_AD_DAYS;
});

describe("resolveRunLimits", () => {
  describe("smoke profile", () => {
    it("uses smoke caps", () => {
      const limits = resolveRunLimits({ profile: "smoke" });
      expect(limits.keywordLimit).toBe(1);
      expect(limits.shoppingResultLimit).toBe(5);
      expect(limits.competitorPageLimit).toBe(1);
      expect(limits.adLimitPerPage).toBe(10);
      expect(limits.sources).toContain("shopping");
      expect(limits.sources).toContain("meta");
    });

    it("clamps overrides to smoke cap", () => {
      const limits = resolveRunLimits({ profile: "smoke", keywordLimit: 999, adLimitPerPage: 999 });
      expect(limits.keywordLimit).toBe(1);
      expect(limits.adLimitPerPage).toBe(10);
    });
  });

  describe("shopping profile", () => {
    it("excludes meta source", () => {
      const limits = resolveRunLimits({ profile: "shopping" });
      expect(limits.sources).toContain("shopping");
      expect(limits.sources).not.toContain("meta");
    });

    it("sets competitorPageLimit to 0", () => {
      const limits = resolveRunLimits({ profile: "shopping" });
      expect(limits.competitorPageLimit).toBe(0);
    });
  });

  describe("meta-pages profile", () => {
    it("excludes shopping source", () => {
      const limits = resolveRunLimits({ profile: "meta-pages" });
      expect(limits.sources).toContain("meta");
      expect(limits.sources).not.toContain("shopping");
    });

    it("sets keywordLimit to 0", () => {
      const limits = resolveRunLimits({ profile: "meta-pages" });
      expect(limits.keywordLimit).toBe(0);
    });
  });

  describe("scheduled profile", () => {
    it("reads from env vars", () => {
      process.env.MARKET_INTEL_KEYWORD_LIMIT = "7";
      process.env.MARKET_INTEL_RESULTS_PER_KEYWORD = "15";
      process.env.MARKET_INTEL_COMPETITOR_PAGE_LIMIT = "3";
      process.env.MARKET_INTEL_ADS_PER_PAGE_LIMIT = "25";
      const limits = resolveRunLimits({ profile: "scheduled" });
      expect(limits.keywordLimit).toBe(7);
      expect(limits.shoppingResultLimit).toBe(15);
      expect(limits.competitorPageLimit).toBe(3);
      expect(limits.adLimitPerPage).toBe(25);
    });

    it("falls back to defaults when env vars are unset", () => {
      const limits = resolveRunLimits({ profile: "scheduled" });
      expect(limits.keywordLimit).toBe(5);
      expect(limits.shoppingResultLimit).toBe(20);
      expect(limits.competitorPageLimit).toBe(10);
      expect(limits.adLimitPerPage).toBe(50);
    });

    it("includes both sources", () => {
      const limits = resolveRunLimits({ profile: "scheduled" });
      expect(limits.sources).toContain("shopping");
      expect(limits.sources).toContain("meta");
    });
  });

  describe("VALID_PROFILES", () => {
    it("does not include scheduled as a valid manual profile", () => {
      // scheduled is in the list but manual trigger blocks it explicitly
      expect(VALID_PROFILES).toContain("smoke");
      expect(VALID_PROFILES).toContain("shopping");
      expect(VALID_PROFILES).toContain("meta-pages");
      expect(VALID_PROFILES).toContain("meta-keywords");
    });
  });
});
