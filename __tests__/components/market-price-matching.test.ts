import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findMatches, insightGroupDescriptor, type MarketInsight } from "@/app/(embedded)/(market-intelligence)/market-intelligence/components";

const product = (title: string) => ({ id: "ours", title, handle: "ours", price: 540, currency: "PHP" });
const result = (id: string, title: string) => ({ id, title, price: 200, currency: "PHP" });

describe("Market Intelligence product matching", () => {
  it("does not compare black or brown rice against red rice", () => {
    const rows = [result("red", "Organic Red Rice 3kg"), result("black", "Organic Black Rice 3kg")];

    expect(findMatches(product("Philippine Organic Black Rice | 3 kg"), rows).map((row) => row.id)).toEqual(["black"]);
  });

  it("does not compare a tea blend with a bag of grain", () => {
    expect(findMatches(
      product("Roasted Black Rice Tea Blend (5-in-1)"),
      [result("grain", "Organic Black Rice 3kg")],
    )).toEqual([]);

    expect(findMatches(
      product("Philippine Organic Black Rice | 3 kg"),
      [result("tea", "Organic Black Rice Tea 3kg")],
    )).toEqual([]);
  });

  it("requires comparable package quantities when both are sold by weight", () => {
    const rows = [result("two", "Organic Black Rice 2kg"), result("three", "Organic Black Rice 3kg")];

    expect(findMatches(product("Philippine Organic Black Rice | 3 kg"), rows).map((row) => row.id)).toEqual(["three"]);
  });

  it("does not compare raw package prices when neither title proves the quantity", () => {
    expect(findMatches(
      product("Pure Philippine Organic Honey"),
      [result("honey", "Nate's Organic Raw Honey")],
    )).toEqual([]);
  });
});

describe("Market Intelligence resolved-item cache", () => {
  it("removes a resolved insight from the client cache as well as visible state", () => {
    const source = readFileSync("app/(embedded)/(market-intelligence)/market-intelligence/page.tsx", "utf8");

    expect(source).toContain("setCache(MARKET_INTELLIGENCE_CACHE_KEY, next)");
  });
});

describe("Market Intelligence repeated-signal presentation", () => {
  const insight = (id: string, summary: string): MarketInsight => ({
    id,
    createdAt: "2026-07-15T00:00:00.000Z",
    type: "new_competitor_ad",
    severity: "info",
    title: "Doc Roger's Herbal Tea launched or exposed a new ad",
    summary,
    status: "open",
    competitor: { name: "Doc Roger's Herbal Tea" },
  });

  it("groups distinct ads that present the same visible message, but not different messages", () => {
    const first = insightGroupDescriptor(insight("one", "Supports immune health"));
    const duplicate = insightGroupDescriptor(insight("two", "Supports immune health"));
    const different = insightGroupDescriptor(insight("three", "Buy 1 Take 1"));

    expect(first?.key).toBe(duplicate?.key);
    expect(first?.key).not.toBe(different?.key);
    expect(first?.typeLabel).toBe("new ads with this message");
  });
});
