import { describe, expect, it } from "vitest";
import { isMeaningfulPriceChange } from "@/lib/market-intel/price-signal";

describe("isMeaningfulPriceChange", () => {
  it("suppresses normal marketplace rounding noise", () => {
    expect(isMeaningfulPriceChange(379.54, 380.15)).toBe(false);
    expect(isMeaningfulPriceChange(33_100, 33_200)).toBe(false);
  });

  it("keeps material competitor price moves", () => {
    expect(isMeaningfulPriceChange(251, 230)).toBe(true);
    expect(isMeaningfulPriceChange(219.87, 499)).toBe(true);
  });
});
