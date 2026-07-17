import { describe, expect, it } from "vitest";
import { replaceExactInternalLinkTargets } from "@/lib/store-tasks/replace-internal-links";

describe("replaceExactInternalLinkTargets", () => {
  it("replaces an exact internal href while preserving anchor text and other attributes", () => {
    const input = '<p><a class="cta" href="/products/black-rice" data-track="rice">Black rice</a></p>';

    expect(replaceExactInternalLinkTargets(input, [{
      fromUrl: "/products/black-rice",
      toUrl: "/products/philippines-organic-black-rice",
    }])).toEqual({
      bodyHtml: '<p><a class="cta" href="/products/philippines-organic-black-rice" data-track="rice">Black rice</a></p>',
      changed: 1,
    });
  });

  it("normalizes same-host absolute hrefs and replaces every exact occurrence", () => {
    const input = [
      '<a href="https://agrikoph.com/collections/all/">Shop</a>',
      "<a href='/collections/all'>Browse</a>",
    ].join("");

    expect(replaceExactInternalLinkTargets(input, [{
      fromUrl: "/collections/all",
      toUrl: "/collections/shop-all",
    }])).toEqual({
      bodyHtml: [
        '<a href="/collections/shop-all">Shop</a>',
        "<a href='/collections/shop-all'>Browse</a>",
      ].join(""),
      changed: 2,
    });
  });

  it("does not change external, query-different, fragment-different, or unrelated hrefs", () => {
    const input = [
      '<a href="https://example.com/products/black-rice">External</a>',
      '<a href="/products/black-rice?variant=1">Variant</a>',
      '<a href="/products/black-rice#details">Details</a>',
      '<a href="/products/red-rice">Red rice</a>',
    ].join("");

    expect(replaceExactInternalLinkTargets(input, [{
      fromUrl: "/products/black-rice",
      toUrl: "/products/philippines-organic-black-rice",
    }])).toEqual({ bodyHtml: input, changed: 0 });
  });
});
