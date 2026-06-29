import { describe, it, expect } from "vitest";
import { isSpamStoryAd, scoreSpamStoryAd } from "../spam-filter";

// Excerpt of the real "TaleTerrace2" serialized-story ad that polluted the scrape.
const TALETERRACE_AD = {
  pageName: "TaleTerrace2",
  headline: "",
  description: "",
  adCopy:
    "Sa araw ng kasal, nawala ang aking fiancée. Pagkatapos, nakatanggap ako ng isang video——" +
    "Sa video, siya ay hubo't hubad na nakahiga sa kama kasama ang isa pang lalaki. " +
    "Kaya, gumawa ako ng isang baliw at padalos-dalos na desisyon: Sa mismong lugar ng aking kasal, " +
    "pipili ako agad ng isang asawa. Sa huli, ang taong itinulak sa harapan ko upang tapusin ang kasal " +
    "na ito ay ang aking sekretarya. “Okay,” bulong niya. “Where is the bride?” tanong " +
    "ng wedding coordinator. Si Kyle Alvarado, ang CEO ng Megawide Corporation, ay nakakunot ang noo. " +
    "Ikakasal na ang boss niya. Pero pagdating kay Sofie, nagiging soft ang cold-hearted na CEO.",
};

const LEGIT_AGRIKO_AD = {
  pageName: "Agriko Organic Farm",
  headline: "Organic Black Rice — Farm to Table",
  description: "Pesticide-free, grown in Mindanao.",
  adCopy: "Shop our organic black rice today. Free shipping nationwide. Order now!",
};

const LEGIT_LONG_PRODUCT_AD = {
  pageName: "Healthy Options",
  headline: "Turmeric Powder Sale",
  description: "Premium organic turmeric.",
  adCopy:
    "Our turmeric powder is sourced from trusted organic farms. Rich in curcumin, " +
    "it supports your wellness routine. Add it to smoothies, golden milk, or curries. " +
    "Available in 100g and 250g packs. Shop now and get 10% off your first order.",
};

const DROPSHIP_SCAM_AD = {
  pageName: "Luna Finds Store",
  headline: "Buy 1 Get 1 Free",
  description: "",
  adCopy:
    "Stop wasting money on creams that just sit on the surface of your skin! " +
    "Introducing Relief Massage Gel with turmeric and Australian emu oil. " +
    "Helps relieve joint pain quickly. WWW.METROPH.CLICK Buy 1 Get 1 Free - Offer is about to end. " +
    "Hurry up! Only 10 products left! Order now.",
};

const FOLKLORE_SPAM_AD = {
  pageName: "Beatrice Mcdonald",
  headline: "",
  description: "",
  adCopy: Array(8).fill(
    "Long before concrete towns, dense emerald rainforests wrapped the volcanic mountain. " +
    "Maria was the youngest daughter of two powerful ancient spirits who ruled over nature. " +
    "Whenever hungry villagers ventured into the woods, she would leave bundles of fruit for them. ",
  ).join(""),
};

describe("spam story-ad filter", () => {
  it("flags Spanish/folklore long-narrative spam via length+sentences", () => {
    expect(isSpamStoryAd(FOLKLORE_SPAM_AD)).toBe(true);
  });

  it("flags cloaked-link dropship scams", () => {
    const r = scoreSpamStoryAd(DROPSHIP_SCAM_AD);
    expect(r.isSpam).toBe(true);
    expect(r.reasons).toContain("cloaked-link-domain");
  });

  it("flags the TaleTerrace serialized-story ad", () => {
    const result = scoreSpamStoryAd(TALETERRACE_AD);
    expect(result.isSpam).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  it("does not flag a short legit product ad", () => {
    expect(isSpamStoryAd(LEGIT_AGRIKO_AD)).toBe(false);
  });

  it("does not flag a longer-but-legit product ad", () => {
    expect(isSpamStoryAd(LEGIT_LONG_PRODUCT_AD)).toBe(false);
  });

  it("handles empty / null fields without throwing", () => {
    expect(isSpamStoryAd({})).toBe(false);
    expect(isSpamStoryAd({ adCopy: null, headline: null })).toBe(false);
  });
});
